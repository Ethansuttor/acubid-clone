"use client";

// Bid summary: labor rate / overhead / profit inputs recalculate the bid
// price live, and the whole estimate exports to Excel.

import { useState } from "react";
import { useWorkspace } from "@/store/workspace";
import {
  estimateTotals,
  extendEstimate,
  layerQuantities,
  summarize,
} from "@/lib/estimate";
import { exportToExcel } from "@/lib/excel";
import { fmt } from "@/lib/units";

export default function SummaryView() {
  const ws = useWorkspace();
  const [exporting, setExporting] = useState(false);
  if (!ws.project) return null;
  const project = ws.project;

  const quantities = layerQuantities(ws.layers, ws.takeoffs, ws.sheets);
  const lines = extendEstimate(quantities, ws.items, ws.assemblies, ws.assemblyItems);
  const totals = estimateTotals(lines);
  const s = summarize({
    ...totals,
    laborRate: project.labor_rate,
    overheadPct: project.overhead_pct,
    profitPct: project.profit_pct,
  });

  async function doExport() {
    setExporting(true);
    try {
      await exportToExcel({
        project,
        sheets: ws.sheets,
        layers: ws.layers,
        takeoffs: ws.takeoffs,
        items: ws.items,
        assemblies: ws.assemblies,
        assemblyItems: ws.assemblyItems,
      });
    } finally {
      setExporting(false);
    }
  }

  const Row = ({
    label,
    value,
    strong,
    accent,
  }: {
    label: string;
    value: string;
    strong?: boolean;
    accent?: boolean;
  }) => (
    <div
      className={`flex items-baseline justify-between border-b border-[color-mix(in_srgb,var(--color-line)_55%,transparent)] py-2 ${
        strong ? "text-base font-semibold" : "text-sm"
      }`}
    >
      <span className={strong ? "" : "text-[var(--color-fg-dim)]"}>{label}</span>
      <span className={`num ${accent ? "text-[var(--color-volt)]" : ""}`}>{value}</span>
    </div>
  );

  return (
    <div className="blueprint h-full overflow-auto">
      <div className="mx-auto flex max-w-4xl gap-6 px-6 py-10">
        <div className="panel w-72 shrink-0 self-start p-5">
          <div className="titlebar mb-4">Markup inputs</div>
          <label className="titlebar mb-1 block">Labor rate ($/hr)</label>
          <NumInput value={project.labor_rate} onCommit={(v) => ws.updateProject({ labor_rate: v })} />
          <label className="titlebar mb-1 mt-4 block">Overhead (%)</label>
          <NumInput value={project.overhead_pct} onCommit={(v) => ws.updateProject({ overhead_pct: v })} />
          <label className="titlebar mb-1 mt-4 block">Profit (%)</label>
          <NumInput value={project.profit_pct} onCommit={(v) => ws.updateProject({ profit_pct: v })} />
          <button
            className="btn btn-volt mt-6 w-full justify-center"
            onClick={doExport}
            disabled={exporting}
          >
            {exporting ? "Exporting…" : "Export to Excel"}
          </button>
          <div className="mt-2 text-[10.5px] text-[var(--color-fg-faint)]">
            Sheets: Takeoff · Material · Labor · Summary
          </div>
        </div>

        <div className="panel flex-1 p-6">
          <div className="titlebar mb-4">Bid summary — {project.name}</div>
          <Row label="Material total" value={`$${fmt(s.materialTotal)}`} />
          <Row label="Labor hours" value={`${fmt(s.laborHoursTotal)} hr`} />
          <Row label={`Labor cost @ $${fmt(s.laborRate)}/hr`} value={`$${fmt(s.laborCost)}`} />
          <Row label="Prime cost" value={`$${fmt(s.primeCost)}`} strong />
          <Row label={`Overhead (${s.overheadPct}%)`} value={`$${fmt(s.overhead)}`} />
          <Row label="Subtotal" value={`$${fmt(s.subtotal)}`} />
          <Row label={`Profit (${s.profitPct}%)`} value={`$${fmt(s.profit)}`} />
          <div className="mt-3 flex items-baseline justify-between bg-[var(--color-ink-800)] px-3 py-3">
            <span className="font-mono text-sm tracking-widest text-[var(--color-fg-dim)]">
              BID PRICE
            </span>
            <span className="num text-2xl font-bold text-[var(--color-volt)]" data-testid="bid-price">
              ${fmt(s.bidPrice)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function NumInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      className="input input-num"
      value={text ?? String(value)}
      onFocus={() => setText(value === 0 ? "" : String(value))}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v)) onCommit(v);
      }}
      onBlur={() => setText(null)}
    />
  );
}
