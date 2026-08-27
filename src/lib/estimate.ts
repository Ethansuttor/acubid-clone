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
  /** Objects that could not be measured because their sheet has no scale. */
  unmeasured: number;
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
    | "unlinked"           // no item or assembly chosen
    | "missing-item"       // linked item no longer exists
    | "missing-assembly"   // linked assembly no longer exists
    | "empty-assembly"     // assembly has no component items
    | "missing-component"  // an assembly component's item no longer exists
    | "uncalibrated"       // measured objects on a sheet with no scale
    | "unit-mismatch";     // priced per a unit the layer does not measure
  /** "missing": quantity is absent or short. "warning": priced, but suspect. */
  severity: "missing" | "warning";
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
  /** Payroll tax, insurance and fringes, percent of labor cost. */
  laborBurdenPct: number;
  /** Small tools and consumables, percent of labor cost. */
  smallToolsPct: number;
  /** Material price movement to buyout, percent of the material total. */
  escalationPct: number;
  /** Cost buffer, percent of prime cost. Marked up like any other cost. */
  contingencyPct: number;
  /** Bond premium, percent of the bid price — which includes the bond. */
  bondPct: number;
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
  /** Material escalation to buyout, on the material total. */
  escalation: number;
  laborFactorHours: number;
  /** Labor hours carried into the bid: base + factor adjustment. */
  laborHoursTotal: number;
  /** Bare labor: hours x rate, before burden and consumables. */
  laborCost: number;
  laborBurden: number;
  smallTools: number;
  /** Labor carried into prime cost: bare labor + burden + small tools. */
  laborTotal: number;
  /** O&P-applicable direct costs before sales tax. */
  directCostsWithOhpBase: number;
  /** Sales tax on the taxable O&P-applicable direct costs. */
  directCostsWithOhpTax: number;
  /** O&P-applicable direct costs carried into prime cost, tax included. */
  directCostsWithOhp: number;
  /** At-cost direct costs before sales tax. */
  directCostsAtCostBase: number;
  /** Sales tax on the taxable at-cost direct costs. */
  directCostsAtCostTax: number;
  /** At-cost direct costs added after profit, tax included. */
  directCostsAtCost: number;
  /** Sales tax charged on direct costs, both buckets. */
  directCostTax: number;
  primeCost: number;
  contingency: number;
  /** The base overhead is charged on: prime cost + contingency. */
  costWithContingency: number;
  overhead: number;
  subtotal: number;
  profit: number;
  /** Bid price before the bond premium is added. */
  priceBeforeBond: number;
  /** Bond premium: bondPct% of the final bid price, which includes it. */
  bond: number;
  bidPrice: number;
  /**
   * Things about the bid inputs a reviewer must see. Not `EstimateIssue`s —
   * those are about takeoff quantity that could not be priced. These are
   * about the markups themselves.
   */
  warnings: string[];
}

/** Only confirmed takeoffs count toward the estimate — never pending AI hits. */
export function countableTakeoffs(takeoffs: Takeoff[]): Takeoff[] {
  return takeoffs.filter((t) => t.status === "confirmed");
}

const EXPECTED_UNIT: Record<string, string> = { count: "EA", linear: "FT", area: "SF" };

/**
 * Map common spellings onto the three units a takeoff tool can measure.
 * Anything else is the estimator's own unit and is left alone.
 */
function normalizeUnit(unit: string): string | null {
  const u = (unit ?? "").trim().toUpperCase();
  if (["EA", "EACH", "PC", "PCS"].includes(u)) return "EA";
  if (["FT", "LF", "FOOT", "FEET", "'"].includes(u)) return "FT";
  if (["SF", "SQFT", "SQ FT", "SQ.FT."].includes(u)) return "SF";
  return null;
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
    let unmeasured = 0;
    for (const t of confirmed) {
      if (t.layer_id !== layer.id) continue;
      const sheet = sheetById.get(t.sheet_id);
      if (!sheet) continue;
      const q = takeoffQuantity(t, sheet, layer);
      if (q == null) {
        unmeasured += 1;
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
      unmeasured,
      needsCalibration: unmeasured > 0,
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
    detail: string,
    severity: EstimateIssue["severity"] = "missing"
  ) =>
    issues.push({ layerId: layer.id, layerName: layer.name, quantity, kind, severity, detail });

  for (const { layer, quantity, unmeasured } of quantities) {
    // Objects on an uncalibrated sheet contribute nothing and would otherwise
    // leave no trace at all in the summary or the export.
    if (unmeasured > 0) {
      flag(
        layer,
        0,
        "uncalibrated",
        `${unmeasured} takeoff object(s) sit on a sheet with no scale set and are not measured — calibrate the sheet`
      );
    }
    if (quantity === 0) continue;

    if (layer.item_id) {
      const item = itemById.get(layer.item_id);
      if (!item) {
        flag(layer, quantity, "missing-item", "Linked item no longer exists in the database");
        continue;
      }
      const expected = EXPECTED_UNIT[layer.tool];
      const actual = normalizeUnit(item.unit);
      if (actual && actual !== expected) {
        flag(
          layer,
          quantity,
          "unit-mismatch",
          `Layer measures ${expected} but "${item.description}" is priced per ${item.unit}`,
          "warning"
        );
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
 * Bid summary. Order of operations — see `.ai/05-decisions.md` before changing:
 *
 *   waste        = materialBase * wastePct%          (you buy the waste)
 *   salesTax     = (materialBase + waste) * taxPct%
 *   materialTotal= materialBase + waste + salesTax
 *   escalation   = materialTotal * escalationPct%    (material price to buyout)
 *
 *   laborHours   = laborHoursBase * (1 + laborFactorPct%)
 *   laborCost    = laborHours * laborRate            (bare labor)
 *   laborBurden  = laborCost * laborBurdenPct%       (payroll tax, ins., fringe)
 *   smallTools   = laborCost * smallToolsPct%        (consumables)
 *   laborTotal   = laborCost + laborBurden + smallTools
 *
 *   direct costs are split by ohp_applies, and each bucket carries sales tax
 *   on the rows flagged `taxable` — a gear quote is normally quoted pre-tax.
 *
 *   primeCost    = materialTotal + escalation + laborTotal + directCostsWithOhp
 *   contingency  = primeCost * contingencyPct%       (a cost, so it is marked up)
 *   overhead     = (primeCost + contingency) * overheadPct%
 *   subtotal     = primeCost + contingency + overhead
 *   profit       = subtotal * profitPct%
 *   priceBeforeBond = subtotal + profit + directCostsAtCost
 *   bond         = bondPct% OF THE BID PRICE, which includes the bond:
 *                  bidPrice = priceBeforeBond / (1 - bondPct/100)
 *   bidPrice     = priceBeforeBond + bond
 *
 * Burden, small tools, escalation, contingency and bond are all zero by
 * default, and at zero every figure above reduces to the original bid.
 */
export function summarize(raw: EstimateSummaryInput): EstimateSummary {
  // A project row written before the bid-math columns existed yields undefined
  // percentages; without this guard the whole bid renders as NaN.
  const n = (v: number) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const input: EstimateSummaryInput = {
    ...raw,
    materialBase: n(raw.materialBase),
    laborHoursBase: n(raw.laborHoursBase),
    laborRate: n(raw.laborRate),
    wastePct: n(raw.wastePct),
    taxPct: n(raw.taxPct),
    laborFactorPct: n(raw.laborFactorPct),
    laborBurdenPct: n(raw.laborBurdenPct),
    smallToolsPct: n(raw.smallToolsPct),
    escalationPct: n(raw.escalationPct),
    contingencyPct: n(raw.contingencyPct),
    bondPct: n(raw.bondPct),
    overheadPct: n(raw.overheadPct),
    profitPct: n(raw.profitPct),
  };
  const warnings: string[] = [];

  const wasteAmount = input.materialBase * (input.wastePct / 100);
  const materialAfterWaste = input.materialBase + wasteAmount;
  const salesTax = materialAfterWaste * (input.taxPct / 100);
  const materialTotal = materialAfterWaste + salesTax;
  const escalation = materialTotal * (input.escalationPct / 100);

  const laborFactorHours = input.laborHoursBase * (input.laborFactorPct / 100);
  const laborHoursTotal = input.laborHoursBase + laborFactorHours;
  const laborCost = laborHoursTotal * input.laborRate;
  const laborBurden = laborCost * (input.laborBurdenPct / 100);
  const smallTools = laborCost * (input.smallToolsPct / 100);
  const laborTotal = laborCost + laborBurden + smallTools;

  let directCostsWithOhpBase = 0;
  let directCostsWithOhpTax = 0;
  let directCostsAtCostBase = 0;
  let directCostsAtCostTax = 0;
  let hasBondCost = false;
  for (const dc of input.directCosts) {
    const amount = Number(dc.amount) || 0;
    // Tax follows the amount into whichever bucket the amount lands in, so a
    // taxable quote is marked up or carried at cost consistently with it.
    const tax = dc.taxable ? amount * (input.taxPct / 100) : 0;
    if (dc.ohp_applies) {
      directCostsWithOhpBase += amount;
      directCostsWithOhpTax += tax;
    } else {
      directCostsAtCostBase += amount;
      directCostsAtCostTax += tax;
    }
    if (dc.category === "bond" && amount !== 0) hasBondCost = true;
  }
  const directCostsWithOhp = directCostsWithOhpBase + directCostsWithOhpTax;
  const directCostsAtCost = directCostsAtCostBase + directCostsAtCostTax;
  const directCostTax = directCostsWithOhpTax + directCostsAtCostTax;

  const primeCost = materialTotal + escalation + laborTotal + directCostsWithOhp;
  const contingency = primeCost * (input.contingencyPct / 100);
  const costWithContingency = primeCost + contingency;
  const overhead = costWithContingency * (input.overheadPct / 100);
  const subtotal = costWithContingency + overhead;
  const profit = subtotal * (input.profitPct / 100);
  const priceBeforeBond = subtotal + profit + directCostsAtCost;

  // A bond premium is quoted as a percentage of the contract value, and the
  // bond is part of that value, so the calculation is circular:
  //   bid = priceBeforeBond + bond,  bond = bid * p  =>  bid = priceBeforeBond / (1 - p)
  // Outside 0 <= p < 1 that division is meaningless (at p = 1 the bond eats
  // the whole bid). Refuse rather than emit a plausible number, and say so.
  let bond = 0;
  if (input.bondPct < 0 || input.bondPct >= 100) {
    warnings.push(
      `Bond rate ${input.bondPct}% is not a usable percentage of the bid price — ` +
        `no bond has been added to this bid. Enter a rate between 0 and 100.`
    );
  } else if (input.bondPct > 0) {
    const p = input.bondPct / 100;
    bond = (priceBeforeBond * p) / (1 - p);
    if (hasBondCost) {
      warnings.push(
        `A bond is priced twice: ${input.bondPct}% of the bid price AND a direct ` +
          `cost in the "bond" category. Remove one or the bid carries both.`
      );
    }
  }
  const bidPrice = priceBeforeBond + bond;

  return {
    ...input,
    wasteAmount,
    materialAfterWaste,
    salesTax,
    materialTotal,
    escalation,
    laborFactorHours,
    laborHoursTotal,
    laborCost,
    laborBurden,
    smallTools,
    laborTotal,
    directCostsWithOhpBase,
    directCostsWithOhpTax,
    directCostsWithOhp,
    directCostsAtCostBase,
    directCostsAtCostTax,
    directCostsAtCost,
    directCostTax,
    primeCost,
    contingency,
    costWithContingency,
    overhead,
    subtotal,
    profit,
    priceBeforeBond,
    bond,
    bidPrice,
    warnings,
  };
}

/** Round for display/export only — internal math stays full precision. */
export function money(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Where an item is referenced. Deleting an item cascades: its assembly
 * component rows go with it, which quietly shortens every assembly that used
 * it and under-extends every takeoff on those assemblies. Nothing downstream
 * can detect that after the fact, so the warning has to happen at delete time.
 */
export function itemUsage(
  itemId: string,
  assemblies: Assembly[],
  assemblyItems: AssemblyItem[],
  layers: Layer[]
): { assemblies: Assembly[]; layers: Layer[] } {
  const usedIn = new Set(
    assemblyItems.filter((ai) => ai.item_id === itemId).map((ai) => ai.assembly_id)
  );
  return {
    assemblies: assemblies.filter((a) => usedIn.has(a.id)),
    layers: layers.filter((l) => l.item_id === itemId),
  };
}

/** Layers that would lose their pricing if this assembly were deleted. */
export function assemblyUsage(assemblyId: string, layers: Layer[]): Layer[] {
  return layers.filter((l) => l.assembly_id === assemblyId);
}
