import type { EstimateIssue, EstimateLine, EstimateSummary } from "./estimate";
import type { DirectCost, Layer, Project, Sheet, Takeoff } from "./types";

export type PreflightSeverity = "blocker" | "warning";

export interface PreflightCheck {
  id: string;
  severity: PreflightSeverity;
  title: string;
  detail: string;
}

export interface BidPreflightInput {
  project: Project;
  sheets: Sheet[];
  layers: Layer[];
  takeoffs: Takeoff[];
  lines: EstimateLine[];
  issues: EstimateIssue[];
  summary: EstimateSummary;
  directCosts: DirectCost[];
  pendingWrites: number;
  saveState: "saved" | "saving" | "error";
}

export interface BidPreflight {
  ready: boolean;
  checks: PreflightCheck[];
  blockers: PreflightCheck[];
  warnings: PreflightCheck[];
}

function uniqueItemCodes(lines: EstimateLine[], predicate: (line: EstimateLine) => boolean) {
  return [...new Set(lines.filter(predicate).map((line) => line.item.code || line.item.description))];
}

/**
 * Fail-closed readiness checks for issuing/exporting a bid. This function is
 * deliberately pure so the UI, snapshot writer, and tests share one answer.
 */
export function bidPreflight(input: BidPreflightInput): BidPreflight {
  const checks: PreflightCheck[] = [];
  const add = (
    condition: boolean,
    id: string,
    severity: PreflightSeverity,
    title: string,
    detail: string
  ) => {
    if (condition) checks.push({ id, severity, title, detail });
  };

  add(
    input.saveState === "error",
    "save-error",
    "blocker",
    "A change failed to save",
    "Resolve the save error before issuing this bid. Later successful edits do not clear this failure."
  );
  add(
    input.pendingWrites > 0 || input.saveState === "saving",
    "save-pending",
    "blocker",
    "Changes are still saving",
    `Wait for ${input.pendingWrites} pending ${input.pendingWrites === 1 ? "change" : "changes"} to finish.`
  );

  const missingIssues = input.issues.filter((issue) => issue.severity === "missing");
  add(
    missingIssues.length > 0,
    "missing-quantity",
    "blocker",
    "Quantity is missing from the bid",
    `${missingIssues.length} estimate ${missingIssues.length === 1 ? "issue prevents" : "issues prevent"} a complete extension. Review the Estimate tab.`
  );

  const pendingAi = input.takeoffs.filter((takeoff) => takeoff.status === "pending").length;
  add(
    pendingAi > 0,
    "pending-ai",
    "blocker",
    "AI counts still need review",
    `${pendingAi} ${pendingAi === 1 ? "candidate is" : "candidates are"} pending acceptance or rejection.`
  );

  add(
    input.summary.laborHoursTotal > 0 && input.project.labor_rate <= 0,
    "labor-rate",
    "blocker",
    "Labor has no billing rate",
    `${input.summary.laborHoursTotal.toFixed(2)} labor hours are extended at $0 per hour.`
  );

  const summaryTotals = [
    input.summary.materialBase,
    input.summary.materialTotal,
    input.summary.laborHoursBase,
    input.summary.laborHoursTotal,
    input.summary.laborBurden,
    input.summary.laborCost,
    input.summary.smallTools,
    input.summary.directCostTax,
    input.summary.primeCost,
    input.summary.contingency,
    input.summary.overhead,
    input.summary.profit,
    input.summary.preBondTotal,
    input.summary.bondAmount,
    input.summary.bidPrice,
  ];
  add(
    summaryTotals.some((value) => !Number.isFinite(value) || value < 0),
    "invalid-total",
    "blocker",
    "Bid total is invalid",
    "At least one commercial input produced a non-finite or negative bid total."
  );

  const nonNegativeCommercialFields = [
    ["labor rate", input.project.labor_rate],
    ["material waste", input.project.waste_pct],
    ["sales tax", input.project.tax_pct],
    ["overhead", input.project.overhead_pct],
    ["profit", input.project.profit_pct],
    ["labor burden", input.project.labor_burden_pct],
    ["small tools", input.project.small_tools_pct],
    ["contingency", input.project.contingency_pct],
    ["escalation", input.project.escalation_pct],
  ] as const;
  const invalidCommercialFields: string[] = nonNegativeCommercialFields
    .filter(([, value]) => !Number.isFinite(value) || value < 0)
    .map(([name]) => name);
  if (
    !Number.isFinite(input.project.labor_factor_pct) ||
    input.project.labor_factor_pct <= -100
  ) {
    invalidCommercialFields.push("labor factor");
  }
  // A bond of 100%+ of the bid price has no finite solution to the circular
  // bond calculation; summarize() reports Infinity and this check names why.
  if (
    !Number.isFinite(input.project.bond_pct) ||
    input.project.bond_pct < 0 ||
    input.project.bond_pct >= 100
  ) {
    invalidCommercialFields.push("bond");
  }
  const invalidDirectCosts = input.directCosts.filter(
    (cost) => !Number.isFinite(cost.amount) || cost.amount < 0
  );
  add(
    invalidCommercialFields.length > 0 || invalidDirectCosts.length > 0,
    "invalid-commercial-input",
    "blocker",
    "Commercial inputs contain invalid values",
    [
      ...invalidCommercialFields,
      ...invalidDirectCosts.map((cost) => cost.description.trim() || "unnamed direct cost"),
    ]
      .slice(0, 6)
      .join(", ") +
      " must be finite and valid (labor factor may be negative but must remain above -100%; bond must be below 100% of the bid)."
  );

  const invalidLayers = input.layers.filter(
    (layer) =>
      !Number.isFinite(layer.typical_multiplier) ||
      layer.typical_multiplier <= 0 ||
      !Number.isFinite(layer.rise_drop_ft) ||
      layer.rise_drop_ft < 0
  );
  add(
    invalidLayers.length > 0,
    "invalid-layer-input",
    "blocker",
    "Takeoff layers contain invalid factors",
    `${invalidLayers.slice(0, 5).map((layer) => layer.name).join(", ")}${invalidLayers.length > 5 ? ` and ${invalidLayers.length - 5} more` : ""} must use a positive typical multiplier and non-negative rise/drop.`
  );

  const invalidCatalogItems = uniqueItemCodes(
    input.lines,
    (line) =>
      !Number.isFinite(line.itemQty) ||
      line.itemQty < 0 ||
      !Number.isFinite(line.item.material_cost) ||
      line.item.material_cost < 0 ||
      !Number.isFinite(line.item.labor_hours) ||
      line.item.labor_hours < 0
  );
  add(
    invalidCatalogItems.length > 0,
    "invalid-catalog-input",
    "blocker",
    "Used catalog items contain invalid values",
    `${invalidCatalogItems.slice(0, 5).join(", ")}${invalidCatalogItems.length > 5 ? ` and ${invalidCatalogItems.length - 5} more` : ""} must use finite, non-negative quantities, prices, and labor units.`
  );

  const incompleteCosts = input.directCosts.filter(
    (cost) => cost.amount > 0 && !cost.description.trim()
  );
  add(
    incompleteCosts.length > 0,
    "unnamed-direct-cost",
    "blocker",
    "A direct cost has no description",
    `${incompleteCosts.length} priced ${incompleteCosts.length === 1 ? "cost needs" : "costs need"} a scope or vendor description.`
  );

  add(
    input.lines.length === 0 && input.directCosts.every((cost) => cost.amount === 0),
    "empty-bid",
    "blocker",
    "The bid has no priced scope",
    "Add takeoff-linked scope or a priced direct cost before issuing this bid."
  );
  add(
    input.sheets.length === 0,
    "no-sheets",
    "warning",
    "No plan sheets are attached",
    "This may be intentional for a quote-only estimate, but it should be confirmed."
  );

  const zeroBoth = uniqueItemCodes(
    input.lines,
    (line) => line.itemQty > 0 && line.item.material_cost === 0 && line.item.labor_hours === 0
  );
  add(
    zeroBoth.length > 0,
    "zero-value-items",
    "blocker",
    "Used items have no material or labor value",
    `${zeroBoth.slice(0, 4).join(", ")}${zeroBoth.length > 4 ? ` and ${zeroBoth.length - 4} more` : ""} extend at zero cost.`
  );

  const zeroMaterial = uniqueItemCodes(
    input.lines,
    (line) => line.itemQty > 0 && line.item.material_cost === 0 && line.item.labor_hours > 0
  );
  add(
    zeroMaterial.length > 0,
    "zero-material-items",
    "warning",
    "Used items have no material price",
    `${zeroMaterial.slice(0, 4).join(", ")}${zeroMaterial.length > 4 ? ` and ${zeroMaterial.length - 4} more` : ""} may be labor-only or unpriced.`
  );

  const zeroLabor = uniqueItemCodes(
    input.lines,
    (line) => line.itemQty > 0 && line.item.labor_hours === 0 && line.item.material_cost > 0
  );
  add(
    zeroLabor.length > 0,
    "zero-labor-items",
    "warning",
    "Used items have no labor unit",
    `${zeroLabor.slice(0, 4).join(", ")}${zeroLabor.length > 4 ? ` and ${zeroLabor.length - 4} more` : ""} may be material-only or missing labor.`
  );

  const warningIssues = input.issues.filter((issue) => issue.severity === "warning");
  add(
    warningIssues.length > 0,
    "estimate-warnings",
    "warning",
    "Estimate links need review",
    `${warningIssues.length} unit or catalog ${warningIssues.length === 1 ? "warning is" : "warnings are"} present.`
  );

  const takeoffSheetsByLayer = new Map<string, Set<string>>();
  for (const takeoff of input.takeoffs) {
    if (takeoff.status !== "confirmed") continue;
    const sheetIds = takeoffSheetsByLayer.get(takeoff.layer_id) ?? new Set<string>();
    sheetIds.add(takeoff.sheet_id);
    takeoffSheetsByLayer.set(takeoff.layer_id, sheetIds);
  }
  const riskyTypicalLayers = input.layers.filter(
    (layer) => layer.typical_multiplier > 1 && (takeoffSheetsByLayer.get(layer.id)?.size ?? 0) > 1
  );
  add(
    riskyTypicalLayers.length > 0,
    "cross-sheet-typical",
    "warning",
    "Typical multipliers span multiple sheets",
    `${riskyTypicalLayers.map((layer) => layer.name).join(", ")} may multiply unrelated sheet quantities.`
  );

  add(
    input.project.overhead_pct === 0 || input.project.profit_pct === 0,
    "zero-markup",
    "warning",
    "Overhead or profit is zero",
    "Confirm the commercial strategy before issuing the bid."
  );

  const blockers = checks.filter((check) => check.severity === "blocker");
  const warnings = checks.filter((check) => check.severity === "warning");
  return { ready: blockers.length === 0, checks, blockers, warnings };
}
