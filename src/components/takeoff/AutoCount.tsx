"use client";

// AI auto-count controller + review queue (full implementation in phase 4).

import type { AiBoxRect } from "./SheetCanvas";

export default function AutoCount({
  request,
  onDone,
}: {
  request: AiBoxRect | null;
  onDone: () => void;
}) {
  if (!request) return null;
  return (
    <div className="border-t border-[var(--color-line)] p-3 text-xs text-[var(--color-fg-dim)]">
      AI auto-count is not wired up yet.
      <button className="btn ml-2 !px-2 !py-0.5 text-xs" onClick={onDone}>
        Dismiss
      </button>
    </div>
  );
}
