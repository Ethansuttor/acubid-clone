"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, FileText, Layers3, Plus, Printer, Trash2 } from "lucide-react";
import { estimateTotals, extendEstimate, layerQuantities, summarize } from "@/lib/estimate";
import { bidPreflight } from "@/lib/preflight";
import { fmt, parseNumericInput } from "@/lib/units";
import { useWorkspace } from "@/store/workspace";
import type { ProposalEntry, ProposalEntryKind } from "@/lib/types";

const KINDS: ProposalEntryKind[] = ["inclusion", "exclusion", "allowance", "alternate"];

export default function ScopeView() {
  const ws = useWorkspace();
  const project = ws.project;
  const [activeKind, setActiveKind] = useState<ProposalEntryKind>("inclusion");

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
      laborBurdenPct: project.labor_burden_pct,
      smallToolsPct: project.small_tools_pct,
      contingencyPct: project.contingency_pct,
      escalationPct: project.escalation_pct,
      bondPct: project.bond_pct,
      directCosts: ws.directCosts,
    });
    return {
      bidPrice: summary.bidPrice,
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

  if (!project || !ws.userId || !estimate) return null;

  const { bidPrice, preflight } = estimate;

  function addEntry(kind: ProposalEntryKind) {
    const entry: ProposalEntry = {
      id: crypto.randomUUID(),
      project_id: project!.id,
      user_id: ws.userId!,
      kind,
      description: "",
      amount: 0,
      pricing_note: "",
      sort_order: ws.proposalEntries.length,
    };
    ws.upsertProposalEntry(entry);
    setActiveKind(kind);
  }

  const activeEntries = ws.proposalEntries.filter((entry) => entry.kind === activeKind);
  return (
    <div className="blueprint h-full overflow-auto">
      <div className="mx-auto max-w-[1400px] px-5 py-5">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold tracking-[-0.02em]">Scope and proposal</h1>
          </div>
          <button
            className="btn"
            type="button"
            onClick={() => {
              if (preflight.ready) window.print();
            }}
            disabled={!preflight.ready}
            aria-describedby={!preflight.ready ? "proposal-print-gate" : undefined}
            data-testid="print-proposal-btn"
          >
            <Printer size={14} />
            {preflight.ready ? "Print proposal" : "Resolve blockers to print"}
          </button>
        </div>

        {!preflight.ready && (
          <section
            id="proposal-print-gate"
            className="proposal-print panel mb-5 border-l-2 !border-l-[var(--color-danger)] bg-white px-5 py-4 text-slate-950"
            role="alert"
            aria-labelledby="proposal-print-gate-heading"
            data-testid="proposal-print-gate"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 shrink-0 text-[var(--color-danger)]" size={18} />
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-danger)]">
                  Not ready to issue
                </div>
                <h2 id="proposal-print-gate-heading" className="mt-1 text-sm font-semibold">
                  Proposal printing is blocked
                </h2>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  {project.name} has {preflight.blockers.length}{" "}
                  {preflight.blockers.length === 1 ? "bid blocker" : "bid blockers"}. Resolve
                  them in Summary before printing or issuing this proposal.
                </p>
                <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-slate-700">
                  {preflight.blockers.map((blocker) => (
                    <li key={blocker.id}>{blocker.title}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.62fr)]">
          <div className="min-w-0 space-y-5 print:hidden">
            <section className="panel overflow-hidden" aria-labelledby="breakdown-heading">
              <div className="titlebar flex items-center gap-2 px-3 py-2" id="breakdown-heading">
                <Layers3 size={13} /> Takeoff breakdown
              </div>
              <div className="overflow-x-auto">
                <table className="tbl min-w-[680px] w-full">
                  <thead>
                    <tr><th>Layer</th><th>Area</th><th>System</th><th>Phase</th></tr>
                  </thead>
                  <tbody>
                    {ws.layers.map((layer) => (
                      <tr key={layer.id}>
                        <td className="text-xs font-medium">{layer.name}</td>
                        {(["area", "system", "phase"] as const).map((dimension) => (
                          <td key={dimension}>
                            <input
                              className="input !border-transparent !bg-transparent text-xs"
                              value={layer[dimension] ?? ""}
                              placeholder="Unassigned"
                              aria-label={`${dimension} for ${layer.name}`}
                              onChange={(event) => ws.updateLayer(layer.id, { [dimension]: event.target.value })}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                    {ws.layers.length === 0 && (
                      <tr><td colSpan={4} className="py-5 text-center text-[var(--color-fg-faint)]">Create takeoff layers first; they will appear here for classification.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel overflow-hidden" aria-labelledby="commercial-scope-heading">
              <div className="titlebar flex items-center justify-between gap-3 px-3 py-2">
                <span id="commercial-scope-heading" className="flex items-center gap-2"><FileText size={13} /> Commercial scope</span>
                <button className="btn !px-2 !py-0.5 text-xs" onClick={() => addEntry(activeKind)}><Plus size={12} /> Add {activeKind}</button>
              </div>
              <div className="flex overflow-x-auto border-b border-[var(--color-line)] p-2">
                {KINDS.map((kind) => (
                  <button
                    key={kind}
                    className={`tab capitalize ${activeKind === kind ? "active" : ""}`}
                    onClick={() => setActiveKind(kind)}
                  >
                    {kind}s <span className="ml-1 text-[10px]">{ws.proposalEntries.filter((entry) => entry.kind === kind).length}</span>
                  </button>
                ))}
              </div>
              <div className="divide-y divide-[var(--color-line)]">
                {activeEntries.map((entry) => (
                  <ProposalEntryEditor key={entry.id} entry={entry} />
                ))}
                {activeEntries.length === 0 && (
                  <div className="px-4 py-8 text-center text-xs text-[var(--color-fg-faint)]">
                    No {activeKind}s yet. Add the exact language you want shown on the proposal.
                  </div>
                )}
              </div>
              {(activeKind === "allowance" || activeKind === "alternate") && (
                <p className="border-t border-[var(--color-line)] px-4 py-3 text-[10.5px] leading-4 text-[var(--color-volt)]">
                  These amounts are shown separately and do not change the base bid. Put an amount
                  in Direct Job Costs when it belongs in the base estimate; this avoids double counting.
                </p>
              )}
            </section>
          </div>

          <ProposalPreview
            projectName={project.name}
            bidPrice={bidPrice}
            entries={ws.proposalEntries}
            printable={preflight.ready}
          />
        </div>
      </div>
    </div>
  );
}

function ProposalEntryEditor({ entry }: { entry: ProposalEntry }) {
  const ws = useWorkspace();
  const showAmount = entry.kind === "allowance" || entry.kind === "alternate";
  const [amountText, setAmountText] = useState<string | null>(null);
  return (
    <div className="grid gap-2 p-3 sm:grid-cols-[1fr_130px_34px]" data-testid={`proposal-entry-${entry.kind}`}>
      <div className="grid gap-2">
        <input
          className="input"
          value={entry.description}
          placeholder={`${entry.kind[0].toUpperCase()}${entry.kind.slice(1)} description`}
          aria-label={`${entry.kind} description`}
          onChange={(event) => ws.upsertProposalEntry({ ...entry, description: event.target.value })}
        />
        <input
          className="input text-xs"
          value={entry.pricing_note}
          placeholder="Clarification or pricing note (optional)"
          aria-label={`${entry.kind} pricing note`}
          onChange={(event) => ws.upsertProposalEntry({ ...entry, pricing_note: event.target.value })}
        />
      </div>
      {showAmount ? (
        <label className="text-[11px] text-[var(--color-fg-dim)]">
          Reference amount
          <input
            className="input input-num mt-1"
            value={amountText ?? fmt(entry.amount)}
            aria-label={`${entry.kind} amount`}
            onFocus={() => setAmountText(entry.amount === 0 ? "" : String(entry.amount))}
            onChange={(event) => setAmountText(event.target.value)}
            onBlur={() => {
              const parsed = amountText == null ? null : parseNumericInput(amountText);
              if (parsed !== null) ws.upsertProposalEntry({ ...entry, amount: parsed });
              setAmountText(null);
            }}
          />
        </label>
      ) : <span />}
      <button className="icon-button danger self-start" aria-label={`Delete ${entry.kind}`} onClick={() => ws.deleteProposalEntry(entry.id)}><Trash2 size={14} /></button>
    </div>
  );
}

function ProposalPreview({
  projectName,
  bidPrice,
  entries,
  printable,
}: {
  projectName: string;
  bidPrice: number;
  entries: ProposalEntry[];
  printable: boolean;
}) {
  return (
    <article
      className={`${printable ? "proposal-print " : ""}panel self-start bg-white p-7 text-slate-950 shadow-xl`}
      aria-labelledby="proposal-preview-heading"
      data-testid="proposal-preview"
    >
      <div className="border-b-2 border-slate-900 pb-5">
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-amber-700">Voltline proposal</div>
        <h2 id="proposal-preview-heading" className="mt-2 text-2xl font-bold">{projectName}</h2>
        <div className="mt-5 flex items-end justify-between gap-4">
          <span className="text-sm text-slate-600">Base bid</span>
          <span className="font-mono text-2xl font-bold">${fmt(bidPrice)}</span>
        </div>
      </div>
      {KINDS.map((kind) => {
        const rows = entries.filter((entry) => entry.kind === kind && entry.description.trim());
        if (rows.length === 0) return null;
        return (
          <section key={kind} className="mt-6 break-inside-avoid">
            <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{kind}s</h3>
            <div className="mt-2 divide-y divide-slate-200 border-y border-slate-200">
              {rows.map((entry) => (
                <div key={entry.id} className="py-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <span>{entry.description}</span>
                    {(kind === "allowance" || kind === "alternate") && (
                      <span className="shrink-0 font-mono font-semibold">${fmt(entry.amount)}</span>
                    )}
                  </div>
                  {entry.pricing_note && <p className="mt-1 text-xs text-slate-500">{entry.pricing_note}</p>}
                </div>
              ))}
            </div>
          </section>
        );
      })}
      <p className="mt-8 border-t border-slate-300 pt-3 text-[10px] leading-4 text-slate-500">
        Allowances and alternates are listed separately unless their description explicitly states
        they are included in the base bid.
      </p>
    </article>
  );
}
