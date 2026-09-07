"use client";

import { CheckCircle2, Circle, ArrowRight } from "lucide-react";
import { useWorkspace } from "@/store/workspace";

export default function EstimateSetup({ navigate }: { navigate: (tab: "takeoff" | "database" | "summary" | "scope") => void }) {
  const ws = useWorkspace();
  const steps = [
    { title: "Add your plans", detail: "Use + PDF in Takeoff. Calibrate a known dimension on every measured sheet.", done: ws.sheets.length > 0, tab: "takeoff" as const },
    { title: "Set up pricing", detail: "Import your item CSV or add items and assemblies in Database. Verify prices and labor units.", done: ws.items.length > 0, tab: "database" as const },
    { title: "Measure the scope", detail: "Create a layer, link its item or assembly, then count or trace on the plan.", done: ws.takeoffs.some(t => t.status === "confirmed"), tab: "takeoff" as const },
    { title: "Review the proposal", detail: "Organize areas and systems, then record inclusions, exclusions and alternates.", done: ws.proposalEntries.length > 0, tab: "scope" as const },
    { title: "Check and issue", detail: "Set rates, markups and quoted costs in Summary. Resolve readiness blockers before exporting.", done: ws.snapshots.length > 0, tab: "summary" as const },
  ];
  return (
    <details className="border-b border-[var(--color-line)] bg-[var(--color-ink-900)] px-4 py-2 print:hidden">
      <summary className="cursor-pointer text-xs font-medium">Estimate setup · {steps.filter(step => step.done).length} of {steps.length} steps started</summary>
      <div className="grid gap-3 py-3 sm:grid-cols-2 xl:grid-cols-5">
        {steps.map(step => (
          <button key={step.title} className="rounded border border-[var(--color-line)] p-3 text-left hover:bg-[var(--color-ink-850)]" onClick={() => navigate(step.tab)}>
            <span className="flex items-center gap-2 text-xs font-semibold">{step.done ? <CheckCircle2 size={15} className="text-[var(--color-ok)]" /> : <Circle size={15} />} {step.title} <ArrowRight size={12} className="ml-auto" /></span>
            <span className="mt-2 block text-xs leading-5 text-[var(--color-fg-dim)]">{step.detail}</span>
          </button>
        ))}
      </div>
    </details>
  );
}
