"use client";

// AI auto-count: captures the example-symbol crop and overlapping tiles of
// the active sheet, calls /api/autocount, and lands every detection in a
// review queue as PENDING markers. Nothing counts toward the estimate until
// accepted here — keyboard-driven: arrows navigate, Y accept, N reject,
// Shift+A accept all, Shift+R reject all.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { loadDocument } from "@/lib/pdf";
import { computeTiles } from "@/lib/autocount/tiling";
import { mapDetectionsToSheet, detectionCenter } from "@/lib/autocount/mapping";
import { dedupeDetections } from "@/lib/autocount/dedupe";
import { toGray, matchAll } from "@/lib/autocount/ncc";
import { blendConfidence } from "@/lib/autocount/verify";
import { DETECTION_STRATEGY } from "@/lib/autocount/types";
import type { Detection, Tile, VerifyResponse } from "@/lib/autocount/types";
import { useWorkspace } from "@/store/workspace";
import type { Takeoff } from "@/lib/types";
import type { AiBoxRect } from "./SheetCanvas";

type Phase =
  | { kind: "idle" }
  | { kind: "capturing" }
  | { kind: "detecting"; tiles: number }
  | { kind: "error"; message: string }
  | { kind: "done"; found: number; model: string };

export default function AutoCount({
  request,
  onDone,
}: {
  request: AiBoxRect | null;
  onDone: () => void;
}) {
  const ws = useWorkspace();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [cursor, setCursor] = useState(0);
  const runningRef = useRef(false);

  const sheet = ws.sheets.find((s) => s.id === ws.activeSheetId) ?? null;
  const layer = ws.layers.find((l) => l.id === ws.activeLayerId) ?? null;

  const pending = useMemo(
    () =>
      ws.takeoffs
        .filter((t) => t.sheet_id === sheet?.id && t.status === "pending")
        .sort((a, b) => a.id.localeCompare(b.id)),
    [ws.takeoffs, sheet?.id]
  );

  // ---- run detection when a box is drawn ---------------------------------
  useEffect(() => {
    if (!request || runningRef.current) return;
    if (!sheet || !layer || layer.tool !== "count") {
      // Reacting to a one-shot event (a box was drawn), not synchronizing
      // state, so the cascading-render concern behind this rule does not apply.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase({ kind: "error", message: "Select a COUNT layer first, then draw the box." });
      onDone();
      return;
    }
    runningRef.current = true;
    (async () => {
      try {
        setPhase({ kind: "capturing" });
        const doc = ws.documents.find((d) => d.id === sheet.document_id);
        if (!doc) throw new Error("Document not found");
        const pdf = await loadDocument(doc.id, doc.storage_path);
        const page = await pdf.getPage(sheet.page_number);
        const vp1 = page.getViewport({ scale: 1 });

        // Render scale: template ~72px on its long edge, capped by total pixels.
        let S = Math.min(4, Math.max(1.5, 72 / Math.max(request.w, request.h)));
        S = Math.min(S, Math.sqrt(32e6 / (vp1.width * vp1.height)) || S);
        const vp = page.getViewport({ scale: S });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport: vp }).promise;

        // Template crop with 10% padding.
        const pad = 0.1 * Math.max(request.w, request.h) * S;
        const tx = Math.max(0, request.x * S - pad);
        const ty = Math.max(0, request.y * S - pad);
        const tw = Math.min(canvas.width - tx, request.w * S + 2 * pad);
        const th = Math.min(canvas.height - ty, request.h * S + 2 * pad);
        const template = crop(canvas, tx, ty, tw, th);

        // Overlapping tiles; overlap covers at least 2 template diameters.
        const overlap = Math.min(640, Math.max(160, Math.ceil(2 * Math.max(request.w, request.h) * S)));
        const boxes = computeTiles(canvas.width, canvas.height, { tileSize: 1280, overlap });
        const tiles: Tile[] = [];
        for (const b of boxes) {
          const tileCanvas = document.createElement("canvas");
          tileCanvas.width = b.w;
          tileCanvas.height = b.h;
          const tctx = tileCanvas.getContext("2d")!;
          tctx.drawImage(canvas, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
          if (isBlank(tctx, b.w, b.h)) continue;
          tiles.push({ ...b, image: tileCanvas.toDataURL("image/png") });
        }
        if (tiles.length === 0) throw new Error("Sheet appears to be blank at render scale");

        setPhase({ kind: "detecting", tiles: tiles.length });
        const { data: sess } = await supabase().auth.getSession();
        const authHeader = `Bearer ${sess.session?.access_token ?? ""}`;

        let finalCanvasDetections: Detection[] = [];
        let usedModel = "ncc-template-matcher";

        if (DETECTION_STRATEGY === "ncc-verify") {
          // Stage 1: Deterministic NCC template matching in browser across non-blank tiles.
          // Use the crop canvas's OWN integer dimensions: tw/th are floats
          // (request.w * S + 2 * pad), while crop() floored them when sizing the
          // canvas. Passing the float pair to toGray/matchAll indexes a buffer of a
          // different size and silently yields zero matches. See 06-bug-history.md.
          const tplW = template.width;
          const tplH = template.height;
          const tplCtx = template.getContext("2d")!;
          const tplData = tplCtx.getImageData(0, 0, tplW, tplH);
          const tplGray = toGray(tplData.data, tplW, tplH);

          const rawCandidates: Detection[] = [];
          for (let i = 0; i < tiles.length; i++) {
            const t = tiles[i];
            const tCanvas = document.createElement("canvas");
            tCanvas.width = t.w;
            tCanvas.height = t.h;
            const tctx = tCanvas.getContext("2d")!;
            tctx.drawImage(canvas, t.x, t.y, t.w, t.h, 0, 0, t.w, t.h);
            const tileData = tctx.getImageData(0, 0, t.w, t.h);
            const tileGray = toGray(tileData.data, t.w, t.h);

            const hits = matchAll({ g: tileGray, w: t.w, h: t.h }, { g: tplGray, w: tplW, h: tplH }, 0.5);
            for (const h of hits) {
              rawCandidates.push({ ...h, x: h.x + t.x, y: h.y + t.y });
            }
          }

          const dedupedCandidates = dedupeDetections(rawCandidates);

          if (dedupedCandidates.length === 0) {
            finalCanvasDetections = [];
          } else {
            // Stage 2: Extract 1.6x patches around candidates and verify with LLM in batches of up to 24
            const cropW = Math.max(1, Math.min(canvas.width, Math.round(1.6 * tw)));
            const cropH = Math.max(1, Math.min(canvas.height, Math.round(1.6 * th)));

            const candidateCrops = dedupedCandidates.map((c, idx) => {
              const cx = c.x + c.w / 2;
              const cy = c.y + c.h / 2;
              const cropX = Math.max(0, Math.min(canvas.width - cropW, Math.round(cx - cropW / 2)));
              const cropY = Math.max(0, Math.min(canvas.height - cropH, Math.round(cy - cropH / 2)));
              const cCanvas = crop(canvas, cropX, cropY, cropW, cropH);
              return {
                index: idx + 1,
                image: cCanvas.toDataURL("image/png"),
                box: c,
              };
            });

            const templateDataUrl = template.toDataURL("image/png");
            const BATCH_SIZE = 24;
            const verifiedList: Detection[] = [];

            for (let b = 0; b < candidateCrops.length; b += BATCH_SIZE) {
              const batch = candidateCrops.slice(b, b + BATCH_SIZE);
              const res = await fetch("/api/autocount", {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  authorization: authHeader,
                },
                body: JSON.stringify({
                  mode: "verify",
                  template: templateDataUrl,
                  crops: batch.map((item) => ({ index: item.index, image: item.image })),
                }),
              });

              if (!res.ok) {
                const err = (await res.json().catch(() => null)) as { error?: string } | null;
                throw new Error(err?.error ?? `Crop verification failed (HTTP ${res.status})`);
              }

              const result = (await res.json()) as VerifyResponse;
              usedModel = result.model;

              for (const v of result.verifications) {
                if (v.match) {
                  const orig = candidateCrops[v.index - 1];
                  if (orig) {
                    const blended = blendConfidence(orig.box.confidence, v.confidence);
                    verifiedList.push({ ...orig.box, confidence: blended });
                  }
                }
              }
            }

            finalCanvasDetections = verifiedList;
          }
        } else {
          // Legacy tile-scan strategy
          const res = await fetch("/api/autocount", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: authHeader,
            },
            body: JSON.stringify({
              template: template.toDataURL("image/png"),
              templateW: tw,
              templateH: th,
              tiles,
            }),
          });
          if (!res.ok) {
            const err = (await res.json().catch(() => null)) as { error?: string } | null;
            throw new Error(err?.error ?? `Auto-count failed (HTTP ${res.status})`);
          }
          const result = (await res.json()) as { detections: Detection[]; model: string };
          finalCanvasDetections = result.detections;
          usedModel = result.model;
        }

        // Canvas px -> PDF units; land as pending count takeoffs (undoable).
        const sheetDetections = mapDetectionsToSheet(finalCanvasDetections, { x: 0, y: 0 }, S);
        const takeoffs: Takeoff[] = sheetDetections.map((d) => ({
          id: crypto.randomUUID(),
          layer_id: layer.id,
          sheet_id: sheet.id,
          project_id: sheet.project_id,
          user_id: ws.userId!,
          kind: "count" as const,
          geometry: detectionCenter(d),
          source: "ai" as const,
          status: "pending" as const,
          ai_confidence: d.confidence,
        }));
        ws.addTakeoffs(takeoffs);
        setCursor(0);
        setPhase({ kind: "done", found: takeoffs.length, model: usedModel });
      } catch (e) {
        setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        runningRef.current = false;
        onDone();
        ws.setTool("select");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  // ---- review actions ------------------------------------------------------
  const current = pending[Math.min(cursor, pending.length - 1)] ?? null;

  const setStatus = useCallback(
    (targets: Takeoff[], status: "confirmed" | "rejected") => {
      if (targets.length === 0) return;
      ws.updateTakeoffs(targets.map((t) => ({ ...t, status })));
    },
    [ws]
  );

  const focusIndex = useCallback(
    (i: number) => {
      const t = pending[i];
      if (t) ws.setSelection(new Set([t.id]));
      setCursor(i);
    },
    [pending, ws]
  );

  useEffect(() => {
    if (pending.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const i = Math.min(cursor, pending.length - 1);
      if (e.key === "ArrowRight") {
        e.preventDefault();
        focusIndex(Math.min(i + 1, pending.length - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        focusIndex(Math.max(i - 1, 0));
      } else if (e.key.toLowerCase() === "y") {
        setStatus([pending[i]], "confirmed");
      } else if (e.key.toLowerCase() === "n") {
        setStatus([pending[i]], "rejected");
      } else if (e.key === "A" && e.shiftKey) {
        setStatus(pending, "confirmed");
      } else if (e.key === "R" && e.shiftKey) {
        setStatus(pending, "rejected");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, cursor, focusIndex, setStatus]);

  if (phase.kind === "idle" && pending.length === 0) return null;

  return (
    <div className="border-t-2 border-[var(--color-ai)] bg-[color-mix(in_srgb,var(--color-ai)_6%,var(--color-ink-900))]">
      <div className="titlebar flex items-center justify-between px-3 py-2 !text-[var(--color-ai)]">
        <span>AI auto-count</span>
        {(phase.kind === "done" || phase.kind === "error") && pending.length === 0 && (
          <button
            className="btn !px-2 !py-0.5 text-xs"
            aria-label="Dismiss AutoCount review"
            onClick={() => setPhase({ kind: "idle" })}
          >
            ✕
          </button>
        )}
      </div>

      {phase.kind === "capturing" && (
        <div className="px-3 pb-3 text-xs text-[var(--color-fg-dim)]" role="status" aria-live="polite">
          Rendering sheet tiles…
        </div>
      )}
      {phase.kind === "detecting" && (
        <div className="px-3 pb-3 text-xs text-[var(--color-fg-dim)]" role="status" aria-live="polite">
          Scanning {phase.tiles} tile(s) with Claude vision…
        </div>
      )}
      {phase.kind === "error" && (
        <div className="px-3 pb-3 text-xs text-[var(--color-danger)]" role="alert">
          {phase.message}
        </div>
      )}
      {phase.kind === "done" && pending.length === 0 && (
        <div className="px-3 pb-3 text-xs text-[var(--color-fg-dim)]" role="status" aria-live="polite">
          {phase.found} candidate(s) found · review complete
        </div>
      )}

      {pending.length > 0 && (
        <div className="px-3 pb-3">
          <div className="mb-2 text-xs text-[var(--color-fg-dim)]">
            <span className="num text-[var(--color-ai)]">{pending.length}</span> pending detection(s)
            {current && (
              <>
                {" · "}#{Math.min(cursor, pending.length - 1) + 1}
                {current.ai_confidence != null && (
                  <span className="num"> ({Math.round(current.ai_confidence * 100)}%)</span>
                )}
              </>
            )}
          </div>
          <div className="mb-2 flex gap-1">
            <button
              className="btn flex-1 justify-center !py-1 text-xs !text-[var(--color-ok)]"
              onClick={() => current && setStatus([current], "confirmed")}
            >
              Accept <span className="kbd">Y</span>
            </button>
            <button
              className="btn flex-1 justify-center !py-1 text-xs btn-danger"
              onClick={() => current && setStatus([current], "rejected")}
            >
              Reject <span className="kbd">N</span>
            </button>
            <button
              className="btn !py-1 text-xs"
              title="Previous (←)"
              aria-label="Previous detection (←)"
              onClick={() => focusIndex(Math.max(Math.min(cursor, pending.length - 1) - 1, 0))}
            >
              ←
            </button>
            <button
              className="btn !py-1 text-xs"
              title="Next (→)"
              aria-label="Next detection (→)"
              onClick={() => focusIndex(Math.min(Math.min(cursor, pending.length - 1) + 1, pending.length - 1))}
            >
              →
            </button>
          </div>
          <div className="flex gap-1">
            <button
              className="btn flex-1 justify-center !py-1 text-xs"
              onClick={() => setStatus(pending, "confirmed")}
            >
              Accept all <span className="kbd">⇧A</span>
            </button>
            <button
              className="btn flex-1 justify-center !py-1 text-xs btn-danger"
              onClick={() => setStatus(pending, "rejected")}
            >
              Reject all <span className="kbd">⇧R</span>
            </button>
          </div>
          <div className="mt-2 text-[10px] text-[var(--color-fg-faint)]">
            Pending markers are dashed blue on the drawing and are NOT counted in the estimate
            until accepted. Accepting is undoable (Ctrl+Z).
          </div>
        </div>
      )}
    </div>
  );
}

function crop(src: HTMLCanvasElement, x: number, y: number, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.floor(w));
  c.height = Math.max(1, Math.floor(h));
  c.getContext("2d")!.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  return c;
}

/** Sampled darkness check so empty border tiles are not sent to the API. */
function isBlank(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = ctx.getImageData(0, 0, w, h).data;
  let dark = 0;
  for (let i = 0; i < data.length; i += 32) {
    // every 8th pixel (RGBA stride 4)
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum < 200 && data[i + 3] > 0) dark++;
    if (dark > 5) return false;
  }
  return true;
}
