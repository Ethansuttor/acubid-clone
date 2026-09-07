"use client";

// Takeoff workspace: sheets | canvas+toolbar | layers, with keyboard-first
// tool switching, unlimited undo/redo, and the AI auto-count entry point.

import { useCallback, useEffect, useState } from "react";
import {
  CircleDot,
  MousePointer2,
  Pentagon,
  Redo2,
  Route,
  ScanLine,
  ScanSearch,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useWorkspace, type EditorTool } from "@/store/workspace";
import SheetCanvas, { type AiBoxRect } from "./SheetCanvas";
import SheetsPanel from "./SheetsPanel";
import LayersPanel from "./LayersPanel";
import AutoCount from "./AutoCount";

const TOOLS: { id: EditorTool; label: string; key: string; icon: LucideIcon }[] = [
  { id: "select", label: "Select", key: "V", icon: MousePointer2 },
  { id: "count", label: "Count", key: "C", icon: CircleDot },
  { id: "linear", label: "Linear", key: "L", icon: Route },
  { id: "area", label: "Area", key: "A", icon: Pentagon },
  { id: "calibrate", label: "Scale", key: "K", icon: ScanLine },
  { id: "aibox", label: "Auto count", key: "B", icon: ScanSearch },
];

export default function TakeoffView() {
  const ws = useWorkspace();
  const [aiRequest, setAiRequest] = useState<AiBoxRect | null>(null);
  const activeTool = TOOLS.find((t) => t.id === ws.tool) ?? TOOLS[0];

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
        <div className="tool-strip">
          <div className="tool-group" role="group" aria-label="Measurement tools">
            {TOOLS.filter((t) => t.id !== "aibox").map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  className="tool-btn"
                  onClick={() => ws.setTool(t.id)}
                  title={`${t.label} (${t.key})`}
                  aria-label={`${t.label} tool (${t.key})`}
                  aria-pressed={ws.tool === t.id}
                >
                  <Icon size={15} />
                </button>
              );
            })}
          </div>

          <div className="tool-group" role="group" aria-label="Assisted tools">
            {TOOLS.filter((t) => t.id === "aibox").map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  className="tool-btn"
                  onClick={() => ws.setTool(t.id)}
                  title={`${t.label} (${t.key})`}
                  aria-label={`${t.label} tool (${t.key})`}
                  aria-pressed={ws.tool === t.id}
                >
                  <Icon size={15} />
                </button>
              );
            })}
          </div>

          <div className="tool-group" role="group" aria-label="History">
            <button type="button" className="tool-btn" onClick={ws.undo} disabled={ws.undoStack.length === 0} title="Undo (Ctrl+Z)" aria-label="Undo">
              <Undo2 size={15} />
            </button>
            <button type="button" className="tool-btn" onClick={ws.redo} disabled={ws.redoStack.length === 0} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
              <Redo2 size={15} />
            </button>
          </div>

          <span className="tool-readout" aria-live="polite">
            {activeTool.label}
            <span className="kbd">{activeTool.key}</span>
          </span>
        </div>

        <div className="min-h-0 flex-1">
          <SheetCanvas
            key={ws.activeSheetId ?? "none"}
            onAiBox={(rect) => setAiRequest(rect)}
          />
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
