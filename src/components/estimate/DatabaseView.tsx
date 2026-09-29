"use client";

// User-editable item database and assembly builder. Items carry material
// cost and labor hours per unit; assemblies expand into component items.

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ShieldAlert } from "lucide-react";
import { useWorkspace } from "@/store/workspace";
import { fmt, parseNumericInput } from "@/lib/units";
import { assemblyUsage, itemUsage } from "@/lib/estimate";
import {
  diagnoseCatalog,
  type CatalogDiagnosticsReport,
} from "@/lib/catalogDiagnostics";
import {
  assembliesToCsv,
  itemsToCsv,
  mergeAssemblies,
  mergeItems,
  parseAssembliesCsv,
  parseItemsCsv,
} from "@/lib/csv";
import type { Assembly, AssemblyItem, Item } from "@/lib/types";

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function DatabaseView() {
  const ws = useWorkspace();
  const [selAsm, setSelAsm] = useState<string | null>(null);
  const [report, setReport] = useState<{ ok: string; errors: string[] } | null>(null);
  const assembly = ws.assemblies.find((a) => a.id === selAsm) ?? null;
  const diagnostics = useMemo(
    () => diagnoseCatalog(ws.items, ws.assemblies, ws.assemblyItems),
    [ws.items, ws.assemblies, ws.assemblyItems]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CsvBar report={report} setReport={setReport} />
      <CatalogHealth report={diagnostics} />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        <div className="flex min-w-0 flex-1 lg:flex-[3] min-h-[380px] lg:min-h-0 flex-col border-b lg:border-b-0 lg:border-r border-[var(--color-line)]">
          <ItemsTable />
        </div>
        <div className="flex min-w-0 flex-1 lg:flex-[2] min-h-[320px] lg:min-h-0 flex-col sm:flex-row lg:flex-col">
          <AssembliesList selected={selAsm} onSelect={setSelAsm} />
          {assembly && <AssemblyEditor assembly={assembly} />}
        </div>
      </div>
    </div>
  );
}

function CatalogHealth({ report }: { report: CatalogDiagnosticsReport }) {
  const [expanded, setExpanded] = useState(false);
  const errors = report.issues.filter((issue) => issue.severity === "error");
  const warnings = report.issues.filter((issue) => issue.severity === "warning");
  const visibleIssues = [...errors, ...warnings].slice(0, 30);

  if (report.healthy) {
    return (
      <div
        className="flex items-center gap-2 border-b border-[var(--color-line)] bg-[color-mix(in_srgb,var(--color-ok)_7%,var(--color-ink-900))] px-3 py-2 text-xs text-[var(--color-ok)]"
        role="status"
        data-testid="catalog-health"
      >
        <CheckCircle2 size={14} aria-hidden="true" />
        Catalog checks pass. No duplicate codes, missing components, or unpriced items.
      </div>
    );
  }

  return (
    <section
      className="border-b border-[var(--color-line)] bg-[var(--color-ink-900)]"
      aria-labelledby="catalog-health-heading"
      data-testid="catalog-health"
    >
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        <span
          className={`grid size-7 place-items-center border ${
            errors.length > 0
              ? "border-[var(--color-danger)] text-[var(--color-danger)]"
              : "border-[var(--color-volt)] text-[var(--color-volt)]"
          }`}
          aria-hidden="true"
        >
          {errors.length > 0 ? <ShieldAlert size={14} /> : <AlertTriangle size={14} />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="catalog-health-heading" className="text-xs font-semibold">
            Catalog quality needs review
          </h2>
          <p className="mt-0.5 text-[10.5px] text-[var(--color-fg-dim)]">
            {errors.length} {errors.length === 1 ? "error" : "errors"} · {warnings.length}{" "}
            {warnings.length === 1 ? "warning" : "warnings"}. These checks do not change bid
            math; used-item problems are enforced again at bid preflight.
          </p>
        </div>
        <button
          className="btn !px-2 !py-1 text-xs"
          type="button"
          aria-expanded={expanded}
          aria-controls="catalog-health-details"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {expanded ? "Hide findings" : "Review findings"}
        </button>
      </div>

      {expanded && (
        <div id="catalog-health-details" className="max-h-56 overflow-auto border-t border-[var(--color-line)]">
          {visibleIssues.map((issue, index) => (
            <div
              key={`${issue.kind}-${issue.itemId ?? issue.assemblyId ?? issue.assemblyItemId ?? index}`}
              className="flex gap-3 border-b border-[color-mix(in_srgb,var(--color-line)_55%,transparent)] px-3 py-2 last:border-b-0 [content-visibility:auto]"
              data-testid={`catalog-issue-${issue.kind}`}
            >
              <AlertTriangle
                size={13}
                className={`mt-0.5 shrink-0 ${
                  issue.severity === "error"
                    ? "text-[var(--color-danger)]"
                    : "text-[var(--color-volt)]"
                }`}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <div className="text-xs font-medium">{issue.title}</div>
                <div className="mt-0.5 text-[10.5px] leading-4 text-[var(--color-fg-dim)]">
                  {issue.detail}
                </div>
              </div>
            </div>
          ))}
          {report.issues.length > visibleIssues.length && (
            <div className="px-3 py-2 text-[10.5px] text-[var(--color-fg-faint)]">
              Showing the first {visibleIssues.length} of {report.issues.length} findings. Export
              the catalog CSV for bulk cleanup.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Bulk load of the estimator's own labor units. Import is additive and
 * matches on code, so re-importing an updated price book keeps every layer
 * link intact. Rows that cannot be read are listed, never dropped quietly.
 */
function CsvBar({
  report,
  setReport,
}: {
  report: { ok: string; errors: string[] } | null;
  setReport: (r: { ok: string; errors: string[] } | null) => void;
}) {
  const ws = useWorkspace();
  const itemFile = useRef<HTMLInputElement>(null);
  const asmFile = useRef<HTMLInputElement>(null);

  async function importItems(file: File) {
    const { rows, errors } = parseItemsCsv(await file.text());
    if (rows.length === 0) {
      setReport({ ok: "Nothing imported", errors });
      return;
    }
    const { upserts, added, updated } = mergeItems(ws.items, rows, ws.userId!);
    for (const item of upserts) ws.upsertItem(item);
    setReport({ ok: `${added} item(s) added, ${updated} updated`, errors });
  }

  async function importAssemblies(file: File) {
    const { rows, errors } = parseAssembliesCsv(await file.text());
    if (rows.length === 0) {
      setReport({ ok: "Nothing imported", errors });
      return;
    }
    const merged = mergeAssemblies(ws.assemblies, rows, ws.items, ws.userId!);
    for (const a of merged.assemblies) ws.upsertAssembly(a);
    // Only rewrite the component list of assemblies the file fully described.
    // Replacing a good assembly with a partial one under-extends every takeoff
    // that uses it, so a file with an unknown item code changes nothing here.
    for (const a of merged.assemblies) {
      if (!merged.touched.has(a.id) || merged.incomplete.has(a.id)) continue;
      ws.setAssemblyItems(
        a.id,
        merged.components.filter((c) => c.assembly_id === a.id)
      );
    }
    setReport({
      ok: `${merged.added} assembly(s) added, ${merged.updated} updated`,
      errors: [...errors, ...merged.errors],
    });
  }

  return (
    <div className="panel border-x-0 border-t-0">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="titlebar mr-1">Bulk edit</span>
        <button
          className="btn !py-1 text-xs"
          onClick={() => download("voltline-items.csv", itemsToCsv(ws.items))}
        >
          ↓ Items CSV
        </button>
        <button className="btn !py-1 text-xs" onClick={() => itemFile.current?.click()}>
          ↑ Import items
        </button>
        <div className="mx-1 h-4 w-px bg-[var(--color-line)]" />
        <button
          className="btn !py-1 text-xs"
          onClick={() =>
            download(
              "voltline-assemblies.csv",
              assembliesToCsv(ws.assemblies, ws.assemblyItems, ws.items)
            )
          }
        >
          ↓ Assemblies CSV
        </button>
        <button className="btn !py-1 text-xs" onClick={() => asmFile.current?.click()}>
          ↑ Import assemblies
        </button>
        <span className="ml-2 text-[10.5px] text-[var(--color-fg-faint)]">
          Items: code, description, unit, material_cost, labor_hours · matched on code
        </span>
        {report && (
          <button className="btn ml-auto !py-1 text-xs" onClick={() => setReport(null)}>
            Dismiss
          </button>
        )}
      </div>
      <input
        ref={itemFile}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        aria-label="Import items CSV"
        data-testid="import-items"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importItems(f);
          e.target.value = "";
        }}
      />
      <input
        ref={asmFile}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        aria-label="Import assemblies CSV"
        data-testid="import-assemblies"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importAssemblies(f);
          e.target.value = "";
        }}
      />
      {report && (
        <div className="border-t border-[var(--color-line)] px-3 py-2 text-xs">
          <div data-testid="import-ok" className="text-[var(--color-ok)]" role="status" aria-live="polite">
            {report.ok}
          </div>
          {report.errors.length > 0 && (
            <div role="alert">
              {report.errors.map((err, i) => (
                <div key={i} data-testid="import-error" className="text-[var(--color-danger)]">
                  {err}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ItemsTable() {
  const ws = useWorkspace();

  function blank(): Item {
    return {
      id: crypto.randomUUID(),
      user_id: ws.userId!,
      code: "",
      description: "",
      unit: "EA",
      material_cost: 0,
      labor_hours: 0,
    };
  }

  function patch(item: Item, p: Partial<Item>) {
    ws.upsertItem({ ...item, ...p });
  }

  return (
    <>
      <div className="titlebar flex items-center justify-between px-3 py-2">
        <span>Item database ({ws.items.length})</span>
        <button className="btn !px-2 !py-0.5 text-xs" onClick={() => ws.upsertItem(blank())}>
          + Item
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="tbl min-w-[560px] w-full">
          <thead>
            <tr>
              <th className="w-28">Code</th>
              <th>Description</th>
              <th className="w-16">Unit</th>
              <th className="r w-28">Mat $ / unit</th>
              <th className="r w-28">Labor hr / unit</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {ws.items.map((it) => (
              <tr key={it.id}>
                <td>
                  <input
                    className="input !border-transparent !bg-transparent font-mono"
                    value={it.code}
                    placeholder="code"
                    aria-label={`Item code for ${it.description || "item"}`}
                    onChange={(e) => patch(it, { code: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="input !border-transparent !bg-transparent"
                    value={it.description}
                    placeholder="description"
                    aria-label={`Item description for ${it.code || "item"}`}
                    onChange={(e) => patch(it, { description: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="input !border-transparent !bg-transparent font-mono uppercase"
                    value={it.unit}
                    aria-label={`Unit of measure for ${it.description || it.code || "item"}`}
                    onChange={(e) => patch(it, { unit: e.target.value.toUpperCase() })}
                  />
                </td>
                <td>
                  <NumCell
                    value={it.material_cost}
                    ariaLabel={`Material cost per unit for ${it.description || it.code || "item"}`}
                    onCommit={(v) => patch(it, { material_cost: v })}
                  />
                </td>
                <td>
                  <NumCell
                    value={it.labor_hours}
                    dp={3}
                    ariaLabel={`Labor hours per unit for ${it.description || it.code || "item"}`}
                    onCommit={(v) => patch(it, { labor_hours: v })}
                  />
                </td>
                <td>
                  <button
                    className="btn btn-danger !border-transparent !px-1 !py-0 text-xs"
                    title="Delete item"
                    aria-label={`Delete item ${it.description || it.code || "item"}`}
                    onClick={() => {
                      const use = itemUsage(it.id, ws.assemblies, ws.assemblyItems, ws.layers);
                      const warn: string[] = [];
                      if (use.assemblies.length > 0) {
                        warn.push(
                          `It is a component of ${use.assemblies.length} assembly(s): ` +
                            `${use.assemblies.map((a) => a.name).join(", ")}. ` +
                            `Those assemblies will price lower from now on.`
                        );
                      }
                      if (use.layers.length > 0) {
                        warn.push(
                          `${use.layers.length} takeoff layer(s) are priced from it: ` +
                            `${use.layers.map((l) => l.name).join(", ")}.`
                        );
                      }
                      const msg = [`Delete item "${it.description || it.code}"?`, ...warn].join("\n\n");
                      if (confirm(msg)) ws.deleteItem(it.id);
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {ws.items.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-[var(--color-fg-faint)]">
                  Empty. Add items with your own material costs and labor units.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Numeric cell that keeps focus-friendly editing but commits parsed numbers. */
function NumCell({
  value,
  onCommit,
  dp = 2,
  ariaLabel,
}: {
  value: number;
  onCommit: (v: number) => void;
  dp?: number;
  ariaLabel?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      className="input input-num !border-transparent !bg-transparent"
      aria-label={ariaLabel}
      value={text ?? fmt(value, dp)}
      onFocus={() => setText(value === 0 ? "" : String(value))}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text != null) {
          // Unreadable input keeps the previous value rather than zeroing a price.
          const v = parseNumericInput(text);
          if (v !== null) onCommit(v);
        }
        setText(null);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function AssembliesList({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const ws = useWorkspace();

  function addAssembly() {
    const a: Assembly = {
      id: crypto.randomUUID(),
      user_id: ws.userId!,
      code: "",
      name: "New assembly",
      description: "",
    };
    ws.upsertAssembly(a);
    onSelect(a.id);
  }

  return (
    <div className="flex max-h-[40%] sm:max-h-none sm:w-64 lg:w-full lg:max-h-[40%] flex-col border-b sm:border-b-0 sm:border-r lg:border-b lg:border-r-0 border-[var(--color-line)]">
      <div className="titlebar flex items-center justify-between px-3 py-2">
        <span>Assemblies ({ws.assemblies.length})</span>
        <button className="btn !px-2 !py-0.5 text-xs" onClick={addAssembly}>
          + Assembly
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {ws.assemblies.map((a) => (
          <button
            key={a.id}
            onClick={() => onSelect(a.id)}
            className={`block w-full cursor-pointer border-l-2 px-3 py-1.5 text-left text-[13px] ${
              a.id === selected
                ? "border-[var(--color-volt)] bg-[var(--color-ink-800)]"
                : "border-transparent hover:bg-[var(--color-ink-850)]"
            }`}
          >
            <span className="font-mono text-xs text-[var(--color-fg-dim)]">{a.code || "—"}</span>{" "}
            {a.name}
          </button>
        ))}
        {ws.assemblies.length === 0 && (
          <div className="px-3 py-3 text-xs text-[var(--color-fg-faint)]">
            An assembly (e.g. a duplex receptacle) expands into its component items.
          </div>
        )}
      </div>
    </div>
  );
}

function AssemblyEditor({ assembly }: { assembly: Assembly }) {
  const ws = useWorkspace();
  const components = ws.assemblyItems.filter((ai) => ai.assembly_id === assembly.id);
  const itemById = new Map(ws.items.map((i) => [i.id, i]));

  function setComponents(rows: AssemblyItem[]) {
    ws.setAssemblyItems(assembly.id, rows);
  }

  function addComponent(itemId: string) {
    if (!itemId) return;
    setComponents([
      ...components,
      {
        id: crypto.randomUUID(),
        assembly_id: assembly.id,
        item_id: itemId,
        user_id: ws.userId!,
        quantity: 1,
      },
    ]);
  }

  const unitCost = components.reduce(
    (s, c) => s + (itemById.get(c.item_id)?.material_cost ?? 0) * c.quantity,
    0
  );
  const unitHrs = components.reduce(
    (s, c) => s + (itemById.get(c.item_id)?.labor_hours ?? 0) * c.quantity,
    0
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-3 py-2">
        <input
          className="input !w-24 font-mono"
          placeholder="code"
          aria-label="Assembly code"
          value={assembly.code}
          onChange={(e) => ws.upsertAssembly({ ...assembly, code: e.target.value })}
        />
        <input
          className="input flex-1"
          placeholder="Assembly name"
          aria-label="Assembly name"
          value={assembly.name}
          onChange={(e) => ws.upsertAssembly({ ...assembly, name: e.target.value })}
        />
        <button
          className="btn btn-danger !px-2 !py-1 text-xs"
          aria-label={`Delete assembly ${assembly.name || assembly.code || "assembly"}`}
          onClick={() => {
            const used = assemblyUsage(assembly.id, ws.layers);
            const msg =
              used.length > 0
                ? `Delete assembly "${assembly.name}"?\n\n${used.length} takeoff layer(s) are priced from it (${used
                    .map((l) => l.name)
                    .join(", ")}) and will drop out of the estimate until relinked.`
                : `Delete assembly "${assembly.name}"?`;
            if (confirm(msg)) ws.deleteAssembly(assembly.id);
          }}
        >
          Delete
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="tbl min-w-[280px] w-full">
          <thead>
            <tr>
              <th>Component item</th>
              <th className="r w-24">Qty / EA</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {components.map((c) => (
              <tr key={c.id}>
                <td>
                  {itemById.get(c.item_id)?.description ?? "?"}{" "}
                  <span className="text-[var(--color-fg-faint)]">
                    ({itemById.get(c.item_id)?.unit})
                  </span>
                </td>
                <td className="r">
                  <NumCell
                    value={c.quantity}
                    ariaLabel={`Quantity of ${itemById.get(c.item_id)?.description || "component"} per assembly`}
                    onCommit={(v) =>
                      setComponents(components.map((x) => (x.id === c.id ? { ...x, quantity: v } : x)))
                    }
                  />
                </td>
                <td>
                  <button
                    className="btn btn-danger !border-transparent !px-1 !py-0 text-xs"
                    aria-label={`Remove component ${itemById.get(c.item_id)?.description || "item"} from assembly`}
                    onClick={() => setComponents(components.filter((x) => x.id !== c.id))}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {components.length === 0 && (
              <tr>
                <td colSpan={3} className="py-6 text-center text-xs text-[var(--color-fg-faint)]">
                  No component items in this assembly. Select an item below to add components.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="p-3">
          <select
            className="input"
            value=""
            aria-label={`Add component item to ${assembly.name || "assembly"}`}
            onChange={(e) => addComponent(e.target.value)}
          >
            <option value="">+ add component item…</option>
            {ws.items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.code ? `${i.code} — ` : ""}{i.description}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="border-t border-[var(--color-line)] px-3 py-2 text-xs text-[var(--color-fg-dim)]">
        Per assembly: <span className="num text-[var(--color-volt)]">${fmt(unitCost)}</span> material,{" "}
        <span className="num text-[var(--color-volt)]">{fmt(unitHrs, 3)}</span> labor hr
      </div>
    </div>
  );
}
