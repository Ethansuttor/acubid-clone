"use client";

// Extended estimate: every takeoff layer expanded to item lines with
// material cost and labor hours, live from the takeoff. Warnings surface
// unlinked layers and uncalibrated sheets instead of hiding them.

import { useWorkspace } from "@/store/workspace";
import {
  estimateTotals,
  extendEstimate,
  layerQuantities,
  materialRollup,
} from "@/lib/estimate";
import { fmt, fmtQty } from "@/lib/units";

export default function EstimateView() {
  const ws = useWorkspace();
  const quantities = layerQuantities(ws.layers, ws.takeoffs, ws.sheets);
  const lines = extendEstimate(quantities, ws.items, ws.assemblies, ws.assemblyItems);
  const rollup = materialRollup(lines);
  const totals = estimateTotals(lines);

  const unlinked = quantities.filter((q) => q.quantity > 0 && !q.layer.item_id && !q.layer.assembly_id);
  const uncal = quantities.filter((q) => q.needsCalibration);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {(unlinked.length > 0 || uncal.length > 0) && (
        <div className="border-b border-[var(--color-line)] bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] px-4 py-2 text-xs text-[var(--color-danger)]">
          {unlinked.length > 0 && (
            <div>
              Not in estimate — layers without an item/assembly link:{" "}
              {unlinked.map((q) => q.layer.name).join(", ")}
            </div>
          )}
          {uncal.length > 0 && (
            <div>
              Missing quantities — takeoff on uncalibrated sheets:{" "}
              {uncal.map((q) => q.layer.name).join(", ")}
            </div>
          )}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-5">
        <div className="col-span-3 flex min-h-0 flex-col border-r border-[var(--color-line)]">
          <div className="titlebar px-3 py-2">Estimate detail (by layer)</div>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Layer</th>
                  <th>Item</th>
                  <th className="r">Takeoff</th>
                  <th className="r">Per</th>
                  <th className="r">Qty</th>
                  <th>Unit</th>
                  <th className="r">Ext Mat $</th>
                  <th className="r">Ext Hrs</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap">
                      {i === 0 || lines[i - 1].layerId !== l.layerId ? (
                        <>
                          {l.layerName}
                          {l.assembly && (
                            <span className="ml-1 text-[10px] text-[var(--color-ai)]">
                              {l.assembly.name}
                            </span>
                          )}
                        </>
                      ) : (
                        ""
                      )}
                    </td>
                    <td>
                      <span className="font-mono text-xs text-[var(--color-fg-dim)]">{l.item.code}</span>{" "}
                      {l.item.description}
                    </td>
                    <td className="num r">{fmtQty(l.takeoffQty)}</td>
                    <td className="num r">{l.perUnit === 1 ? "" : `×${fmtQty(l.perUnit)}`}</td>
                    <td className="num r">{fmtQty(l.itemQty)}</td>
                    <td>{l.item.unit}</td>
                    <td className="num r">{fmt(l.materialCost)}</td>
                    <td className="num r">{fmt(l.laborHours)}</td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-[var(--color-fg-faint)]">
                      No estimate lines yet. Take off quantities on layers linked to items or
                      assemblies.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-8 border-t border-[var(--color-line)] px-4 py-2 text-sm">
            <span>
              Material <span className="num text-[var(--color-volt)]">${fmt(totals.materialTotal)}</span>
            </span>
            <span>
              Labor <span className="num text-[var(--color-volt)]">{fmt(totals.laborHoursTotal)} hr</span>
            </span>
          </div>
        </div>

        <div className="col-span-2 flex min-h-0 flex-col">
          <div className="titlebar px-3 py-2">Material rollup (by item)</div>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="r">Qty</th>
                  <th>Unit</th>
                  <th className="r">$/Unit</th>
                  <th className="r">Ext $</th>
                  <th className="r">Hrs</th>
                </tr>
              </thead>
              <tbody>
                {rollup.map((r) => (
                  <tr key={r.item.id}>
                    <td>
                      <span className="font-mono text-xs text-[var(--color-fg-dim)]">{r.item.code}</span>{" "}
                      {r.item.description}
                    </td>
                    <td className="num r">{fmtQty(r.quantity)}</td>
                    <td>{r.item.unit}</td>
                    <td className="num r">{fmt(r.item.material_cost)}</td>
                    <td className="num r">{fmt(r.materialCost)}</td>
                    <td className="num r">{fmt(r.laborHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
