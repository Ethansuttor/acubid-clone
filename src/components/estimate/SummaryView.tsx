"use client";

// Bid summary: takeoff extension plus waste, sales tax, labor factoring and
// direct job costs, recalculating live, and the Excel export.

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileCheck2,
  History,
  ShieldCheck,
} from "lucide-react";
import { useWorkspace } from "@/store/workspace";
import {
  estimateTotals,
  extendEstimate,
  layerQuantities,
  summarize,
} from "@/lib/estimate";
import { exportToExcel } from "@/lib/excel";
import { bidPreflight, type BidPreflight, type PreflightCheck } from "@/lib/preflight";
import { fmt, parseNumericInput } from "@/lib/units";
import type { BidSnapshot, DirectCostCategory } from "@/lib/types";

const CATEGORIES: DirectCostCategory[] = [
  "quote",
  "subcontractor",
  "equipment",
  "permit",
  "bond",
  "other",
];

const SNAPSHOT_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default function SummaryView() {
  const ws = useWorkspace();
  const [exporting, setExporting] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  const project = ws.project;
  const estimate = useMemo(() => {
    if (!project) return null;
    const quantities = layerQuantities(ws.layers, ws.takeoffs, ws.sheets);
    const { lines, issues } = extendEstimate(
      quantities,
      ws.items,
      ws.assemblies,
      ws.assemblyItems
    );
    const summary = summarize({
      ...estimateTotals(lines),
      laborRate: project.labor_rate,
      wastePct: project.waste_pct,
      taxPct: project.tax_pct,
      laborFactorPct: project.labor_factor_pct,
      overheadPct: project.overhead_pct,
      profitPct: project.profit_pct,
      directCosts: ws.directCosts,
    });
    return {
      issues,
      summary,
      preflight: bidPreflight({
        project,
        sheets: ws.sheets,
        layers: ws.layers,
        takeoffs: ws.takeoffs,
        lines,
        issues,
        summary,
        directCosts: ws.directCosts,
        pendingWrites: ws.pendingWrites,
        saveState: ws.saveState,
      }),
    };
  }, [
    project,
    ws.sheets,
    ws.layers,
    ws.takeoffs,
    ws.items,
    ws.assemblies,
    ws.assemblyItems,
    ws.directCosts,
    ws.pendingWrites,
    ws.saveState,
  ]);

  if (!project || !estimate) return null;
  const activeProject = project;
  const { issues, summary: s, preflight } = estimate;

  async function doExport() {
    if (!preflight.ready) return;
    setExporting(true);
    try {
      await exportToExcel({
        project: activeProject,
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
      project_id: activeProject.id,
      user_id: ws.userId!,
      description: "",
      category: "quote",
      amount: 0,
      ohp_applies: true,
      sort_order: ws.directCosts.length,
    });
  }

  async function createSnapshot() {
    if (!preflight.ready || snapshotBusy) return;
    setSnapshotBusy(true);
    setSnapshotMessage(null);
    try {
      const { snapshot, error } = await ws.createBidSnapshot(snapshotLabel);
      if (error) {
        setSnapshotMessage({
          tone: "error",
          text: `Snapshot failed: ${error}`,
        });
      } else if (snapshot) {
        setSnapshotLabel("");
        setSnapshotMessage({
          tone: "success",
          text: `Revision ${snapshot.revision} saved as a locked local snapshot.`,
        });
      }
    } catch (error) {
      setSnapshotMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "The snapshot could not be saved.",
      });
    } finally {
      setSnapshotBusy(false);
    }
  }

  return (
    <div className="blueprint h-full overflow-auto">
      <div className="mx-auto max-w-5xl px-6 py-8">
        {issues.some((i) => i.severity === "missing") && (
          <div
            className="panel mb-4 border-l-2 !border-l-[var(--color-danger)] px-4 py-2 text-xs text-[var(--color-danger)]"
            role="alert"
          >
            <span className="font-mono uppercase tracking-widest">
              {issues.filter((i) => i.severity === "missing").length} layer(s) carry quantity
              that is missing from this bid
            </span>{" "}
            — see the Estimate tab.
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-6">
          <div className="panel w-full lg:w-72 shrink-0 self-start p-5">
            <div className="titlebar mb-4">Rates &amp; markups</div>
            <Field
              testId="labor-rate"
              label="Labor rate ($/hr)"
              value={activeProject.labor_rate}
              onCommit={(v) => ws.updateProject({ labor_rate: v })}
            />
            <Field
              testId="waste-pct"
              label="Material waste (%)"
              percent
              value={activeProject.waste_pct}
              onCommit={(v) => ws.updateProject({ waste_pct: v })}
            />
            <Field
              testId="tax-pct"
              label="Sales tax (%)"
              percent
              value={activeProject.tax_pct}
              onCommit={(v) => ws.updateProject({ tax_pct: v })}
            />
            <Field
              testId="labor-factor-pct"
              label="Labor factor (%)"
              percent
              hint="Job conditions: +15 costs 15% more hours"
              value={activeProject.labor_factor_pct}
              onCommit={(v) => ws.updateProject({ labor_factor_pct: v })}
            />
            <Field
              testId="overhead-pct"
              label="Overhead (%)"
              percent
              value={activeProject.overhead_pct}
              onCommit={(v) => ws.updateProject({ overhead_pct: v })}
            />
            <Field
              testId="profit-pct"
              label="Profit (%)"
              percent
              value={activeProject.profit_pct}
              onCommit={(v) => ws.updateProject({ profit_pct: v })}
            />
            <button
              className="btn btn-volt mt-6 w-full justify-center"
              onClick={doExport}
              disabled={exporting || !preflight.ready}
              title={
                !preflight.ready
                  ? "Resolve bid-readiness blockers before exporting to Excel"
                  : "Export complete estimate to Excel"
              }
            >
              {exporting
                ? "Exporting…"
                : !preflight.ready
                ? "Resolve blockers to export"
                : "Export to Excel"}
            </button>
            <div className="mt-2 text-[10.5px] text-[var(--color-fg-faint)]">
              Sheets: Takeoff · Material · Labor · Summary
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-4">
            <PreflightPanel preflight={preflight} />

            <div className="panel p-6">
              <div className="titlebar mb-4">Bid summary — {activeProject.name}</div>
              <Row label="Material from takeoff" value={`$${fmt(s.materialBase)}`} />
              {s.wastePct !== 0 && (
                <Row label={`Waste (${s.wastePct}%)`} value={`$${fmt(s.wasteAmount)}`} />
              )}
              {s.taxPct !== 0 && (
                <Row label={`Sales tax (${s.taxPct}%)`} value={`$${fmt(s.salesTax)}`} />
              )}
              <Row label="Material total" value={`$${fmt(s.materialTotal)}`} strong />
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
                strong
              />
              {s.directCostsWithOhp !== 0 && (
                <Row
                  label="Direct costs (O&P applies)"
                  value={`$${fmt(s.directCostsWithOhp)}`}
                />
              )}
              <Row label="Prime cost" value={`$${fmt(s.primeCost)}`} strong />
              <Row label={`Overhead (${s.overheadPct}%)`} value={`$${fmt(s.overhead)}`} />
              <Row label="Subtotal" value={`$${fmt(s.subtotal)}`} />
              <Row label={`Profit (${s.profitPct}%)`} value={`$${fmt(s.profit)}`} />
              {s.directCostsAtCost !== 0 && (
                <Row
                  label="Direct costs (at cost, no O&P)"
                  value={`$${fmt(s.directCostsAtCost)}`}
                />
              )}
              <div
                className="mt-3 flex items-baseline justify-between bg-[var(--color-ink-800)] px-3 py-3"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
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

            <RevisionHistory
              snapshots={ws.snapshots}
              label={snapshotLabel}
              onLabelChange={setSnapshotLabel}
              onCreate={createSnapshot}
              disabled={!preflight.ready || snapshotBusy}
              busy={snapshotBusy}
              message={snapshotMessage}
            />

            <div className="panel overflow-x-auto">
              <div className="titlebar flex items-center justify-between px-3 py-2">
                <span>Direct job costs ({ws.directCosts.length})</span>
                <button
                  className="btn !px-2 !py-0.5 text-xs"
                  onClick={addCost}
                  aria-label="+ Cost (Add direct job cost)"
                  title="Add direct job cost"
                >
                  + Cost
                </button>
              </div>
              <table className="tbl min-w-[500px] w-full">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="w-32">Category</th>
                    <th className="r w-28">Amount $</th>
                    <th className="w-20">O&amp;P</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {ws.directCosts.map((c) => (
                    <tr key={c.id} data-testid="direct-cost-row">
                      <td>
                        <input
                          data-testid="direct-cost-desc"
                          className="input !border-transparent !bg-transparent"
                          aria-label={`Description for direct cost ${c.description || "new cost"}`}
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
                          aria-label={`Category for ${c.description || "direct cost"}`}
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
                          testId="direct-cost-amount"
                          label={`Amount for ${c.description || "direct cost"}`}
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
                            data-testid="direct-cost-ohp"
                            type="checkbox"
                            checked={c.ohp_applies}
                            aria-label={`Charge overhead and profit on ${c.description || "direct cost"}`}
                            onChange={(e) =>
                              ws.upsertDirectCost({ ...c, ohp_applies: e.target.checked })
                            }
                          />
                          {c.ohp_applies ? "marked up" : "at cost"}
                        </label>
                      </td>
                      <td>
                        <button
                          className="btn btn-danger !border-transparent !px-1 !py-0 text-xs"
                          aria-label={`Delete ${c.description || "direct cost"}`}
                          onClick={() => ws.deleteDirectCost(c.id)}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                  {ws.directCosts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-[var(--color-fg-faint)]">
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

function PreflightPanel({ preflight }: { preflight: BidPreflight }) {
  const tone = preflight.ready ? "success" : "danger";
  return (
    <section
      className={`panel mb-4 overflow-hidden border-l-2 ${
        preflight.ready
          ? "!border-l-[var(--color-success)]"
          : "!border-l-[var(--color-danger)]"
      }`}
      aria-labelledby="bid-preflight-heading"
      data-testid="bid-preflight"
    >
      <div className="flex items-start justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`mt-0.5 grid size-8 shrink-0 place-items-center border ${
              preflight.ready
                ? "border-[var(--color-success)] text-[var(--color-success)]"
                : "border-[var(--color-danger)] text-[var(--color-danger)]"
            }`}
          >
            {preflight.ready ? <ShieldCheck size={17} /> : <AlertTriangle size={17} />}
          </span>
          <div>
            <h2 id="bid-preflight-heading" className="text-sm font-semibold">
              {preflight.ready ? "Ready to issue" : "Bid is not ready to issue"}
            </h2>
            <p className="mt-0.5 text-xs leading-5 text-[var(--color-fg-dim)]">
              {preflight.ready
                ? preflight.warnings.length > 0
                  ? `${preflight.warnings.length} advisory ${preflight.warnings.length === 1 ? "item remains" : "items remain"}; no issue blocks a revision or export.`
                  : "All required checks pass. You can lock a revision or export the estimate."
                : `${preflight.blockers.length} ${preflight.blockers.length === 1 ? "blocker must" : "blockers must"} be resolved before a revision or export can be created.`}
            </p>
          </div>
        </div>
        <span
          className={`shrink-0 border px-2 py-1 font-mono text-[10px] uppercase tracking-widest ${
            tone === "success"
              ? "border-[var(--color-success)] text-[var(--color-success)]"
              : "border-[var(--color-danger)] text-[var(--color-danger)]"
          }`}
        >
          {preflight.blockers.length} {preflight.blockers.length === 1 ? "blocker" : "blockers"} · {preflight.warnings.length} {preflight.warnings.length === 1 ? "warning" : "warnings"}
        </span>
      </div>

      {preflight.checks.length > 0 && (
        <div className="border-t border-[var(--color-line)] bg-[color-mix(in_srgb,var(--color-ink-950)_62%,transparent)]">
          {preflight.checks.map((check: PreflightCheck) => (
            <div
              key={check.id}
              data-testid={`preflight-check-${check.id}`}
              className="flex gap-3 border-b border-[color-mix(in_srgb,var(--color-line)_55%,transparent)] px-4 py-2.5 last:border-b-0"
            >
              {check.severity === "blocker" ? (
                <AlertTriangle
                  data-testid="preflight-blocker"
                  className="mt-0.5 shrink-0 text-[var(--color-danger)]"
                  size={14}
                />
              ) : (
                <Clock3
                  data-testid="preflight-warning"
                  className="mt-0.5 shrink-0 text-[var(--color-volt)]"
                  size={14}
                />
              )}
              <div className="min-w-0">
                <div className="text-xs font-semibold">{check.title}</div>
                <div className="mt-0.5 text-[11px] leading-4 text-[var(--color-fg-dim)]">
                  {check.detail}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RevisionHistory({
  snapshots,
  label,
  onLabelChange,
  onCreate,
  disabled,
  busy,
  message,
}: {
  snapshots: BidSnapshot[];
  label: string;
  onLabelChange: (value: string) => void;
  onCreate: () => void;
  disabled: boolean;
  busy: boolean;
  message: { tone: "success" | "error"; text: string } | null;
}) {
  return (
    <section className="panel" aria-labelledby="revision-history-heading">
      <div className="titlebar flex items-center justify-between px-3 py-2">
        <span id="revision-history-heading" className="flex items-center gap-2">
          <History size={13} /> Bid revisions
        </span>
        <span>{snapshots.length}</span>
      </div>
      <div className="grid gap-3 border-b border-[var(--color-line)] p-4 sm:grid-cols-[1fr_auto]">
        <div>
          <label htmlFor="snapshot-label" className="mb-1 block text-xs font-medium">
            Revision label <span className="text-[var(--color-fg-faint)]">(optional)</span>
          </label>
          <input
            id="snapshot-label"
            data-testid="snapshot-label-input"
            className="input"
            value={label}
            maxLength={80}
            placeholder="Base bid, Addendum 2, VE option…"
            onChange={(event) => onLabelChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !disabled) onCreate();
            }}
          />
        </div>
        <button
          className="btn btn-volt self-end justify-center"
          type="button"
          data-testid="create-snapshot-btn"
          disabled={disabled}
          onClick={onCreate}
          title={
            disabled && !busy
              ? "Resolve bid-readiness blockers before creating a snapshot"
              : "Capture an immutable local revision"
          }
        >
          <FileCheck2 size={14} /> {busy ? "Locking…" : "Create bid snapshot"}
        </button>
        <p className="text-[10.5px] leading-4 text-[var(--color-fg-faint)] sm:col-span-2">
          A snapshot captures the complete local estimate, commercial inputs, readiness checks,
          and bid total. It is never updated when the working estimate changes.
        </p>
        {message && (
          <div
            data-testid="snapshot-status"
            className={`text-xs sm:col-span-2 ${
              message.tone === "success"
                ? "text-[var(--color-success)]"
                : "text-[var(--color-danger)]"
            }`}
            role="status"
            aria-live="polite"
          >
            {message.tone === "success" && (
              <CheckCircle2 className="mr-1 inline" size={13} />
            )}
            {message.text}
          </div>
        )}
      </div>

      <div className="divide-y divide-[var(--color-line)]">
        {snapshots.map((snapshot) => (
          <article
            key={snapshot.id}
            data-testid={`revision-item-${snapshot.revision}`}
            className="flex items-center justify-between gap-4 px-4 py-3 [content-visibility:auto]"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  data-testid="revision-badge"
                  className="border border-[var(--color-line-strong)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-volt)]"
                >
                  R{snapshot.revision}
                </span>
                <span className="truncate text-xs font-semibold">
                  {snapshot.label || "Unlabeled revision"}
                </span>
              </div>
              <div className="mt-1 font-mono text-[10px] text-[var(--color-fg-faint)]">
                {formatSnapshotDate(snapshot.created_at)} · {fmt(snapshot.labor_hours_total)} hr · {snapshot.warning_count} {snapshot.warning_count === 1 ? "warning" : "warnings"}
              </div>
            </div>
            <span
              data-testid="revision-price"
              className="num shrink-0 text-base font-semibold text-[var(--color-fg)]"
            >
              ${fmt(snapshot.bid_price)}
            </span>
          </article>
        ))}
        {snapshots.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-[var(--color-fg-faint)]">
            No issued revisions yet. Resolve any blockers, then lock the first bid snapshot.
          </div>
        )}
      </div>
    </section>
  );
}

function formatSnapshotDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return SNAPSHOT_DATE_FORMATTER.format(date);
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
  const inputId = testId ? `field-${testId}` : `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="mb-3">
      <label htmlFor={inputId} className="titlebar mb-1 block">
        {label}
      </label>
      <NumInput
        id={inputId}
        ariaLabel={label}
        value={value}
        onCommit={onCommit}
        testId={testId}
      />
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
  id,
  ariaLabel,
  value,
  onCommit,
  testId,
}: {
  id?: string;
  ariaLabel?: string;
  value: number;
  onCommit: (v: number) => void;
  testId?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      id={id}
      aria-label={ariaLabel}
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

function AmountCell({
  label,
  value,
  onCommit,
  testId,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  testId?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      data-testid={testId}
      className="input input-num !border-transparent !bg-transparent"
      aria-label={label}
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
