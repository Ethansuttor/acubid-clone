"use client";

// Bid summary: takeoff extension plus waste, sales tax, escalation, labor
// factoring, burden and small tools, direct job costs with their own tax flag,
// contingency, overhead, profit and bond — recalculating live, and the export.

import { useState } from "react";
import { useWorkspace } from "@/store/workspace";
import {
  estimateTotals,
  extendEstimate,
  layerQuantities,
  summarize,
} from "@/lib/estimate";
import { exportToExcel } from "@/lib/excel";
import { fmt, parseNumericInput } from "@/lib/units";
import type { DirectCostCategory } from "@/lib/types";

const CATEGORIES: DirectCostCategory[] = [
  "quote",
  "subcontractor",
  "equipment",
  "permit",
  "bond",
  "other",
];

export default function SummaryView() {
  const ws = useWorkspace();
  const [exporting, setExporting] = useState(false);
  if (!ws.project) return null;
  const project = ws.project;

  const quantities = layerQuantities(ws.layers, ws.takeoffs, ws.sheets);
  const { lines, issues } = extendEstimate(
    quantities,
    ws.items,
    ws.assemblies,
    ws.assemblyItems
  );
  const s = summarize({
    ...estimateTotals(lines),
    laborRate: project.labor_rate,
    wastePct: project.waste_pct,
    taxPct: project.tax_pct,
    laborFactorPct: project.labor_factor_pct,
    laborBurdenPct: project.labor_burden_pct,
    smallToolsPct: project.small_tools_pct,
    escalationPct: project.escalation_pct,
    contingencyPct: project.contingency_pct,
    bondPct: project.bond_pct,
    overheadPct: project.overhead_pct,
    profitPct: project.profit_pct,
    directCosts: ws.directCosts,
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
        directCosts: ws.directCosts,
      });
    } finally {
      setExporting(false);
    }
  }

  function addCost() {
    ws.upsertDirectCost({
      id: crypto.randomUUID(),
      project_id: project.id,
      user_id: ws.userId!,
      description: "",
      category: "quote",
      amount: 0,
      ohp_applies: true,
      taxable: false,
      sort_order: ws.directCosts.length,
    });
  }

  return (
    <div className="blueprint h-full overflow-auto">
      <div className="mx-auto max-w-5xl px-6 py-8">
        {issues.some((i) => i.severity === "missing") && (
          <div className="panel mb-4 border-l-2 !border-l-[var(--color-danger)] px-4 py-2 text-xs text-[var(--color-danger)]">
            <span className="font-mono uppercase tracking-widest">
              {issues.filter((i) => i.severity === "missing").length} layer(s) carry quantity
              that is missing from this bid
            </span>{" "}
            — see the Estimate tab.
          </div>
        )}

        {s.warnings.map((w) => (
          <div
            key={w}
            data-testid="summary-warning"
            className="panel mb-4 border-l-2 !border-l-[var(--color-danger)] px-4 py-2 text-xs text-[var(--color-danger)]"
          >
            {w}
          </div>
        ))}

        <div className="flex gap-6">
          <div className="panel w-72 shrink-0 self-start p-5">
            <div className="titlebar mb-4">Rates &amp; markups</div>
            <Field
              testId="labor-rate"
              label="Labor rate ($/hr)"
              value={project.labor_rate}
              onCommit={(v) => ws.updateProject({ labor_rate: v })}
            />
            <Field
              testId="waste-pct"
              label="Material waste (%)"
              percent
              value={project.waste_pct}
              onCommit={(v) => ws.updateProject({ waste_pct: v })}
            />
            <Field
              testId="tax-pct"
              label="Sales tax (%)"
              percent
              value={project.tax_pct}
              onCommit={(v) => ws.updateProject({ tax_pct: v })}
            />
            <Field
              testId="labor-factor-pct"
              label="Labor factor (%)"
              percent
              hint="Job conditions: +15 costs 15% more hours"
              value={project.labor_factor_pct}
              onCommit={(v) => ws.updateProject({ labor_factor_pct: v })}
            />
            <Field
              testId="labor-burden-pct"
              label="Labor burden (%)"
              percent
              hint="Payroll tax, insurance, fringes — of labor cost"
              value={project.labor_burden_pct}
              onCommit={(v) => ws.updateProject({ labor_burden_pct: v })}
            />
            <Field
              testId="small-tools-pct"
              label="Small tools (%)"
              percent
              hint="Consumables, of labor cost. Typically 1–3"
              value={project.small_tools_pct}
              onCommit={(v) => ws.updateProject({ small_tools_pct: v })}
            />
            <Field
              testId="escalation-pct"
              label="Escalation (%)"
              percent
              hint="Material price to buyout, of material total"
              value={project.escalation_pct}
              onCommit={(v) => ws.updateProject({ escalation_pct: v })}
            />
            <Field
              testId="contingency-pct"
              label="Contingency (%)"
              percent
              hint="Of prime cost, before overhead"
              value={project.contingency_pct}
              onCommit={(v) => ws.updateProject({ contingency_pct: v })}
            />
            <Field
              testId="bond-pct"
              label="Bond (%)"
              percent
              hint="Of the bid price, which includes the bond"
              value={project.bond_pct}
              onCommit={(v) => ws.updateProject({ bond_pct: v })}
            />
            <Field
              testId="overhead-pct"
              label="Overhead (%)"
              percent
              value={project.overhead_pct}
              onCommit={(v) => ws.updateProject({ overhead_pct: v })}
            />
            <Field
              testId="profit-pct"
              label="Profit (%)"
              percent
              value={project.profit_pct}
              onCommit={(v) => ws.updateProject({ profit_pct: v })}
            />
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

          <div className="min-w-0 flex-1 space-y-4">
            <div className="panel p-6">
              <div className="titlebar mb-4">Bid summary — {project.name}</div>
              <Row label="Material from takeoff" value={`$${fmt(s.materialBase)}`} />
              {s.wastePct !== 0 && (
                <Row label={`Waste (${s.wastePct}%)`} value={`$${fmt(s.wasteAmount)}`} />
              )}
              {s.taxPct !== 0 && (
                <Row label={`Sales tax (${s.taxPct}%)`} value={`$${fmt(s.salesTax)}`} />
              )}
              <Row label="Material total" value={`$${fmt(s.materialTotal)}`} strong />
              {s.escalationPct !== 0 && (
                <Row
                  label={`Escalation (${s.escalationPct}% of material total)`}
                  value={`$${fmt(s.escalation)}`}
                />
              )}
              <Row label="Labor hours from takeoff" value={`${fmt(s.laborHoursBase)} hr`} />
              {s.laborFactorPct !== 0 && (
                <Row
                  label={`Labor factor (${s.laborFactorPct > 0 ? "+" : ""}${s.laborFactorPct}%)`}
                  value={`${fmt(s.laborFactorHours)} hr`}
                />
              )}
              <Row label="Labor hours total" value={`${fmt(s.laborHoursTotal)} hr`} />
              <Row
                label={`Labor cost @ $${fmt(s.laborRate)}/hr`}
                value={`$${fmt(s.laborCost)}`}
                strong={s.laborBurdenPct === 0 && s.smallToolsPct === 0}
              />
              {s.laborBurdenPct !== 0 && (
                <Row
                  label={`Labor burden (${s.laborBurdenPct}% of labor cost)`}
                  value={`$${fmt(s.laborBurden)}`}
                />
              )}
              {s.smallToolsPct !== 0 && (
                <Row
                  label={`Small tools (${s.smallToolsPct}% of labor cost)`}
                  value={`$${fmt(s.smallTools)}`}
                />
              )}
              {(s.laborBurdenPct !== 0 || s.smallToolsPct !== 0) && (
                <Row label="Labor total" value={`$${fmt(s.laborTotal)}`} strong />
              )}
              {s.directCostsWithOhpBase !== 0 && (
                <Row
                  label="Direct costs (O&P applies)"
                  value={`$${fmt(s.directCostsWithOhpBase)}`}
                />
              )}
              {s.directCostsWithOhpTax !== 0 && (
                <Row
                  label={`Sales tax on those quotes (${s.taxPct}%)`}
                  value={`$${fmt(s.directCostsWithOhpTax)}`}
                />
              )}
              <Row label="Prime cost" value={`$${fmt(s.primeCost)}`} strong />
              {s.contingencyPct !== 0 && (
                <Row
                  label={`Contingency (${s.contingencyPct}% of prime cost)`}
                  value={`$${fmt(s.contingency)}`}
                />
              )}
              <Row label={`Overhead (${s.overheadPct}%)`} value={`$${fmt(s.overhead)}`} />
              <Row label="Subtotal" value={`$${fmt(s.subtotal)}`} />
              <Row label={`Profit (${s.profitPct}%)`} value={`$${fmt(s.profit)}`} />
              {s.directCostsAtCostBase !== 0 && (
                <Row
                  label="Direct costs (at cost, no O&P)"
                  value={`$${fmt(s.directCostsAtCostBase)}`}
                />
              )}
              {s.directCostsAtCostTax !== 0 && (
                <Row
                  label={`Sales tax on those (${s.taxPct}%, at cost)`}
                  value={`$${fmt(s.directCostsAtCostTax)}`}
                />
              )}
              {s.bond !== 0 && (
                <Row
                  label={`Bond (${s.bondPct}% of bid price)`}
                  value={`$${fmt(s.bond)}`}
                />
              )}
              <div className="mt-3 flex items-baseline justify-between bg-[var(--color-ink-800)] px-3 py-3">
                <span className="font-mono text-sm tracking-widest text-[var(--color-fg-dim)]">
                  BID PRICE
                </span>
                <span
                  className="num text-2xl font-bold text-[var(--color-volt)]"
                  data-testid="bid-price"
                >
                  ${fmt(s.bidPrice)}
                </span>
              </div>
            </div>

            <div className="panel">
              <div className="titlebar flex items-center justify-between px-3 py-2">
                <span>Direct job costs ({ws.directCosts.length})</span>
                <button className="btn !px-2 !py-0.5 text-xs" onClick={addCost}>
                  + Cost
                </button>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="w-32">Category</th>
                    <th className="r w-28">Amount $</th>
                    <th className="w-20">O&amp;P</th>
                    <th className="w-20">Tax</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {ws.directCosts.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <input
                          className="input !border-transparent !bg-transparent"
                          placeholder="e.g. Switchgear quote — ACME Supply"
                          value={c.description}
                          onChange={(e) =>
                            ws.upsertDirectCost({ ...c, description: e.target.value })
                          }
                        />
                      </td>
                      <td>
                        <select
                          className="input !border-transparent !bg-transparent text-xs"
                          value={c.category}
                          onChange={(e) =>
                            ws.upsertDirectCost({
                              ...c,
                              category: e.target.value as DirectCostCategory,
                            })
                          }
                        >
                          {CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <AmountCell
                          value={c.amount}
                          onCommit={(v) => ws.upsertDirectCost({ ...c, amount: v })}
                        />
                      </td>
                      <td>
                        <label
                          className="flex cursor-pointer items-center gap-1 text-[10.5px] text-[var(--color-fg-dim)]"
                          title="Charge overhead and profit on this amount"
                        >
                          <input
                            type="checkbox"
                            checked={c.ohp_applies}
                            onChange={(e) =>
                              ws.upsertDirectCost({ ...c, ohp_applies: e.target.checked })
                            }
                          />
                          {c.ohp_applies ? "marked up" : "at cost"}
                        </label>
                      </td>
                      <td>
                        <label
                          className="flex cursor-pointer items-center gap-1 text-[10.5px] text-[var(--color-fg-dim)]"
                          title="Add sales tax to this amount at the project rate"
                        >
                          <input
                            type="checkbox"
                            data-testid="cost-taxable"
                            checked={c.taxable}
                            onChange={(e) =>
                              ws.upsertDirectCost({ ...c, taxable: e.target.checked })
                            }
                          />
                          {c.taxable ? "taxed" : "no tax"}
                        </label>
                      </td>
                      <td>
                        <button
                          className="btn btn-danger !border-transparent !px-1 !py-0 text-xs"
                          onClick={() => ws.deleteDirectCost(c.id)}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                  {ws.directCosts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-[var(--color-fg-faint)]">
                        Gear quotes, lighting packages, subcontractors, permits, equipment
                        rental, bonds — anything not coming from takeoff.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between border-b border-[color-mix(in_srgb,var(--color-line)_55%,transparent)] py-2 ${
        strong ? "text-base font-semibold" : "text-sm"
      }`}
    >
      <span className={strong ? "" : "text-[var(--color-fg-dim)]"}>{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

function Field({
  label,
  value,
  onCommit,
  hint,
  testId,
  percent,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  hint?: string;
  testId?: string;
  percent?: boolean;
}) {
  // 0.12 in a percent field almost always means 12%, and silently bidding
  // 0.12% low is invisible until the job is lost.
  const looksLikeFraction = percent && value > 0 && value < 1;
  return (
    <div className="mb-3">
      <label className="titlebar mb-1 block">{label}</label>
      <NumInput value={value} onCommit={onCommit} testId={testId} />
      {looksLikeFraction && (
        <div data-testid="pct-hint" className="mt-0.5 text-[10px] text-[var(--color-volt)]">
          {value} means {value}% — type {value * 100} for {value * 100}%
        </div>
      )}
      {hint && !looksLikeFraction && (
        <div className="mt-0.5 text-[10px] text-[var(--color-fg-faint)]">{hint}</div>
      )}
    </div>
  );
}

/** Commits parsed numbers while leaving intermediate text (like "-" or ".") editable. */
function NumInput({
  value,
  onCommit,
  testId,
}: {
  value: number;
  onCommit: (v: number) => void;
  testId?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      data-testid={testId}
      className="input input-num"
      value={text ?? String(value)}
      onFocus={() => setText(value === 0 ? "" : String(value))}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseNumericInput(e.target.value);
        if (v !== null) onCommit(v);
      }}
      onBlur={() => setText(null)}
    />
  );
}

function AmountCell({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      className="input input-num !border-transparent !bg-transparent"
      value={text ?? fmt(value)}
      onFocus={() => setText(value === 0 ? "" : String(value))}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text != null) {
          // Unreadable input keeps the previous amount. Committing 0 here once
          // turned a "$12 000" switchgear quote into $12 with no indication.
          const v = parseNumericInput(text);
          if (v !== null) onCommit(v);
        }
        setText(null);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}
