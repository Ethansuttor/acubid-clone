// Estimate extension math. Pure functions: takeoffs + layers + item/assembly
// database in, extended material cost / labor hours / bid summary out.
// This module is the single source of truth for every dollar and hour figure
// shown in the UI and written to the Excel export.

import { takeoffQuantity } from "./geometry";
import type {
  Assembly,
  AssemblyItem,
  Item,
  Layer,
  Sheet,
  Takeoff,
} from "./types";

export interface LayerQuantity {
  layer: Layer;
  /** Sum of confirmed takeoff quantities (EA, FT, or SF by tool). */
  quantity: number;
  /** Number of takeoff objects included. */
  objects: number;
  /** True if any linear/area takeoff sits on an uncalibrated sheet. */
  needsCalibration: boolean;
}

export interface EstimateLine {
  layerId: string;
  layerName: string;
  /** Item this line extends (assembly components produce one line per item). */
  item: Item;
  /** Assembly context when the layer is linked to an assembly. */
  assembly: Assembly | null;
  /** Item units per takeoff unit (1 for direct item links). */
  perUnit: number;
  /** Takeoff quantity driving this line. */
  takeoffQty: number;
  /** Extended item quantity = takeoffQty * perUnit. */
  itemQty: number;
  materialCost: number;
  laborHours: number;
}

export interface MaterialRollupRow {
  item: Item;
  quantity: number;
  materialCost: number;
  laborHours: number;
}

export interface EstimateSummaryInput {
  materialTotal: number;
  laborHoursTotal: number;
  laborRate: number;
  overheadPct: number;
  profitPct: number;
}

export interface EstimateSummary extends EstimateSummaryInput {
  laborCost: number;
  primeCost: number;
  overhead: number;
  subtotal: number;
  profit: number;
  bidPrice: number;
}

/** Only confirmed takeoffs count toward the estimate — never pending AI hits. */
export function countableTakeoffs(takeoffs: Takeoff[]): Takeoff[] {
  return takeoffs.filter((t) => t.status === "confirmed");
}

export function layerQuantities(
  layers: Layer[],
  takeoffs: Takeoff[],
  sheets: Sheet[]
): LayerQuantity[] {
  const sheetById = new Map(sheets.map((s) => [s.id, s]));
  return layers.map((layer) => {
    let quantity = 0;
    let objects = 0;
    let needsCalibration = false;
    for (const t of countableTakeoffs(takeoffs)) {
      if (t.layer_id !== layer.id) continue;
      const sheet = sheetById.get(t.sheet_id);
      if (!sheet) continue;
      const q = takeoffQuantity(t, sheet, layer);
      if (q == null) {
        needsCalibration = true;
        continue;
      }
      quantity += q;
      objects += 1;
    }
    return { layer, quantity, objects, needsCalibration };
  });
}

/**
 * Expand layer quantities into per-item estimate lines.
 * Direct item link: one line, perUnit = 1.
 * Assembly link: one line per component item, perUnit = component quantity.
 */
export function extendEstimate(
  quantities: LayerQuantity[],
  items: Item[],
  assemblies: Assembly[],
  assemblyItems: AssemblyItem[]
): EstimateLine[] {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const assemblyById = new Map(assemblies.map((a) => [a.id, a]));
  const componentsByAssembly = new Map<string, AssemblyItem[]>();
  for (const ai of assemblyItems) {
    const list = componentsByAssembly.get(ai.assembly_id) ?? [];
    list.push(ai);
    componentsByAssembly.set(ai.assembly_id, list);
  }

  const lines: EstimateLine[] = [];
  for (const { layer, quantity } of quantities) {
    if (quantity === 0) continue;
    if (layer.item_id) {
      const item = itemById.get(layer.item_id);
      if (!item) continue;
      lines.push({
        layerId: layer.id,
        layerName: layer.name,
        item,
        assembly: null,
        perUnit: 1,
        takeoffQty: quantity,
        itemQty: quantity,
        materialCost: quantity * item.material_cost,
        laborHours: quantity * item.labor_hours,
      });
    } else if (layer.assembly_id) {
      const assembly = assemblyById.get(layer.assembly_id) ?? null;
      for (const comp of componentsByAssembly.get(layer.assembly_id) ?? []) {
        const item = itemById.get(comp.item_id);
        if (!item) continue;
        const itemQty = quantity * comp.quantity;
        lines.push({
          layerId: layer.id,
          layerName: layer.name,
          item,
          assembly,
          perUnit: comp.quantity,
          takeoffQty: quantity,
          itemQty,
          materialCost: itemQty * item.material_cost,
          laborHours: itemQty * item.labor_hours,
        });
      }
    }
  }
  return lines;
}

/** Aggregate estimate lines by item for the material/labor views and export. */
export function materialRollup(lines: EstimateLine[]): MaterialRollupRow[] {
  const byItem = new Map<string, MaterialRollupRow>();
  for (const line of lines) {
    const row = byItem.get(line.item.id) ?? {
      item: line.item,
      quantity: 0,
      materialCost: 0,
      laborHours: 0,
    };
    row.quantity += line.itemQty;
    row.materialCost += line.materialCost;
    row.laborHours += line.laborHours;
    byItem.set(line.item.id, row);
  }
  return [...byItem.values()].sort((a, b) =>
    a.item.description.localeCompare(b.item.description)
  );
}

export function estimateTotals(lines: EstimateLine[]): {
  materialTotal: number;
  laborHoursTotal: number;
} {
  let materialTotal = 0;
  let laborHoursTotal = 0;
  for (const l of lines) {
    materialTotal += l.materialCost;
    laborHoursTotal += l.laborHours;
  }
  return { materialTotal, laborHoursTotal };
}

/**
 * Bid summary:
 *   laborCost = laborHours * laborRate
 *   primeCost = material + laborCost
 *   overhead  = primeCost * overheadPct%
 *   subtotal  = primeCost + overhead
 *   profit    = subtotal * profitPct%
 *   bidPrice  = subtotal + profit
 */
export function summarize(input: EstimateSummaryInput): EstimateSummary {
  const laborCost = input.laborHoursTotal * input.laborRate;
  const primeCost = input.materialTotal + laborCost;
  const overhead = primeCost * (input.overheadPct / 100);
  const subtotal = primeCost + overhead;
  const profit = subtotal * (input.profitPct / 100);
  const bidPrice = subtotal + profit;
  return { ...input, laborCost, primeCost, overhead, subtotal, profit, bidPrice };
}

/** Round for display/export only — internal math stays full precision. */
export function money(n: number): number {
  return Math.round(n * 100) / 100;
}
