"use client";

// Excel export: four sheets — Takeoff detail, Material, Labor, Summary.
// All figures come from lib/estimate.ts (the single source of truth);
// this module only formats.

import ExcelJS from "exceljs";
import {
  countableTakeoffs,
  estimateTotals,
  extendEstimate,
  layerQuantities,
  materialRollup,
  money,
  summarize,
  type EstimateSummary,
} from "./estimate";
import { takeoffQuantity } from "./geometry";
import type { Assembly, AssemblyItem, Item, Layer, Project, Sheet, Takeoff } from "./types";

const UNIT: Record<string, string> = { count: "EA", linear: "FT", area: "SF" };

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1A232E" },
};
const HEADER_FONT = { bold: true, color: { argb: "FFFFB224" } };

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((c) => {
    c.fill = HEADER_FILL;
    c.font = HEADER_FONT;
  });
}

export function buildWorkbook(data: {
  project: Project;
  sheets: Sheet[];
  layers: Layer[];
  takeoffs: Takeoff[];
  items: Item[];
  assemblies: Assembly[];
  assemblyItems: AssemblyItem[];
}): { wb: ExcelJS.Workbook; summary: EstimateSummary } {
  const { project, sheets, layers, takeoffs, items, assemblies, assemblyItems } = data;
  const quantities = layerQuantities(layers, takeoffs, sheets);
  const lines = extendEstimate(quantities, items, assemblies, assemblyItems);
  const rollup = materialRollup(lines);
  const totals = estimateTotals(lines);
  const summary = summarize({
    ...totals,
    laborRate: project.labor_rate,
    overheadPct: project.overhead_pct,
    profitPct: project.profit_pct,
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Voltline";

  // --- Takeoff detail: one row per layer per sheet -------------------------
  const tk = wb.addWorksheet("Takeoff");
  tk.columns = [
    { header: "Layer", key: "layer", width: 28 },
    { header: "Sheet", key: "sheet", width: 22 },
    { header: "Tool", key: "tool", width: 8 },
    { header: "Objects", key: "objects", width: 9 },
    { header: "Quantity", key: "qty", width: 12 },
    { header: "Unit", key: "unit", width: 6 },
    { header: "Linked to", key: "link", width: 34 },
  ];
  styleHeader(tk.getRow(1));
  const sheetById = new Map(sheets.map((s) => [s.id, s]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const asmById = new Map(assemblies.map((a) => [a.id, a]));
  for (const layer of layers) {
    const bySheet = new Map<string, { objects: number; qty: number }>();
    for (const t of countableTakeoffs(takeoffs)) {
      if (t.layer_id !== layer.id) continue;
      const sh = sheetById.get(t.sheet_id);
      if (!sh) continue;
      const q = takeoffQuantity(t, sh, layer);
      if (q == null) continue;
      const cur = bySheet.get(t.sheet_id) ?? { objects: 0, qty: 0 };
      cur.objects += 1;
      cur.qty += q;
      bySheet.set(t.sheet_id, cur);
    }
    const link = layer.item_id
      ? itemById.get(layer.item_id)?.description ?? ""
      : layer.assembly_id
      ? `[ASM] ${asmById.get(layer.assembly_id)?.name ?? ""}`
      : "(unlinked)";
    for (const [sheetId, agg] of bySheet) {
      tk.addRow({
        layer: layer.name,
        sheet: sheetById.get(sheetId)?.name ?? "",
        tool: layer.tool,
        objects: agg.objects,
        qty: money(agg.qty),
        unit: UNIT[layer.tool],
        link,
      });
    }
  }

  // --- Material -------------------------------------------------------------
  const mat = wb.addWorksheet("Material");
  mat.columns = [
    { header: "Code", key: "code", width: 12 },
    { header: "Description", key: "desc", width: 40 },
    { header: "Qty", key: "qty", width: 12 },
    { header: "Unit", key: "unit", width: 6 },
    { header: "Cost/Unit", key: "unitCost", width: 12 },
    { header: "Ext Cost", key: "ext", width: 14 },
  ];
  styleHeader(mat.getRow(1));
  for (const r of rollup) {
    mat.addRow({
      code: r.item.code,
      desc: r.item.description,
      qty: money(r.quantity),
      unit: r.item.unit,
      unitCost: r.item.material_cost,
      ext: money(r.materialCost),
    });
  }
  const matTotal = mat.addRow({ desc: "MATERIAL TOTAL", ext: money(totals.materialTotal) });
  matTotal.font = { bold: true };
  mat.getColumn("unitCost").numFmt = "#,##0.00";
  mat.getColumn("ext").numFmt = "#,##0.00";

  // --- Labor ------------------------------------------------------------------
  const lab = wb.addWorksheet("Labor");
  lab.columns = [
    { header: "Code", key: "code", width: 12 },
    { header: "Description", key: "desc", width: 40 },
    { header: "Qty", key: "qty", width: 12 },
    { header: "Unit", key: "unit", width: 6 },
    { header: "Hr/Unit", key: "unitHr", width: 10 },
    { header: "Ext Hours", key: "ext", width: 12 },
  ];
  styleHeader(lab.getRow(1));
  for (const r of rollup) {
    lab.addRow({
      code: r.item.code,
      desc: r.item.description,
      qty: money(r.quantity),
      unit: r.item.unit,
      unitHr: r.item.labor_hours,
      ext: money(r.laborHours),
    });
  }
  const labTotal = lab.addRow({ desc: "LABOR HOURS TOTAL", ext: money(totals.laborHoursTotal) });
  labTotal.font = { bold: true };
  lab.getColumn("unitHr").numFmt = "#,##0.000";
  lab.getColumn("ext").numFmt = "#,##0.00";

  // --- Summary ------------------------------------------------------------------
  const sum = wb.addWorksheet("Summary");
  // No sum.columns here: ExcelJS would emit an (empty) header row and shift
  // every styled row down by one. Set widths directly and add array rows.
  sum.getColumn(1).width = 34;
  sum.getColumn(2).width = 18;
  const rows: [string, number | string][] = [
    [`Project: ${project.name}`, ""],
    ["", ""],
    ["Material total ($)", money(summary.materialTotal)],
    ["Labor hours", money(summary.laborHoursTotal)],
    [`Labor rate ($/hr)`, summary.laborRate],
    ["Labor cost ($)", money(summary.laborCost)],
    ["Prime cost ($)", money(summary.primeCost)],
    [`Overhead (${summary.overheadPct}%)`, money(summary.overhead)],
    ["Subtotal ($)", money(summary.subtotal)],
    [`Profit (${summary.profitPct}%)`, money(summary.profit)],
    ["BID PRICE ($)", money(summary.bidPrice)],
  ];
  for (const [k, v] of rows) sum.addRow([k, v]);
  sum.getRow(1).font = { bold: true, size: 14 };
  const bidRow = sum.getRow(rows.length);
  bidRow.font = { bold: true, size: 12, color: { argb: "FFB97E17" } };
  sum.getColumn(2).numFmt = "#,##0.00";

  return { wb, summary };
}

export async function exportToExcel(data: Parameters<typeof buildWorkbook>[0]) {
  const { wb } = buildWorkbook(data);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${data.project.name.replace(/[^\w.-]+/g, "_")}_estimate.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
}
