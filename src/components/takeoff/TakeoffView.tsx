"use client";

// Takeoff workspace: sheets | canvas+toolbar | layers, with keyboard-first
// tool switching, unlimited undo/redo, and the AI auto-count entry point.

import { useCallback, useEffect, useState } from "react";
import { useWorkspace, type EditorTool } from "@/store/workspace";
import SheetCanvas, { type AiBoxRect } from "./SheetCanvas";
import SheetsPanel from "./SheetsPanel";
import LayersPanel from "./LayersPanel";
import AutoCount from "./AutoCount";

const TOOLS: { id: EditorTool; label: string; key: string }[] = [
  { id: "select", label: "Select", key: "V" },
  { id: "count", label: "Count", key: "C" },
  { id: "linear", label: "Linear", key: "L" },
  { id: "area", label: "Area", key: "A" },
  { id: "calibrate", label: "Scale", key: "K" },
  { id: "aibox", label: "AI Count", key: "B" },
];

export default function TakeoffView() {
  const ws = useWorkspace();
  const [aiRequest, setAiRequest] = useState<AiBoxRect | null>(null);

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.target instanceof HTMLSelectElement) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") {
        e.preventDefault();
        if (e.shiftKey) ws.redo();
        else ws.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === "y") {
        e.preventDefault();
        ws.redo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.shiftKey) return; // Shift+A / Shift+R belong to the AI review queue
      if (k === "v") ws.setTool("select");
      else if (k === "c") ws.setTool("count");
      else if (k === "l") ws.setTool("linear");
      else if (k === "a") ws.setTool("area");
      else if (k === "k") ws.setTool("calibrate");
      else if (k === "b") ws.setTool("aibox");
      else if (e.key === "Delete" || e.key === "Backspace") {
        if (ws.selection.size > 0) ws.deleteTakeoffs([...ws.selection]);
      }
    },
    [ws]
  );

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  return (
    <div className="flex h-full min-h-0">
      <aside className="panel w-52 shrink-0 border-y-0 border-l-0">
        <SheetsPanel />
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="panel flex items-center gap-1 border-x-0 border-t-0 px-2 py-1.5">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`btn !py-1 text-xs ${
                ws.tool === t.id
                  ? "!border-[var(--color-volt)] !bg-[var(--color-ink-700)] !text-[var(--color-volt)]"
                  : ""
              } ${t.id === "aibox" ? "!text-[var(--color-ai)]" : ""}`}
              onClick={() => ws.setTool(t.id)}
              title={`${t.label} (${t.key})`}
            >
              {t.label} <span className="kbd">{t.key}</span>
            </button>
          ))}
          <div className="mx-2 h-5 w-px bg-[var(--color-line)]" />
          <button className="btn !py-1 text-xs" onClick={ws.undo} disabled={ws.undoStack.length === 0} title="Undo (Ctrl+Z)">
            ⟲ Undo
          </button>
          <button className="btn !py-1 text-xs" onClick={ws.redo} disabled={ws.redoStack.length === 0} title="Redo (Ctrl+Shift+Z)">
            ⟳ Redo
          </button>
          <span
            className={`ml-auto font-mono text-[10.5px] uppercase tracking-widest ${
              ws.saveState === "error"
                ? "text-[var(--color-danger)]"
                : ws.saveState === "saving"
                ? "text-[var(--color-volt)]"
                : "text-[var(--color-fg-faint)]"
            }`}
          >
            {ws.saveState === "error" ? "save failed" : ws.saveState === "saving" ? "saving…" : "saved"}
          </span>
        </div>

        <div className="min-h-0 flex-1">
          <SheetCanvas onAiBox={(rect) => setAiRequest(rect)} />
        </div>
      </main>

      <aside className="panel flex w-72 shrink-0 flex-col border-y-0 border-r-0">
        <div className="min-h-0 flex-1">
          <LayersPanel />
        </div>
        <AutoCount request={aiRequest} onDone={() => setAiRequest(null)} />
      </aside>
    </div>
  );
}
