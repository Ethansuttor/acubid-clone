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
  overheadPct: number;
  profitPct: number;
  /** Labor burden (payroll tax, insurance, fringe), % of bare labor cost. */
  laborBurdenPct: number;
  /** Small tools & consumables, % of bare labor cost. Carried in prime. */
  smallToolsPct: number;
  /** Contingency, % of prime cost. Overhead and profit apply to it. */
  contingencyPct: number;
  /** Material price escalation, % of material after waste. Taxed. */
  escalationPct: number;
  /** Bond premium, % of the FINAL bid price (standard circular calc). */
  bondPct: number;
  directCosts: DirectCost[];
}

export interface EstimateSummary extends EstimateSummaryInput {
  wasteAmount: number;
  materialAfterWaste: number;
  /** Escalation on material after waste — you pay tax on the escalated price. */
  escalationAmount: number;
  materialAfterEscalation: number;
  salesTax: number;
  /** Material carried into the bid: base + waste + escalation + tax. */
  materialTotal: number;
  laborFactorHours: number;
  /** Labor hours carried into the bid: base + factor adjustment. */
  laborHoursTotal: number;
  /** Hours x rate, before burden. */
  laborBareCost: number;
  laborBurden: number;
  /** Labor carried into the bid: bare + burden. */
  laborCost: number;
  /** Small tools & consumables: % of bare labor cost. */
  smallTools: number;
  directCostsWithOhp: number;
  directCostsAtCost: number;
  /** Sales tax on taxable direct costs, split by their O&P treatment. */
  directCostTaxWithOhp: number;
  directCostTaxAtCost: number;
  directCostTax: number;
  primeCost: number;
  /** Contingency on prime; flows through overhead and profit. */
  contingency: number;
  overhead: number;
  subtotal: number;
  profit: number;
  /** Everything before the bond premium. */
  preBondTotal: number;
  /** Bond premium = bondPct% of the final bid price (circular). */
  bondAmount: number;
  bidPrice: number;
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
 * Bid summary:
 *   waste        = materialBase * wastePct%
 *   escalation   = (materialBase + waste) * escalationPct%
 *   salesTax     = (materialBase + waste + escalation) * taxPct%
 *                  (you pay tax on the escalated purchase price)
 *   materialTotal= materialBase + waste + escalation + salesTax
 *   laborHours   = laborHoursBase * (1 + laborFactorPct%)
 *   laborBare    = laborHours * laborRate
 *   laborBurden  = laborBare * laborBurdenPct%
 *   laborCost    = laborBare + laborBurden
 *   smallTools   = laborBare * smallToolsPct%
 *   dcTax        = taxPct% on each direct cost flagged taxable, following
 *                  that cost's own O&P treatment
 *   primeCost    = materialTotal + laborCost + smallTools
 *                  + direct costs marked O&P-applies + their tax
 *   contingency  = primeCost * contingencyPct%   (gets overhead AND profit)
 *   overhead     = (primeCost + contingency) * overheadPct%
 *   subtotal     = primeCost + contingency + overhead
 *   profit       = subtotal * profitPct%
 *   preBond      = subtotal + profit + at-cost direct costs + their tax
 *   bidPrice     = preBond / (1 - bondPct%)     (bond is a % of the FINAL
 *                  price, the standard circular calculation)
 *   bondAmount   = bidPrice - preBond
 * bondPct >= 100 makes the bid price non-finite; preflight blocks it rather
 * than this function guessing a cap.
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
    overheadPct: n(raw.overheadPct),
    profitPct: n(raw.profitPct),
    laborBurdenPct: n(raw.laborBurdenPct),
    smallToolsPct: n(raw.smallToolsPct),
    contingencyPct: n(raw.contingencyPct),
    escalationPct: n(raw.escalationPct),
    bondPct: n(raw.bondPct),
  };
  const wasteAmount = input.materialBase * (input.wastePct / 100);
  const materialAfterWaste = input.materialBase + wasteAmount;
  const escalationAmount = materialAfterWaste * (input.escalationPct / 100);
  const materialAfterEscalation = materialAfterWaste + escalationAmount;
  const salesTax = materialAfterEscalation * (input.taxPct / 100);
  const materialTotal = materialAfterEscalation + salesTax;

  const laborFactorHours = input.laborHoursBase * (input.laborFactorPct / 100);
  const laborHoursTotal = input.laborHoursBase + laborFactorHours;
  const laborBareCost = laborHoursTotal * input.laborRate;
  const laborBurden = laborBareCost * (input.laborBurdenPct / 100);
  const laborCost = laborBareCost + laborBurden;
  const smallTools = laborBareCost * (input.smallToolsPct / 100);

  let directCostsWithOhp = 0;
  let directCostsAtCost = 0;
  let directCostTaxWithOhp = 0;
  let directCostTaxAtCost = 0;
  for (const dc of input.directCosts) {
    const amount = Number(dc.amount) || 0;
    // Rows written before the flag existed read undefined => not taxable.
    const tax = dc.taxable === true ? amount * (input.taxPct / 100) : 0;
    if (dc.ohp_applies) {
      directCostsWithOhp += amount;
      directCostTaxWithOhp += tax;
    } else {
      directCostsAtCost += amount;
      directCostTaxAtCost += tax;
    }
  }
  const directCostTax = directCostTaxWithOhp + directCostTaxAtCost;

  const primeCost =
    materialTotal + laborCost + smallTools + directCostsWithOhp + directCostTaxWithOhp;
  const contingency = primeCost * (input.contingencyPct / 100);
  const overhead = (primeCost + contingency) * (input.overheadPct / 100);
  const subtotal = primeCost + contingency + overhead;
  const profit = subtotal * (input.profitPct / 100);
  const preBondTotal = subtotal + profit + directCostsAtCost + directCostTaxAtCost;

  // Bond premium is charged on the final contract value, bond included, so
  // the closed form divides rather than multiplies. bondPct >= 100 has no
  // finite solution: report Infinity and let preflight refuse the bid.
  const bondDenominator = 1 - input.bondPct / 100;
  const bidPrice =
    input.bondPct === 0
      ? preBondTotal
      : bondDenominator > 0
      ? preBondTotal / bondDenominator
      : preBondTotal > 0
      ? Number.POSITIVE_INFINITY
      : 0;
  const bondAmount = bidPrice - preBondTotal;

  return {
    ...input,
    wasteAmount,
    materialAfterWaste,
    escalationAmount,
    materialAfterEscalation,
    salesTax,
    materialTotal,
    laborFactorHours,
    laborHoursTotal,
    laborBareCost,
    laborBurden,
    laborCost,
    smallTools,
    directCostsWithOhp,
    directCostsAtCost,
    directCostTaxWithOhp,
    directCostTaxAtCost,
    directCostTax,
    primeCost,
    contingency,
    overhead,
    subtotal,
    profit,
    preBondTotal,
    bondAmount,
    bidPrice,
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

// ---------------------------------------------------------------------------
// Bid breakdown by area / system / phase (roadmap B-302)
// ---------------------------------------------------------------------------

/** The layer tags a bid can be broken down by. */
export type BreakdownDimension = "area" | "system" | "phase";

/** Shown for layers that carry quantity but were never tagged. */
export const UNASSIGNED_LABEL = "Unassigned";
/** Direct costs are project-level, not layer-level, so they form their own group. */
export const DIRECT_COST_LABEL = "Direct costs";

export interface BreakdownGroup {
  /** Raw tag value; "" for untagged layers, null for the direct-cost group. */
  key: string | null;
  label: string;
  kind: "takeoff" | "direct-costs";
  /** Extended material and labor from takeoff, before markups. */
  materialBase: number;
  laborHoursBase: number;
  /** This group's share of each bid component, at full precision. */
  materialTotal: number;
  laborHoursTotal: number;
  laborCost: number;
  smallTools: number;
  primeCost: number;
  contingency: number;
  overhead: number;
  profit: number;
  bondAmount: number;
  /** This group's share of the final bid price. Groups sum to summary.bidPrice. */
  bidPrice: number;
  /** Share of the bid price, 0-100. Zero when the bid price is zero. */
  pctOfBid: number;
  /** Estimate lines rolled into this group (0 for the direct-cost group). */
  lineCount: number;
  /** Layers rolled into this group (0 for the direct-cost group). */
  layerCount: number;
}

export interface BidBreakdown {
  dimension: BreakdownDimension;
  groups: BreakdownGroup[];
  /** Whole-bid price from summarize() — the single source of truth. */
  bidPrice: number;
  /** Sum of the group shares. */
  allocated: number;
  /** bidPrice - allocated. Non-zero means the parts do not describe the whole. */
  reconciliationError: number;
  /** False if the parts fail to sum to the whole; callers must not present it. */
  reconciles: boolean;
}

/**
 * Break a bid down by a layer tag, reporting each group's share of the *final
 * bid price* rather than only its raw material and labor.
 *
 * This is exact, not pro-rata. Every step of `summarize()` is a percentage of
 * material base, labor base, or a direct cost, with no additive constant, so
 * the chain is linear: running it on one group's base yields precisely that
 * group's share of waste, tax, burden, small tools, contingency, overhead,
 * profit and bond. Re-using `summarize()` itself — rather than reimplementing
 * the allocation — is what keeps a breakdown from drifting away from the bid
 * when the bid math changes. A pro-rata split would look identical today and
 * silently diverge the first time a non-linear term is added.
 *
 * Two rules protect the estimator:
 *  - A layer with no tag is reported under "Unassigned". It is never dropped
 *    and never spread across the tagged groups (invariant 1).
 *  - Direct costs are not layer-tagged, so they are their own group rather
 *    than being attributed to a system they may not belong to.
 *
 * `reconciles` is the guard: if the group shares fail to sum to the bid price
 * — which happens when `input` was not derived from these `lines` — callers
 * must show the error rather than a breakdown that quietly disagrees with the
 * total on the same screen.
 */
export function bidBreakdown(
  lines: EstimateLine[],
  layers: Layer[],
  input: EstimateSummaryInput,
  dimension: BreakdownDimension
): BidBreakdown {
  const layerById = new Map(layers.map((l) => [l.id, l]));
  const whole = summarize(input);

  interface Bucket {
    key: string;
    materialBase: number;
    laborHoursBase: number;
    lineCount: number;
    layerIds: Set<string>;
  }
  const buckets = new Map<string, Bucket>();
  for (const line of lines) {
    const raw = layerById.get(line.layerId)?.[dimension];
    const key = typeof raw === "string" ? raw.trim() : "";
    const bucket = buckets.get(key) ?? {
      key,
      materialBase: 0,
      laborHoursBase: 0,
      lineCount: 0,
      layerIds: new Set<string>(),
    };
    bucket.materialBase += line.materialCost;
    bucket.laborHoursBase += line.laborHours;
    bucket.lineCount += 1;
    bucket.layerIds.add(line.layerId);
    buckets.set(key, bucket);
  }

  // Percentages only: each group's own base and, for the direct-cost group,
  // the real direct costs. Splitting this way is what makes the parts sum.
  const share = (
    materialBase: number,
    laborHoursBase: number,
    directCosts: DirectCost[]
  ): EstimateSummary => summarize({ ...input, materialBase, laborHoursBase, directCosts });

  const groups: BreakdownGroup[] = [];
  const pct = (value: number) =>
    Number.isFinite(whole.bidPrice) && whole.bidPrice !== 0 ? (value / whole.bidPrice) * 100 : 0;

  const push = (
    key: string | null,
    label: string,
    kind: BreakdownGroup["kind"],
    s: EstimateSummary,
    lineCount: number,
    layerCount: number
  ) => {
    groups.push({
      key,
      label,
      kind,
      materialBase: s.materialBase,
      laborHoursBase: s.laborHoursBase,
      materialTotal: s.materialTotal,
      laborHoursTotal: s.laborHoursTotal,
      laborCost: s.laborCost,
      smallTools: s.smallTools,
      primeCost: s.primeCost,
      contingency: s.contingency,
      overhead: s.overhead,
      profit: s.profit,
      bondAmount: s.bondAmount,
      bidPrice: s.bidPrice,
      pctOfBid: pct(s.bidPrice),
      lineCount,
      layerCount,
    });
  };

  for (const bucket of buckets.values()) {
    push(
      bucket.key,
      bucket.key === "" ? UNASSIGNED_LABEL : bucket.key,
      "takeoff",
      share(bucket.materialBase, bucket.laborHoursBase, []),
      bucket.lineCount,
      bucket.layerIds.size
    );
  }
  if (input.directCosts.length > 0) {
    push(null, DIRECT_COST_LABEL, "direct-costs", share(0, 0, input.directCosts), 0, 0);
  }

  // Tagged groups by value descending, then Unassigned, then direct costs, so
  // the two groups an estimator must consciously account for read last.
  const rank = (g: BreakdownGroup) => (g.kind === "direct-costs" ? 2 : g.key === "" ? 1 : 0);
  groups.sort((a, b) => rank(a) - rank(b) || b.bidPrice - a.bidPrice || a.label.localeCompare(b.label));

  const allocated = groups.reduce((sum, g) => sum + g.bidPrice, 0);
  const reconciliationError = whole.bidPrice - allocated;
  // Relative tolerance: the shares are summed in a different order from the
  // whole, so float rounding of a large bid is expected and harmless.
  const tolerance = Math.max(1e-6, Math.abs(whole.bidPrice) * 1e-9);
  return {
    dimension,
    groups,
    bidPrice: whole.bidPrice,
    allocated,
    reconciliationError,
    reconciles:
      Number.isFinite(whole.bidPrice) &&
      Number.isFinite(allocated) &&
      Math.abs(reconciliationError) <= tolerance,
  };
}
