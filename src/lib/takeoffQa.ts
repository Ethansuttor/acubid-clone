// Takeoff quality checks. Pure functions: sheets + layers + takeoffs in,
// findings out. No React, no I/O, no mutation of the inputs.
//
// These catch takeoff *mistakes* that still price cleanly. A count placed twice
// on one symbol extends into money without raising any estimate issue, and a
// sheet nobody measured contributes nothing without raising one either. Both
// are surfaced by bidPreflight() as WARNINGS, never blockers: ganged devices in
// one box and an intentionally empty sheet are legitimate, and a warning that
// can stop an issued bid must have no legitimate cause.
//
// Only confirmed takeoffs are compared (countableTakeoffs is an allowlist), so
// pending and rejected candidates never produce a duplicate finding. Quantities
// quoted in a finding come from layerQuantities(), the same function the bid
// uses, so the typical multiplier is applied by the shared rule and not
// re-derived here.

import { countableTakeoffs, layerQuantities } from "./estimate";
import { dist } from "./geometry";
import type { Layer, Sheet, Takeoff } from "./types";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * Two counts on one layer closer than this real distance, measured on a
 * calibrated sheet, are flagged as a possible duplicate: 0.25 ft, 3 in.
 *
 * Rationale: a one-gang wall plate is about 2.75 in wide, so two separate
 * devices on the same layer are normally further apart than 3 in. Anything
 * closer is almost always one symbol counted twice: clicked twice, or a manual
 * count plus an accepted auto-count candidate on the same symbol. At common
 * plan scales 3 in of real distance is a few
 * hundredths of an inch of paper (2.25 PDF units at 1/8 in = 1 ft), well under
 * the size of a drawn symbol, so a legitimate neighbour is not swept in. The
 * exception is devices ganged in one box, whose centres can be under 3 in
 * apart; that is why the result is a warning and not a blocker.
 *
 * "Closer than" is strict: a pair exactly 3 in apart is not flagged.
 */
export const DUPLICATE_COUNT_MAX_FT = 0.25;

/**
 * The same rule on a sheet with no calibration, in PDF user-space units
 * (72 per inch of paper): 3 units, about 0.04 in or 1 mm on paper, roughly
 * three screen pixels at 100% zoom. Counts need no scale, so an uncalibrated
 * sheet can still hold a double click. 3 units is what the 3 in rule works out
 * to at a 3/16 in = 1 ft plan (0.25 ft / 0.0741 ft per unit = 3.4 units), and is
 * smaller than any drawn symbol (7 or more units), so it stays a
 * same-spot test rather than a neighbour test.
 */
export const DUPLICATE_COUNT_MAX_UNITS = 3;

/**
 * Ceiling for the calibrated threshold once converted to PDF units: 6 units,
 * 1/12 in of paper, still smaller than a drawn symbol. A mistyped calibration
 * distance can make feet-per-unit far too small, which would turn a 3 in real
 * distance into hundreds of PDF units and flag every neighbour on the sheet.
 * At normal plan scales this never binds (3 in is 2.25 to 4.5 units for 1/8 in
 * to 1/4 in = 1 ft); it binds only when a sheet is drawn larger than 3 ft per
 * inch of paper (3/8 in = 1 ft and up), where it is a tighter, still physical,
 * distance.
 */
export const DUPLICATE_COUNT_UNITS_CAP = 6;

const INCHES_PER_FOOT = 12;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TakeoffQaInput {
  sheets: Sheet[];
  layers: Layer[];
  takeoffs: Takeoff[];
}

export interface DuplicateCountCluster {
  /** Two or more confirmed count takeoffs, in takeoff order, within reach of each other. */
  takeoffIds: string[];
}

/** One sheet and layer that holds suspect counts. One finding per pair, never per point. */
export interface DuplicateCountFinding {
  sheetId: string;
  sheetName: string;
  layerId: string;
  layerName: string;
  /** "calibrated": threshold is a real distance. "pdf-units": the sheet has no scale. */
  basis: "calibrated" | "pdf-units";
  /** The threshold actually applied, in PDF units. */
  thresholdUnits: number;
  /** The same threshold as a real distance in inches; null when the sheet is uncalibrated. */
  thresholdInches: number | null;
  clusters: DuplicateCountCluster[];
  /** Counts that sit inside a cluster, the first of each cluster included. */
  clusteredCount: number;
  /** clusteredCount minus one per cluster: the most that could be duplicates. */
  suspectCount: number;
  /** Closest pair on this sheet and layer, in PDF units. */
  closestUnits: number;
  /** The closest pair as a real distance in inches; null when the sheet is uncalibrated. */
  closestInches: number | null;
  /** What one count contributes on this layer: the typical multiplier, 1 when not typical. */
  countMultiplier: number;
  /** Bid quantity the suspect counts carry, after the typical multiplier. */
  suspectQuantity: number;
}

export interface EmptyCalibratedSheetFinding {
  sheetId: string;
  sheetName: string;
  /** Candidates the estimator rejected on this sheet; context only, they never count. */
  rejectedCount: number;
}

export interface TakeoffQaCheck {
  id: "duplicate-counts" | "empty-calibrated-sheets";
  title: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Feet per PDF unit when the sheet is calibrated, otherwise null. Mirrors takeoffQuantity(). */
function calibratedScale(sheet: Pick<Sheet, "scale_ft_per_unit">): number | null {
  const scale = sheet.scale_ft_per_unit;
  return typeof scale === "number" && Number.isFinite(scale) && scale > 0 ? scale : null;
}

function sheetLabel(sheet: Sheet): string {
  return sheet.name?.trim() || `Page ${sheet.page_number}`;
}

/** The duplicate threshold for a sheet, in PDF units, and the basis it was judged on. */
export function duplicateCountThreshold(sheet: Pick<Sheet, "scale_ft_per_unit">): {
  basis: "calibrated" | "pdf-units";
  units: number;
} {
  const scale = calibratedScale(sheet);
  if (scale === null) return { basis: "pdf-units", units: DUPLICATE_COUNT_MAX_UNITS };
  return {
    basis: "calibrated",
    units: Math.min(DUPLICATE_COUNT_MAX_FT / scale, DUPLICATE_COUNT_UNITS_CAP),
  };
}

interface CountPoint {
  takeoff: Takeoff;
  x: number;
  y: number;
}

function countPoint(takeoff: Takeoff): CountPoint | null {
  if (takeoff.kind !== "count") return null;
  const geometry = takeoff.geometry as { x?: unknown; y?: unknown } | null | undefined;
  const x = geometry?.x;
  const y = geometry?.y;
  if (typeof x !== "number" || typeof y !== "number") return null;
  // A point that cannot be placed cannot be compared; it is not a suspect.
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { takeoff, x, y };
}

/**
 * Single-linkage clusters of points closer than `radius`, found with a uniform
 * grid so a sheet with thousands of counts stays linear in practice. Returns
 * the clusters (two or more point indexes, ascending) and, per cluster, the
 * distance between its closest pair.
 */
function clusterClosePoints(
  points: CountPoint[],
  radius: number
): { members: number[]; closest: number }[] {
  const parent = points.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    // Path compression.
    while (parent[index] !== root) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
  };

  // Cell size is at least the radius, so any two points closer than the radius
  // sit in the same or adjacent cells. The floor guards a degenerate radius and
  // the margin absorbs division rounding.
  const cell = Math.max(radius, 1e-9) * 1.000001;
  const cellIndex = (value: number) => Math.floor(value / cell);
  const grid = new Map<string, number[]>();
  const nearest = new Array<number>(points.length).fill(Number.POSITIVE_INFINITY);

  for (let i = 0; i < points.length; i++) {
    const cx = cellIndex(points[i].x);
    const cy = cellIndex(points[i].y);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(`${cx + dx},${cy + dy}`);
        if (!bucket) continue;
        for (const j of bucket) {
          const d = dist([points[i].x, points[i].y], [points[j].x, points[j].y]);
          if (d >= radius) continue;
          union(i, j);
          if (d < nearest[i]) nearest[i] = d;
          if (d < nearest[j]) nearest[j] = d;
        }
      }
    }
    const key = `${cx},${cy}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < points.length; i++) {
    const root = find(i);
    const list = groups.get(root);
    if (list) list.push(i);
    else groups.set(root, [i]);
  }
  const clusters: { members: number[]; closest: number }[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    let closest = Number.POSITIVE_INFINITY;
    for (const index of members) if (nearest[index] < closest) closest = nearest[index];
    clusters.push({ members, closest });
  }
  // Roots are the lowest member index, so this is takeoff order.
  clusters.sort((a, b) => a.members[0] - b.members[0]);
  return clusters;
}

// ---------------------------------------------------------------------------
// Possible duplicate counts
// ---------------------------------------------------------------------------

/**
 * Confirmed count takeoffs on the same sheet AND layer that sit closer than the
 * duplicate threshold. Different layers at one point are different scope and are
 * never flagged; nor are counts on different sheets, or pending and rejected
 * candidates. Findings follow sheet order, then layer order.
 */
export function findDuplicateCounts(input: TakeoffQaInput): DuplicateCountFinding[] {
  const sheetIndex = new Map(input.sheets.map((sheet, index) => [sheet.id, index]));
  const layerIndex = new Map(input.layers.map((layer, index) => [layer.id, index]));

  // Group by sheet and layer. Takeoffs whose sheet or layer no longer exists are
  // not in the bid (layerQuantities skips them), so they cannot be duplicates in it.
  const groups = new Map<string, CountPoint[]>();
  for (const takeoff of countableTakeoffs(input.takeoffs)) {
    if (!sheetIndex.has(takeoff.sheet_id) || !layerIndex.has(takeoff.layer_id)) continue;
    const point = countPoint(takeoff);
    if (!point) continue;
    const key = `${takeoff.sheet_id}\u0000${takeoff.layer_id}`;
    const list = groups.get(key);
    if (list) list.push(point);
    else groups.set(key, [point]);
  }

  const findings: DuplicateCountFinding[] = [];
  for (const points of groups.values()) {
    if (points.length < 2) continue;
    const sheet = input.sheets[sheetIndex.get(points[0].takeoff.sheet_id)!];
    const layer = input.layers[layerIndex.get(points[0].takeoff.layer_id)!];
    const threshold = duplicateCountThreshold(sheet);
    const clusters = clusterClosePoints(points, threshold.units);
    if (clusters.length === 0) continue;

    const scale = calibratedScale(sheet);
    const toInches = (units: number) =>
      scale === null ? null : units * scale * INCHES_PER_FOOT;

    // Everything in a cluster except its first count could be a duplicate.
    const suspects = clusters.flatMap((cluster) =>
      cluster.members.slice(1).map((index) => points[index].takeoff)
    );
    let closestUnits = Number.POSITIVE_INFINITY;
    for (const cluster of clusters) if (cluster.closest < closestUnits) closestUnits = cluster.closest;
    findings.push({
      sheetId: sheet.id,
      sheetName: sheetLabel(sheet),
      layerId: layer.id,
      layerName: layer.name,
      basis: threshold.basis,
      thresholdUnits: threshold.units,
      thresholdInches: toInches(threshold.units),
      clusters: clusters.map((cluster) => ({
        takeoffIds: cluster.members.map((index) => points[index].takeoff.id),
      })),
      clusteredCount: clusters.reduce((sum, cluster) => sum + cluster.members.length, 0),
      suspectCount: suspects.length,
      closestUnits,
      closestInches: toInches(closestUnits),
      // The bid's own function applies the typical multiplier.
      countMultiplier: layerQuantities([layer], suspects.slice(0, 1), [sheet])[0].quantity,
      suspectQuantity: layerQuantities([layer], suspects, [sheet])[0].quantity,
    });
  }

  findings.sort((a, b) => {
    const sheetOrder = sheetIndex.get(a.sheetId)! - sheetIndex.get(b.sheetId)!;
    return sheetOrder || layerIndex.get(a.layerId)! - layerIndex.get(b.layerId)!;
  });
  return findings;
}

// ---------------------------------------------------------------------------
// Calibrated sheets with no takeoffs
// ---------------------------------------------------------------------------

/**
 * Calibrated sheets that carry no confirmed and no pending takeoff: likely
 * missed sheets, since calibrating a sheet means someone started measuring it.
 *
 * Uncalibrated sheets are never reported: covers, legends, schedules and
 * details are normally left without a scale and have nothing to count. A sheet
 * with pending candidates is mid-review, which pending-ai already blocks on, so
 * it is not called empty. A sheet whose candidates were all rejected still
 * contributes nothing to the bid and is reported, with the rejected count as
 * context.
 */
export function findEmptyCalibratedSheets(
  input: Pick<TakeoffQaInput, "sheets" | "takeoffs">
): EmptyCalibratedSheetFinding[] {
  const inProgress = new Set<string>();
  const rejected = new Map<string, number>();
  for (const takeoff of input.takeoffs) {
    if (takeoff.status === "rejected") {
      rejected.set(takeoff.sheet_id, (rejected.get(takeoff.sheet_id) ?? 0) + 1);
    } else if (takeoff.status === "confirmed" || takeoff.status === "pending") {
      inProgress.add(takeoff.sheet_id);
    }
  }
  return input.sheets
    .filter((sheet) => calibratedScale(sheet) !== null && !inProgress.has(sheet.id))
    .map((sheet) => ({
      sheetId: sheet.id,
      sheetName: sheetLabel(sheet),
      rejectedCount: rejected.get(sheet.id) ?? 0,
    }));
}

// ---------------------------------------------------------------------------
// Preflight checks
// ---------------------------------------------------------------------------

/** Findings named in a check's detail before it summarises the rest. */
const NAMED_FINDINGS = 5;

/** Display only: whole numbers stay whole, everything else keeps at most one decimal. */
function shortNumber(value: number): string {
  return String(Number(value.toFixed(1)));
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function describeDuplicateFinding(finding: DuplicateCountFinding): string {
  const calibrated = finding.thresholdInches !== null && finding.closestInches !== null;
  const within = calibrated
    ? `${shortNumber(finding.thresholdInches!)} in`
    : `${shortNumber(finding.thresholdUnits)} PDF units`;
  const closestUnits = shortNumber(finding.closestUnits);
  const closest = calibrated
    ? `${shortNumber(finding.closestInches!)} in`
    : `${closestUnits} PDF ${closestUnits === "1" ? "unit" : "units"}`;
  const spots = finding.clusters.length;
  const extra = finding.suspectCount;
  let text =
    `${finding.sheetName}${calibrated ? "" : " (no scale set)"}, layer ${finding.layerName}: ` +
    `${finding.clusteredCount} counts in ${spots} ${plural(spots, "spot", "spots")} within ` +
    `${within} of each other (closest ${closest}); up to ${extra} ` +
    `${plural(extra, "count is", "counts are")} extra.`;
  if (finding.countMultiplier > 1) {
    text +=
      ` This layer is typical x${shortNumber(finding.countMultiplier)}, so each extra count is` +
      ` multiplied and adds ${shortNumber(finding.suspectQuantity)} to the bid quantity.`;
  }
  return text;
}

function describeDuplicates(findings: DuplicateCountFinding[]): string {
  const named = findings.slice(0, NAMED_FINDINGS).map(describeDuplicateFinding);
  const more = findings.length - named.length;
  return [
    "Counts on one layer sit almost on top of each other, so a device may be counted twice.",
    ...named,
    ...(more > 0
      ? [`${more} more ${plural(more, "sheet and layer combination", "sheet and layer combinations")}.`]
      : []),
    "Ganged devices in one box can be legitimate; delete any count that is a double click.",
  ].join(" ");
}

function describeEmptySheets(findings: EmptyCalibratedSheetFinding[]): string {
  const named = findings.slice(0, NAMED_FINDINGS).map((finding) =>
    finding.rejectedCount > 0
      ? `${finding.sheetName} (${finding.rejectedCount} rejected ${plural(finding.rejectedCount, "candidate", "candidates")})`
      : finding.sheetName
  );
  const more = findings.length - named.length;
  const list = named.join(", ") + (more > 0 ? ` and ${more} more` : "");
  const verb = findings.length === 1 ? "is calibrated but has" : "are calibrated but have";
  return (
    `${list} ${verb} no confirmed takeoff, so nothing from ` +
    `${findings.length === 1 ? "it" : "them"} is in this bid. Confirm no electrical scope was missed; ` +
    "covers, legends and schedules are normally left uncalibrated."
  );
}

/**
 * The takeoff quality warnings for bidPreflight(). Every result is advisory by
 * construction: there is no severity here to promote to a blocker.
 */
export function takeoffQaChecks(input: TakeoffQaInput): TakeoffQaCheck[] {
  const checks: TakeoffQaCheck[] = [];
  const duplicates = findDuplicateCounts(input);
  if (duplicates.length > 0) {
    checks.push({
      id: "duplicate-counts",
      title: "Possible duplicate counts",
      detail: describeDuplicates(duplicates),
    });
  }
  const emptySheets = findEmptyCalibratedSheets(input);
  if (emptySheets.length > 0) {
    checks.push({
      id: "empty-calibrated-sheets",
      title: "Calibrated sheets have no takeoffs",
      detail: describeEmptySheets(emptySheets),
    });
  }
  return checks;
}
