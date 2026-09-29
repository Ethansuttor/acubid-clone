/**
 * A1 — the comparison engine for known-estimate acceptance.
 *
 * It answers one question: does what Voltline produced agree with what the
 * estimator says the job is? It is deliberately unforgiving in the places
 * where a forgiving answer would ship a wrong bid:
 *
 * - Counted quantities (EA) must agree exactly. There is no such thing as
 *   "close enough" to 47 receptacles.
 * - Measured quantities (FT, SF) use a tolerance the estimator recorded in the
 *   manifest **before** the comparison. The engine will not invent one.
 * - A matching grand total is not a pass. Offsetting material and labor errors
 *   net out; the engine detects that case and names it, because it is the
 *   failure mode most likely to be waved through.
 * - Quantity the app could not price, and scope the app does not support, are
 *   open items. An open item is never a pass.
 *
 * Pure and dependency-free so it can be unit tested and reused by both the
 * synthetic run and a real-job run.
 */

export type QuantityKind = "counted" | "measured";

export interface Tolerances {
  /** Fractional tolerance for measured lengths/areas, e.g. 0.01 = 1%. */
  measuredFraction: number;
  /** Absolute currency tolerance, in dollars. Rounding only, not slop. */
  currency: number;
  /** Absolute labor tolerance, in hours. */
  laborHours: number;
}

export interface ExpectedLine {
  /** Catalog code as the estimator recorded it. */
  code: string;
  unit: string;
  kind: QuantityKind;
  quantity: number;
  materialCost: number;
  laborHours: number;
}

export interface ActualLine {
  code: string;
  unit: string;
  quantity: number;
  materialCost: number;
  laborHours: number;
}

export interface ExpectedTotals {
  materialBase: number;
  laborHoursBase: number;
  bidPrice: number;
}

/** Same fields, produced by the app rather than recorded by the estimator. */
export type ActualTotals = ExpectedTotals;

/** Quantity the app carried but could not price, straight from EstimateIssue. */
export interface OpenItem {
  kind: string;
  detail: string;
  severity: "missing" | "warning";
}

export interface FieldDifference {
  field: "quantity" | "materialCost" | "laborHours" | "unit";
  expected: number | string;
  actual: number | string;
  difference: number | null;
  tolerance: number | null;
}

export interface LineVerdict {
  code: string;
  status: "match" | "differs" | "missing-from-app" | "unexpected-in-app";
  differences: FieldDifference[];
}

export interface TotalVerdict {
  field: keyof ExpectedTotals;
  expected: number;
  actual: number;
  difference: number;
  within: boolean;
}

export interface ReconciliationInput {
  jobAlias: string;
  /** "synthetic" marks a run against repository fixtures, never a real job. */
  provenance: "synthetic" | "real";
  tolerances: Tolerances;
  expectedLines: ExpectedLine[];
  actualLines: ActualLine[];
  expectedTotals: ExpectedTotals;
  actualTotals: ActualTotals;
  openItems: OpenItem[];
  /** Scope the estimator knows Voltline cannot represent yet. */
  knownUnsupportedScope: string[];
}

export interface Reconciliation {
  jobAlias: string;
  provenance: "synthetic" | "real";
  lines: LineVerdict[];
  totals: TotalVerdict[];
  openItems: OpenItem[];
  knownUnsupportedScope: string[];
  /**
   * True when every total is within tolerance while at least one line is not:
   * the offsetting-error case. Reported separately because it is the one
   * result that most looks like success and is not.
   */
  offsettingDifferences: boolean;
  verdict: "reconciled" | "discrepancies" | "open-items";
}

function within(expected: number, actual: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance + Number.EPSILON * 8;
}

function quantityTolerance(line: ExpectedLine, tolerances: Tolerances): number {
  // A counted quantity has no tolerance at all; a measured one uses the
  // fraction the estimator recorded, never a default invented here.
  return line.kind === "counted" ? 0 : Math.abs(line.quantity) * tolerances.measuredFraction;
}

function compareLine(
  expected: ExpectedLine,
  actual: ActualLine,
  tolerances: Tolerances
): LineVerdict {
  const differences: FieldDifference[] = [];

  if (expected.unit !== actual.unit) {
    differences.push({
      field: "unit",
      expected: expected.unit,
      actual: actual.unit,
      difference: null,
      tolerance: null,
    });
  }

  const checks: { field: "quantity" | "materialCost" | "laborHours"; tolerance: number }[] = [
    { field: "quantity", tolerance: quantityTolerance(expected, tolerances) },
    { field: "materialCost", tolerance: tolerances.currency },
    { field: "laborHours", tolerance: tolerances.laborHours },
  ];

  for (const { field, tolerance } of checks) {
    if (!within(expected[field], actual[field], tolerance)) {
      differences.push({
        field,
        expected: expected[field],
        actual: actual[field],
        difference: actual[field] - expected[field],
        tolerance,
      });
    }
  }

  return {
    code: expected.code,
    status: differences.length === 0 ? "match" : "differs",
    differences,
  };
}

export function reconcile(input: ReconciliationInput): Reconciliation {
  const actualByCode = new Map(input.actualLines.map((line) => [line.code, line]));
  const seen = new Set<string>();
  const lines: LineVerdict[] = [];

  for (const expected of input.expectedLines) {
    const actual = actualByCode.get(expected.code);
    seen.add(expected.code);
    if (!actual) {
      lines.push({ code: expected.code, status: "missing-from-app", differences: [] });
      continue;
    }
    lines.push(compareLine(expected, actual, input.tolerances));
  }

  // Quantity the app produced that the estimator never expected is a
  // discrepancy in its own right, not a rounding curiosity.
  for (const actual of input.actualLines) {
    if (!seen.has(actual.code)) {
      lines.push({ code: actual.code, status: "unexpected-in-app", differences: [] });
    }
  }

  const totals: TotalVerdict[] = (
    ["materialBase", "laborHoursBase", "bidPrice"] as (keyof ExpectedTotals)[]
  ).map((field) => {
    const expected = input.expectedTotals[field];
    const actual = input.actualTotals[field];
    const tolerance =
      field === "laborHoursBase" ? input.tolerances.laborHours : input.tolerances.currency;
    return {
      field,
      expected,
      actual,
      difference: actual - expected,
      within: within(expected, actual, tolerance),
    };
  });

  const linesAgree = lines.every((line) => line.status === "match");
  const totalsAgree = totals.every((total) => total.within);
  const hasOpenItems = input.openItems.length > 0 || input.knownUnsupportedScope.length > 0;

  return {
    jobAlias: input.jobAlias,
    provenance: input.provenance,
    lines,
    totals,
    openItems: input.openItems,
    knownUnsupportedScope: input.knownUnsupportedScope,
    offsettingDifferences: totalsAgree && !linesAgree,
    verdict: !linesAgree || !totalsAgree ? "discrepancies" : hasOpenItems ? "open-items" : "reconciled",
  };
}

function currency(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function renderReport(result: Reconciliation): string {
  const out: string[] = [];
  out.push(`Voltline acceptance reconciliation — ${result.jobAlias}`);
  if (result.provenance === "synthetic") {
    out.push("PROVENANCE: SYNTHETIC — repository fixture, not a customer estimate.");
    out.push("This run cannot establish real-estimate acceptance (gate G5).");
  } else {
    out.push("PROVENANCE: real job, estimator-supplied expectations.");
  }
  out.push("");

  const failed = result.lines.filter((line) => line.status !== "match");
  out.push(`Lines: ${result.lines.length - failed.length}/${result.lines.length} match`);
  for (const line of failed) {
    if (line.status !== "differs") {
      out.push(`  ${line.code}: ${line.status}`);
      continue;
    }
    for (const difference of line.differences) {
      const detail =
        difference.difference === null
          ? `expected ${difference.expected}, got ${difference.actual}`
          : `expected ${difference.expected}, got ${difference.actual} ` +
            `(off by ${difference.difference.toFixed(4)}, tolerance ${difference.tolerance})`;
      out.push(`  ${line.code} ${difference.field}: ${detail}`);
    }
  }
  out.push("");

  out.push("Totals:");
  for (const total of result.totals) {
    const format = total.field === "laborHoursBase" ? (v: number) => `${v} hr` : currency;
    out.push(
      `  ${total.field}: expected ${format(total.expected)}, got ${format(total.actual)}` +
        `${total.within ? "" : `  DIFFERS by ${total.difference.toFixed(4)}`}`
    );
  }
  out.push("");

  if (result.offsettingDifferences) {
    out.push("WARNING: every total is within tolerance but individual lines are not.");
    out.push("Offsetting material and labor errors produce exactly this result.");
    out.push("Do not accept on the strength of the total.");
    out.push("");
  }

  if (result.openItems.length > 0) {
    out.push("Open items — quantity carried but not priced:");
    for (const item of result.openItems) {
      out.push(`  [${item.severity}] ${item.kind}: ${item.detail}`);
    }
    out.push("");
  }

  if (result.knownUnsupportedScope.length > 0) {
    out.push("Known unsupported scope (never counted as a pass):");
    for (const scope of result.knownUnsupportedScope) out.push(`  - ${scope}`);
    out.push("");
  }

  out.push(`Verdict: ${result.verdict}`);
  if (result.verdict === "reconciled" && result.provenance === "synthetic") {
    out.push("Meaning: the harness works. Real acceptance remains pending.");
  }
  return out.join("\n");
}

/** Exit code for a runner: 0 only when nothing needs an estimator's attention. */
export function exitCodeFor(result: Reconciliation): number {
  return result.verdict === "reconciled" ? 0 : 1;
}
