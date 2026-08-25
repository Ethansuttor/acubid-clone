// Estimate extension math. Pure functions: takeoffs + layers + item/assembly
// database in, extended material cost / labor hours / bid summary out.
// This module is the single source of truth for every dollar and hour figure
// shown in the UI and written to the Excel export.

import { takeoffQuantity } from "./geometry";
import type {
  Assembly,
  AssemblyItem,
  DirectCost,
  Item,
  Layer,
  Sheet,
  Takeoff,
} from "./types";

export interface LayerQuantity {
  layer: Layer;
  /** Measured quantity before the typical-area multiplier (EA, FT, or SF). */
  rawQuantity: number;
  /** Quantity that feeds the estimate: rawQuantity * layer.typical_multiplier. */
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

/**
 * A layer carrying real takeoff quantity that cannot be fully extended into
 * money. These are reported rather than silently skipped: quietly dropping
 * quantity produces a bid that looks plausible and is short.
 */
export interface EstimateIssue {
  layerId: string;
  layerName: string;
  quantity: number;
  kind:
    | "unlinked"          // no item or assembly chosen
    | "missing-item"      // linked item no longer exists
    | "missing-assembly"  // linked assembly no longer exists
    | "empty-assembly"    // assembly has no component items
    | "missing-component"; // an assembly component's item no longer exists
  detail: string;
}

export interface ExtendedEstimate {
  lines: EstimateLine[];
  issues: EstimateIssue[];
}

export interface MaterialRollupRow {
  item: Item;
  quantity: number;
  materialCost: number;
  laborHours: number;
}

export interface EstimateSummaryInput {
  /** Extended material from takeoff, before waste and tax. */
  materialBase: number;
  /** Extended labor hours from takeoff, before the productivity factor. */
  laborHoursBase: number;
  laborRate: number;
  wastePct: number;
  taxPct: number;
  laborFactorPct: number;
  overheadPct: number;
  profitPct: number;
  directCosts: DirectCost[];
}

export interface EstimateSummary extends EstimateSummaryInput {
  wasteAmount: number;
  materialAfterWaste: number;
  salesTax: number;
  /** Material carried into the bid: base + waste + tax. */
  materialTotal: number;
  laborFactorHours: number;
  /** Labor hours carried into the bid: base + factor adjustment. */
  laborHoursTotal: number;
  laborCost: number;
  directCostsWithOhp: number;
  directCostsAtCost: number;
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

/** A layer's repeat factor, defaulting to 1 for rows written before the field existed. */
function multiplierOf(layer: Layer): number {
  const m = Number(layer.typical_multiplier);
  return Number.isFinite(m) && m > 0 ? m : 1;
}

export function layerQuantities(
  layers: Layer[],
  takeoffs: Takeoff[],
  sheets: Sheet[]
): LayerQuantity[] {
  const sheetById = new Map(sheets.map((s) => [s.id, s]));
  const confirmed = countableTakeoffs(takeoffs);
  return layers.map((layer) => {
    let rawQuantity = 0;
    let objects = 0;
    let needsCalibration = false;
    for (const t of confirmed) {
      if (t.layer_id !== layer.id) continue;
      const sheet = sheetById.get(t.sheet_id);
      if (!sheet) continue;
      const q = takeoffQuantity(t, sheet, layer);
      if (q == null) {
        needsCalibration = true;
        continue;
      }
      rawQuantity += q;
      objects += 1;
    }
    return {
      layer,
      rawQuantity,
      quantity: rawQuantity * multiplierOf(layer),
      objects,
      needsCalibration,
    };
  });
}

/**
 * Expand layer quantities into per-item estimate lines.
 * Direct item link: one line, perUnit = 1.
 * Assembly link: one line per component item, perUnit = component quantity.
 *
 * Any layer that carries quantity but cannot be fully resolved is reported in
 * `issues` — including the partial case where one component of an otherwise
 * valid assembly points at a deleted item.
 */
export function extendEstimate(
  quantities: LayerQuantity[],
  items: Item[],
  assemblies: Assembly[],
  assemblyItems: AssemblyItem[]
): ExtendedEstimate {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const assemblyById = new Map(assemblies.map((a) => [a.id, a]));
  const componentsByAssembly = new Map<string, AssemblyItem[]>();
  for (const ai of assemblyItems) {
    const list = componentsByAssembly.get(ai.assembly_id) ?? [];
    list.push(ai);
    componentsByAssembly.set(ai.assembly_id, list);
  }

  const lines: EstimateLine[] = [];
  const issues: EstimateIssue[] = [];
  const flag = (
    layer: Layer,
    quantity: number,
    kind: EstimateIssue["kind"],
    detail: string
  ) => issues.push({ layerId: layer.id, layerName: layer.name, quantity, kind, detail });

  for (const { layer, quantity } of quantities) {
    if (quantity === 0) continue;

    if (layer.item_id) {
      const item = itemById.get(layer.item_id);
      if (!item) {
        flag(layer, quantity, "missing-item", "Linked item no longer exists in the database");
        continue;
      }
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
      if (!assembly) {
        flag(layer, quantity, "missing-assembly", "Linked assembly no longer exists");
        continue;
      }
      const components = componentsByAssembly.get(layer.assembly_id) ?? [];
      if (components.length === 0) {
        flag(
          layer,
          quantity,
          "empty-assembly",
          `Assembly "${assembly.name}" has no component items`
        );
        continue;
      }
      let missing = 0;
      for (const comp of components) {
        const item = itemById.get(comp.item_id);
        if (!item) {
          missing += 1;
          continue;
        }
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
      if (missing > 0) {
        flag(
          layer,
          quantity,
          "missing-component",
          `Assembly "${assembly.name}" is short ${missing} deleted component item(s) — this line is under-extended`
        );
      }
    } else {
      flag(layer, quantity, "unlinked", "Layer is not linked to an item or assembly");
    }
  }
  return { lines, issues };
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
  materialBase: number;
  laborHoursBase: number;
} {
  let materialBase = 0;
  let laborHoursBase = 0;
  for (const l of lines) {
    materialBase += l.materialCost;
    laborHoursBase += l.laborHours;
  }
  return { materialBase, laborHoursBase };
}

/**
 * Bid summary:
 *   waste        = materialBase * wastePct%
 *   salesTax     = (materialBase + waste) * taxPct%
 *   materialTotal= materialBase + waste + salesTax
 *   laborHours   = laborHoursBase * (1 + laborFactorPct%)
 *   laborCost    = laborHours * laborRate
 *   primeCost    = materialTotal + laborCost + direct costs marked O&P-applies
 *   overhead     = primeCost * overheadPct%
 *   subtotal     = primeCost + overhead
 *   profit       = subtotal * profitPct%
 *   bidPrice     = subtotal + profit + direct costs carried at cost
 */
export function summarize(input: EstimateSummaryInput): EstimateSummary {
  const wasteAmount = input.materialBase * (input.wastePct / 100);
  const materialAfterWaste = input.materialBase + wasteAmount;
  const salesTax = materialAfterWaste * (input.taxPct / 100);
  const materialTotal = materialAfterWaste + salesTax;

  const laborFactorHours = input.laborHoursBase * (input.laborFactorPct / 100);
  const laborHoursTotal = input.laborHoursBase + laborFactorHours;
  const laborCost = laborHoursTotal * input.laborRate;

  let directCostsWithOhp = 0;
  let directCostsAtCost = 0;
  for (const dc of input.directCosts) {
    const amount = Number(dc.amount) || 0;
    if (dc.ohp_applies) directCostsWithOhp += amount;
    else directCostsAtCost += amount;
  }

  const primeCost = materialTotal + laborCost + directCostsWithOhp;
  const overhead = primeCost * (input.overheadPct / 100);
  const subtotal = primeCost + overhead;
  const profit = subtotal * (input.profitPct / 100);
  const bidPrice = subtotal + profit + directCostsAtCost;

  return {
    ...input,
    wasteAmount,
    materialAfterWaste,
    salesTax,
    materialTotal,
    laborFactorHours,
    laborHoursTotal,
    laborCost,
    directCostsWithOhp,
    directCostsAtCost,
    primeCost,
    overhead,
    subtotal,
    profit,
    bidPrice,
  };
}

/** Round for display/export only — internal math stays full precision. */
export function money(n: number): number {
  return Math.round(n * 100) / 100;
}
