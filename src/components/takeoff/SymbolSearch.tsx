"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { loadDocument } from "@/lib/pdf";
import { useWorkspace } from "@/store/workspace";
import { cropCanvas, detectOnCanvas, type DetectionProgress } from "@/lib/autocount/pipeline";
import { mapDetectionsToSheet, detectionCenter } from "@/lib/autocount/mapping";
import { LOCAL_MIN_SCORE } from "@/lib/autocount/local";
import type { Takeoff } from "@/lib/types";
import type { AiBoxRect } from "./SheetCanvas";

type Phase = { kind: "idle" | "capturing" | "cancelled" }
  | { kind: "detecting"; progress: DetectionProgress }
  | { kind: "error"; message: string }
  | { kind: "done"; found: number; details: string; warning: string };

export default function SymbolSearch({ request, onDone }: { request: AiBoxRect | null; onDone: () => void }) {
  const ws = useWorkspace();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [assist, setAssist] = useState(false);
  const [minScore, setMinScore] = useState(LOCAL_MIN_SCORE);
  const [scaleTolerance, setScaleTolerance] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const busy = phase.kind === "capturing" || phase.kind === "detecting";
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!request || abortRef.current) return;
    const sheet = ws.sheets.find(sheet => sheet.id === ws.activeSheetId);
    const layer = ws.layers.find(layer => layer.id === ws.activeLayerId);
    if (!sheet || !layer || layer.tool !== "count") {
      // A one-shot canvas event, not derived state synchronization.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase({ kind: "error", message: "Select a count layer, then draw a box around one symbol." });
      onDone();
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;
    (async () => {
      try {
        setPhase({ kind: "capturing" });
        const doc = ws.documents.find(doc => doc.id === sheet.document_id);
        if (!doc) throw new Error("Document not found.");
        const pdf = await loadDocument(doc.id, doc.storage_path);
        signal.throwIfAborted();
        const page = await pdf.getPage(sheet.page_number);
        const vp1 = page.getViewport({ scale: 1 });
        let scale = Math.min(4, Math.max(1.5, 72 / Math.max(request.w, request.h)));
        scale = Math.min(scale, Math.sqrt(32e6 / (vp1.width * vp1.height)));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const task = page.render({ canvasContext: canvas.getContext("2d")!, viewport });
        const cancelRender = () => task.cancel();
        signal.addEventListener("abort", cancelRender, { once: true });
        try { await task.promise; } finally { signal.removeEventListener("abort", cancelRender); }
        signal.throwIfAborted();
        const pad = 0.1 * Math.max(request.w, request.h) * scale;
        const x = Math.max(0, request.x * scale - pad), y = Math.max(0, request.y * scale - pad);
        const right = Math.min(canvas.width, (request.x + request.w) * scale + pad);
        const bottom = Math.min(canvas.height, (request.y + request.h) * scale + pad);
        const template = cropCanvas(canvas, x, y, right - x, bottom - y);
        const session = assist ? await supabase().auth.getSession() : null;
        const existing = ws.takeoffs.filter(t => t.sheet_id === sheet.id && t.layer_id === layer.id && t.kind === "count" && t.status !== "rejected")
          .map(t => ({ x: (t.geometry as { x: number }).x * scale, y: (t.geometry as { y: number }).y * scale }));
        const result = await detectOnCanvas(canvas, template, {
          minScore, scaleTolerance, assist, existing,
          authHeader: `Bearer ${session?.data.session?.access_token ?? ""}`,
        }, signal, progress => setPhase({ kind: "detecting", progress }));
        signal.throwIfAborted();
        const current = useWorkspace.getState();
        if (current.project?.id !== sheet.project_id || !current.layers.some(l => l.id === layer.id) || !current.sheets.some(s => s.id === sheet.id)) {
          throw new Error("The target sheet or layer changed. Run detection again.");
        }
        const sheetDetections = mapDetectionsToSheet(result.detections, { x: 0, y: 0 }, scale);
        const existingNow = current.takeoffs.filter(t => t.sheet_id === sheet.id && t.layer_id === layer.id && t.kind === "count" && t.status !== "rejected");
        const remaining = sheetDetections.map((d, i) => ({ d, review: result.detections[i].review })).filter(({ d }) => {
          const center = detectionCenter(d);
          return !existingNow.some(t => {
            const point = t.geometry as { x: number; y: number };
            return Math.hypot(point.x - center.x, point.y - center.y) < 0.35 * Math.min(d.w, d.h);
          });
        });
        const takeoffs: Takeoff[] = remaining.map(({ d, review }) => ({
          id: crypto.randomUUID(), layer_id: layer.id, sheet_id: sheet.id,
          project_id: sheet.project_id, user_id: ws.userId!, kind: "count",
          geometry: detectionCenter(d), source: "ai", status: "pending",
          ai_confidence: d.confidence, detection_review: review,
        }));
        current.addTakeoffs(takeoffs);
        const stats = result.stats;
        setPhase({ kind: "done", found: takeoffs.length, warning: result.warning,
          details: `${stats.tiles}/${stats.tiles} tiles checked · ${stats.skipped} blank · ${stats.duplicates + sheetDetections.length - remaining.length} existing marks skipped · ${stats.requests} API calls · ${stats.sentCrops} crops · ${(stats.payloadBytes / 1024).toFixed(1)} KB sent` });
      } catch (error) {
        if (signal.aborted) setPhase({ kind: "cancelled" });
        else setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      } finally {
        abortRef.current = null;
        onDone();
        ws.setTool("select");
      }
    })();
    // Capture settings and target at the time of the one-shot canvas request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  return <section aria-label="Symbol search" className="space-y-2 px-3 py-3 text-xs">
    <h3 className="font-semibold">Symbol search</h3>
    <label className="flex items-center justify-between gap-2">Mode
      <select className="input !w-auto !py-1 text-xs" aria-label="Detection mode" value={assist ? "assisted" : "local"} disabled={busy} onChange={event => setAssist(event.target.value === "assisted")}>
        <option value="local">Local only · no API</option><option value="assisted">Local + optional AI</option>
      </select>
    </label>
    <label className="flex items-center justify-between gap-2">Match threshold
      <select className="input !w-auto !py-1 text-xs" aria-label="Match threshold" value={minScore} disabled={busy} onChange={event => setMinScore(Number(event.target.value))}>
        <option value={0.6}>Broad · 60%</option><option value={0.72}>Balanced · 72%</option><option value={0.85}>Strict · 85%</option>
      </select>
    </label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={scaleTolerance} disabled={busy} onChange={event => setScaleTolerance(event.target.checked)} /> Allow ±10% size (slower)</label>
    <p className="leading-4 text-[var(--color-fg-dim)]">Select a count layer, press B, then box one clear symbol. Rotated and mirrored matches are included. Review every candidate.</p>
    {assist && <p className="leading-4 text-[var(--color-fg-dim)]">Sends at most 48 uncertain crops in 4 requests to the configured AI provider. Strong matches stay local. AI suggestions never approve quantities.</p>}
    {busy && <button className="btn text-xs" onClick={() => abortRef.current?.abort()}>Cancel search</button>}
    {phase.kind === "capturing" && <p role="status">Rendering drawing locally…</p>}
    {phase.kind === "detecting" && <p role="status">{phase.progress.stage === "local" ? "Matching locally" : "Reviewing uncertain crops"}: {phase.progress.completed}/{phase.progress.total}…</p>}
    {phase.kind === "cancelled" && <p role="status">Search cancelled. No candidates were added.</p>}
    {phase.kind === "error" && <p role="alert" className="text-[var(--color-danger)]">{phase.message}</p>}
    {phase.kind === "done" && <div role="status" data-testid="detection-report"><p>{phase.found} new candidates for review.</p><p className="mt-1 leading-4">{phase.details}</p>{phase.warning && <p className="mt-2 text-[var(--color-danger)]">{phase.warning}</p>}</div>}
  </section>;
}
