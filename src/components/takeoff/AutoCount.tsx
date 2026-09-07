"use client";

// Local symbol search with optional AI crop review lands every detection in a
// review queue as PENDING markers. Nothing counts toward the estimate until
// accepted here — keyboard-driven: arrows navigate, Y accept, N reject,
// Shift+A accept all, Shift+R reject all.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/store/workspace";
import type { Takeoff } from "@/lib/types";
import type { AiBoxRect } from "./SheetCanvas";
import SymbolSearch from "./SymbolSearch";

export default function AutoCount({ request, onDone }: { request: AiBoxRect | null; onDone: () => void }) {
  const ws = useWorkspace();
  const [cursor, setCursor] = useState(0);
  const pending = useMemo(() => ws.takeoffs
    .filter(t => t.sheet_id === ws.activeSheetId && t.layer_id === ws.activeLayerId && t.status === "pending")
    .sort((a, b) => a.id.localeCompare(b.id)), [ws.takeoffs, ws.activeSheetId, ws.activeLayerId]);

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
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable='true']"))) return;
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

  return (
    <div className="border-t-2 border-[var(--color-pending)] bg-[color-mix(in_srgb,var(--color-pending)_6%,var(--color-ink-900))]">
      <SymbolSearch request={request} onDone={onDone} />
      {pending.length > 0 && (
        <div className="px-3 pb-3">
          <div className="mb-2 text-xs text-[var(--color-fg-dim)]">
            <span className="num text-[var(--color-pending)]">{pending.length}</span> pending detection(s)
            {current && (
              <>
                {" · "}#{Math.min(cursor, pending.length - 1) + 1}
                {current.ai_confidence != null && (
                  <span className="num"> ({Math.round(current.ai_confidence * 100)}% visual match)</span>
                )}
              </>
            )}
          </div>
          {current?.detection_review && current.detection_review !== "local" && <p className="mb-2 text-xs">{current.detection_review === "match" ? "AI suggests a match. Confirm against the drawing." : current.detection_review === "no-match" ? "AI suggests a different symbol. Inspect before accepting." : "AI review unresolved. Inspect manually."}</p>}
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

