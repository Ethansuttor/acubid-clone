import { describe, expect, it } from "vitest";
import {
  DUPLICATE_COUNT_MAX_FT,
  DUPLICATE_COUNT_MAX_UNITS,
  DUPLICATE_COUNT_UNITS_CAP,
  duplicateCountThreshold,
  findDuplicateCounts,
  findEmptyCalibratedSheets,
  takeoffQaChecks,
} from "@/lib/takeoffQa";
import { countableTakeoffs, layerQuantities } from "@/lib/estimate";
import type { Layer, Sheet, Takeoff } from "@/lib/types";

// Every distance below is worked out by hand in the comment beside it.
//
// The main calibrated sheet, CAL, is 0.125 ft per PDF unit (1 unit = 1.5 in).
// That scale is exact in binary floating point, so the threshold is exact:
//   DUPLICATE_COUNT_MAX_FT / 0.125 = 0.25 / 0.125 = 2 units = 3 in
// and "closer than" can be tested right at the boundary.

const U = "u";

function sheet(
  id: string,
  name: string,
  scale: number | null,
  patch: Partial<Sheet> = {}
): Sheet {
  return {
    id,
    document_id: "d1",
    project_id: "p1",
    user_id: U,
    page_number: 1,
    name,
    scale_ft_per_unit: scale,
    calibration: scale === null ? null : { p1: [0, 0], p2: [100, 0], distance_ft: 100 * scale },
    ...patch,
  };
}

function layer(id: string, name: string, patch: Partial<Layer> = {}): Layer {
  return {
    id,
    project_id: "p1",
    user_id: U,
    name,
    color: "#f59e0b",
    tool: "count",
    item_id: null,
    assembly_id: null,
    rise_drop_ft: 0,
    typical_multiplier: 1,
    sort_order: 0,
    ...patch,
  };
}

let seq = 0;
function count(
  layerId: string,
  sheetId: string,
  x: number,
  y: number,
  status: Takeoff["status"] = "confirmed",
  id = `t${seq++}`
): Takeoff {
  return {
    id,
    layer_id: layerId,
    sheet_id: sheetId,
    project_id: "p1",
    user_id: U,
    kind: "count",
    geometry: { x, y },
    source: "manual",
    status,
    ai_confidence: null,
  };
}

const CAL = sheet("cal", "E-101", 0.125);
const UNCAL = sheet("unc", "E-102", null);
const REC = layer("rec", "Receptacles");
const LTG = layer("ltg", "Troffers");

/** mulberry32: a small deterministic PRNG, so a failing seed can be replayed. */
function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function duplicatesOf(sheets: Sheet[], layers: Layer[], takeoffs: Takeoff[]) {
  return findDuplicateCounts({ sheets, layers, takeoffs });
}

describe("duplicate count thresholds", () => {
  it("states the real-distance rule as 3 in, and the PDF-unit fallback as 3 units", () => {
    expect(DUPLICATE_COUNT_MAX_FT).toBe(0.25);
    expect(DUPLICATE_COUNT_MAX_FT * 12).toBe(3);
    expect(DUPLICATE_COUNT_MAX_UNITS).toBe(3);
    expect(DUPLICATE_COUNT_UNITS_CAP).toBe(6);
  });

  it("converts 3 in to PDF units through the sheet's own scale", () => {
    // 0.125 ft/unit: 0.25 / 0.125 = 2 units.
    expect(duplicateCountThreshold(CAL)).toEqual({ basis: "calibrated", units: 2 });
    // 0.05 ft/unit: 0.25 / 0.05 = 5 units.
    expect(duplicateCountThreshold(sheet("s", "s", 0.05)).units).toBeCloseTo(5, 12);
    // No scale: the PDF-unit rule.
    expect(duplicateCountThreshold(UNCAL)).toEqual({ basis: "pdf-units", units: 3 });
  });

  it("caps the calibrated threshold so a wrong calibration cannot flag every neighbour", () => {
    // 0.01 ft/unit: 0.25 / 0.01 = 25 units, capped at 6.
    expect(duplicateCountThreshold(sheet("s", "s", 0.01))).toEqual({ basis: "calibrated", units: 6 });
    // 0.0001 ft/unit (a mistyped distance): 2500 units, still 6.
    expect(duplicateCountThreshold(sheet("s", "s", 0.0001)).units).toBe(6);
  });

  it.each([
    ["zero", 0],
    ["negative", -0.1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("treats a %s scale as uncalibrated, as takeoffQuantity does", (_label, scale) => {
    expect(duplicateCountThreshold(sheet("s", "s", scale))).toEqual({
      basis: "pdf-units",
      units: 3,
    });
  });
});

describe("findDuplicateCounts: distance boundary on a calibrated sheet (threshold 2 units = 3 in)", () => {
  it("flags a pair just inside 3 in", () => {
    // (100,100) to (101.9,100): 1.9 units x 0.125 = 0.2375 ft = 2.85 in < 3 in.
    const found = duplicatesOf(
      [CAL],
      [REC],
      [count("rec", "cal", 100, 100), count("rec", "cal", 101.9, 100)]
    );
    expect(found).toHaveLength(1);
    expect(found[0].suspectCount).toBe(1);
    expect(found[0].closestInches).toBeCloseTo(2.85, 9);
  });

  it("does not flag a pair just outside 3 in", () => {
    // (100,100) to (102.1,100): 2.1 units x 0.125 = 0.2625 ft = 3.15 in > 3 in.
    expect(
      duplicatesOf([CAL], [REC], [count("rec", "cal", 100, 100), count("rec", "cal", 102.1, 100)])
    ).toEqual([]);
  });

  it("does not flag a pair exactly 3 in apart: closer than is strict", () => {
    // (100,100) to (102,100): 2 units x 0.125 = 0.25 ft = 3 in exactly.
    expect(
      duplicatesOf([CAL], [REC], [count("rec", "cal", 100, 100), count("rec", "cal", 102, 100)])
    ).toEqual([]);
  });

  it("measures diagonals, not just axes", () => {
    // (0,0) to (0.9,1.2): sqrt(0.81 + 1.44) = sqrt(2.25) = 1.5 units = 0.1875 ft = 2.25 in.
    const found = duplicatesOf(
      [CAL],
      [REC],
      [count("rec", "cal", 0, 0), count("rec", "cal", 0.9, 1.2)]
    );
    expect(found).toHaveLength(1);
    expect(found[0].closestUnits).toBeCloseTo(1.5, 12);
    expect(found[0].closestInches).toBeCloseTo(2.25, 9);
  });

  it("flags two counts on exactly the same point at 0 in", () => {
    const found = duplicatesOf(
      [CAL],
      [REC],
      [count("rec", "cal", 300, 400), count("rec", "cal", 300, 400)]
    );
    expect(found).toHaveLength(1);
    expect(found[0].closestUnits).toBe(0);
    expect(found[0].closestInches).toBe(0);
  });

  it("finds pairs that straddle a grid cell edge and still rejects distant ones", () => {
    // The finder buckets points into cells about 2 units wide. (1.999,0) and
    // (2.001,0) straddle the edge at x = 2 and are 0.002 units = 0.003 in apart.
    expect(
      duplicatesOf([CAL], [REC], [count("rec", "cal", 1.999, 0), count("rec", "cal", 2.001, 0)])
    ).toHaveLength(1);
    // (1.9,0) and (4.0,0) are in different cells and 2.1 units = 3.15 in apart.
    expect(
      duplicatesOf([CAL], [REC], [count("rec", "cal", 1.9, 0), count("rec", "cal", 4.0, 0)])
    ).toEqual([]);
  });
});

describe("findDuplicateCounts: calibrated versus uncalibrated sheets", () => {
  it("uses 3 PDF units when the sheet has no scale", () => {
    // (50,50) to (52.9,50): 2.9 units < 3 -> flagged, judged in PDF units.
    const inside = duplicatesOf(
      [UNCAL],
      [REC],
      [count("rec", "unc", 50, 50), count("rec", "unc", 52.9, 50)]
    );
    expect(inside).toHaveLength(1);
    expect(inside[0].basis).toBe("pdf-units");
    expect(inside[0].thresholdUnits).toBe(3);
    expect(inside[0].thresholdInches).toBeNull();
    expect(inside[0].closestInches).toBeNull();
    // 3.1 units > 3 -> not flagged; exactly 3 units is not closer than 3.
    expect(
      duplicatesOf([UNCAL], [REC], [count("rec", "unc", 50, 50), count("rec", "unc", 53.1, 50)])
    ).toEqual([]);
    expect(
      duplicatesOf([UNCAL], [REC], [count("rec", "unc", 50, 50), count("rec", "unc", 53, 50)])
    ).toEqual([]);
  });

  it("judges the same 2.5-unit gap differently on each basis", () => {
    const pair = (sheetId: string) => [
      count("rec", sheetId, 200, 200),
      count("rec", sheetId, 202.5, 200),
    ];
    // Calibrated 0.125 ft/unit: 2.5 x 0.125 = 0.3125 ft = 3.75 in > 3 in -> not flagged.
    expect(duplicatesOf([CAL], [REC], pair("cal"))).toEqual([]);
    // Uncalibrated: 2.5 units < 3 units -> flagged.
    expect(duplicatesOf([UNCAL], [REC], pair("unc"))).toHaveLength(1);
  });

  it("uses real distance on a fine-scale sheet where 3 in spans more than 3 units", () => {
    // 0.05 ft/unit: threshold 0.25 / 0.05 = 5 units. A 4-unit gap is
    // 4 x 0.05 = 0.2 ft = 2.4 in < 3 in -> flagged, though 4 > 3 units.
    const fine = sheet("fine", "E-103", 0.05);
    const found = duplicatesOf(
      [fine],
      [REC],
      [count("rec", "fine", 10, 10), count("rec", "fine", 14, 10)]
    );
    expect(found).toHaveLength(1);
    expect(found[0].closestInches).toBeCloseTo(2.4, 9);
    // The same 4-unit gap on an uncalibrated sheet is not flagged.
    expect(
      duplicatesOf([UNCAL], [REC], [count("rec", "unc", 10, 10), count("rec", "unc", 14, 10)])
    ).toEqual([]);
  });

  it("stops at the unit cap when the calibration makes 3 in absurdly many units", () => {
    // 0.01 ft/unit: 3 in would be 25 units; the cap makes it 6 units = 0.06 ft = 0.72 in.
    const big = sheet("big", "E-104", 0.01);
    // 5.9 units = 0.059 ft = 0.708 in < 0.72 in -> flagged.
    const flagged = duplicatesOf(
      [big],
      [REC],
      [count("rec", "big", 0, 0), count("rec", "big", 5.9, 0)]
    );
    expect(flagged).toHaveLength(1);
    expect(flagged[0].thresholdUnits).toBe(6);
    expect(flagged[0].thresholdInches).toBeCloseTo(0.72, 9);
    // 6.1 units = 0.061 ft = 0.732 in > 0.72 in -> not flagged, though it is well inside 3 in.
    expect(
      duplicatesOf([big], [REC], [count("rec", "big", 0, 0), count("rec", "big", 6.1, 0)])
    ).toEqual([]);
  });
});

describe("findDuplicateCounts: what is and is not compared", () => {
  it("does not flag different layers at one point", () => {
    expect(
      duplicatesOf(
        [CAL],
        [REC, LTG],
        [count("rec", "cal", 100, 100), count("ltg", "cal", 100, 100)]
      )
    ).toEqual([]);
  });

  it("does not flag the same point on different sheets", () => {
    const other = sheet("cal2", "E-102b", 0.125);
    expect(
      duplicatesOf(
        [CAL, other],
        [REC],
        [count("rec", "cal", 100, 100), count("rec", "cal2", 100, 100)]
      )
    ).toEqual([]);
  });

  it("ignores pending and rejected takeoffs", () => {
    // A confirmed count with a pending or rejected neighbour on top of it.
    expect(
      duplicatesOf(
        [CAL],
        [REC],
        [count("rec", "cal", 100, 100), count("rec", "cal", 100, 100, "pending")]
      )
    ).toEqual([]);
    expect(
      duplicatesOf(
        [CAL],
        [REC],
        [count("rec", "cal", 100, 100), count("rec", "cal", 100, 100, "rejected")]
      )
    ).toEqual([]);
    // Two pending on one spot are not confirmed either, so they are not compared.
    expect(
      duplicatesOf(
        [CAL],
        [REC],
        [count("rec", "cal", 100, 100, "pending"), count("rec", "cal", 100, 100, "pending")]
      )
    ).toEqual([]);
  });

  it("compares only confirmed takeoffs when a pending one sits between two", () => {
    // Confirmed A(0,0) and B(3,0): 3 units = 0.375 ft = 4.5 in apart, not close. A pending
    // takeoff at (1.5,0) would bridge them (1.5 units each), but it is not confirmed.
    expect(
      duplicatesOf(
        [CAL],
        [REC],
        [
          count("rec", "cal", 0, 0),
          count("rec", "cal", 1.5, 0, "pending"),
          count("rec", "cal", 3, 0),
        ]
      )
    ).toEqual([]);
  });

  it("ignores linear and area takeoffs and malformed count geometry", () => {
    const linear: Takeoff = {
      ...count("rec", "cal", 0, 0),
      kind: "linear",
      geometry: { points: [[0, 0], [0, 0]] },
    };
    const nan = count("rec", "cal", Number.NaN, 5);
    const noGeometry = { ...count("rec", "cal", 0, 0), geometry: null } as unknown as Takeoff;
    const infinite = count("rec", "cal", Number.POSITIVE_INFINITY, 5);
    expect(
      duplicatesOf(
        [CAL],
        [REC],
        [linear, nan, noGeometry, infinite, count("rec", "cal", 0, 0)]
      )
    ).toEqual([]);
  });

  it("skips takeoffs whose sheet or layer is gone, since the bid does not count them", () => {
    expect(
      duplicatesOf([CAL], [REC], [count("rec", "ghost", 1, 1), count("rec", "ghost", 1, 1)])
    ).toEqual([]);
    expect(
      duplicatesOf([CAL], [REC], [count("ghost", "cal", 1, 1), count("ghost", "cal", 1, 1)])
    ).toEqual([]);
  });
});

describe("findDuplicateCounts: clusters and one finding per sheet and layer", () => {
  it("reports one finding with clusters, not one warning per point", () => {
    // CAL threshold is 2 units.
    //   a (0,0), b (1.5,0), c (3,0): a-b 1.5 and b-c 1.5 are each under 2, a-c is 3.
    //     Linked through b they form ONE cluster of 3 -> 2 could be duplicates.
    //   d (500,500), e (500.5,500): 0.5 units apart -> a second cluster of 2 -> 1 more.
    //   f (900,900): alone, no neighbour -> not part of any cluster.
    const takeoffs = [
      count("rec", "cal", 0, 0, "confirmed", "a"),
      count("rec", "cal", 1.5, 0, "confirmed", "b"),
      count("rec", "cal", 3, 0, "confirmed", "c"),
      count("rec", "cal", 500, 500, "confirmed", "d"),
      count("rec", "cal", 500.5, 500, "confirmed", "e"),
      count("rec", "cal", 900, 900, "confirmed", "f"),
    ];
    const found = duplicatesOf([CAL], [REC], takeoffs);
    expect(found).toHaveLength(1);
    const [finding] = found;
    expect(finding.sheetName).toBe("E-101");
    expect(finding.layerName).toBe("Receptacles");
    expect(finding.clusters.map((cluster) => cluster.takeoffIds)).toEqual([
      ["a", "b", "c"],
      ["d", "e"],
    ]);
    expect(finding.clusteredCount).toBe(5);
    expect(finding.suspectCount).toBe(3); // (3 - 1) + (2 - 1)
    // Closest pair is d-e: 0.5 units x 0.125 = 0.0625 ft = 0.75 in.
    expect(finding.closestUnits).toBeCloseTo(0.5, 12);
    expect(finding.closestInches).toBeCloseTo(0.75, 9);
  });

  it("reports one finding per sheet and layer pair, in sheet then layer order", () => {
    const second = sheet("cal2", "E-102b", 0.125, { page_number: 2 });
    const takeoffs = [
      // Later sheet and later layer listed first: output order must not follow takeoff order.
      count("ltg", "cal2", 5, 5),
      count("ltg", "cal2", 5, 5),
      count("rec", "cal2", 5, 5),
      count("rec", "cal2", 5, 5),
      count("ltg", "cal", 5, 5),
      count("ltg", "cal", 5, 5),
      count("rec", "cal", 5, 5),
      count("rec", "cal", 5, 5),
    ];
    const found = duplicatesOf([CAL, second], [REC, LTG], takeoffs);
    expect(found.map((f) => [f.sheetName, f.layerName])).toEqual([
      ["E-101", "Receptacles"],
      ["E-101", "Troffers"],
      ["E-102b", "Receptacles"],
      ["E-102b", "Troffers"],
    ]);
  });

  it("names the sheet by page number when it has no name", () => {
    const unnamed = sheet("cal3", "  ", 0.125, { page_number: 7 });
    const found = duplicatesOf(
      [unnamed],
      [REC],
      [count("rec", "cal3", 5, 5), count("rec", "cal3", 5, 5)]
    );
    expect(found[0].sheetName).toBe("Page 7");
  });
});

describe("findDuplicateCounts: typical multiplier", () => {
  it("multiplies the duplicate on a typical layer and says so", () => {
    // Typical x4: one extra count is 1 x 4 = 4 in the bid.
    const typical = layer("rec", "Receptacles", { typical_multiplier: 4 });
    const found = duplicatesOf(
      [CAL],
      [typical],
      [count("rec", "cal", 10, 10), count("rec", "cal", 10, 10)]
    );
    expect(found[0].countMultiplier).toBe(4);
    expect(found[0].suspectCount).toBe(1);
    expect(found[0].suspectQuantity).toBe(4);
    const [check] = takeoffQaChecks({
      sheets: [CAL],
      layers: [typical],
      takeoffs: [count("rec", "cal", 10, 10), count("rec", "cal", 10, 10)],
    });
    expect(check.detail).toContain("typical x4");
    expect(check.detail).toContain("multiplied");
    expect(check.detail).toContain("adds 4 to the bid quantity");
  });

  it("carries a three-count cluster on a typical x4 layer as 2 extra x 4 = 8", () => {
    const typical = layer("rec", "Receptacles", { typical_multiplier: 4 });
    const found = duplicatesOf(
      [CAL],
      [typical],
      [count("rec", "cal", 0, 0), count("rec", "cal", 1, 0), count("rec", "cal", 2, 0)]
    );
    expect(found[0].suspectCount).toBe(2);
    expect(found[0].suspectQuantity).toBe(8);
  });

  it("agrees with the bid: removing the suspects lowers the bid quantity by suspectQuantity", () => {
    const typical = layer("rec", "Receptacles", { typical_multiplier: 3 });
    const takeoffs = [
      count("rec", "cal", 0, 0, "confirmed", "keep"),
      count("rec", "cal", 0.5, 0, "confirmed", "dup1"),
      count("rec", "cal", 1, 0, "confirmed", "dup2"),
      count("rec", "cal", 50, 50, "confirmed", "far"),
    ];
    const [finding] = duplicatesOf([CAL], [typical], takeoffs);
    const bidQuantity = (list: Takeoff[]) =>
      layerQuantities([typical], countableTakeoffs(list), [CAL])[0].quantity;
    // Bid: 4 counts x 3 = 12. Without dup1 and dup2: 2 x 3 = 6. Difference 6 = 2 extra x 3.
    expect(bidQuantity(takeoffs)).toBe(12);
    const withoutSuspects = takeoffs.filter((t) => t.id !== "dup1" && t.id !== "dup2");
    expect(bidQuantity(withoutSuspects)).toBe(6);
    expect(finding.suspectQuantity).toBe(bidQuantity(takeoffs) - bidQuantity(withoutSuspects));
  });

  it("does not mention a multiplier on a layer that is not typical", () => {
    const [check] = takeoffQaChecks({
      sheets: [CAL],
      layers: [REC],
      takeoffs: [count("rec", "cal", 10, 10), count("rec", "cal", 10, 10)],
    });
    expect(check.detail).not.toContain("typical");
    const [finding] = duplicatesOf(
      [CAL],
      [REC],
      [count("rec", "cal", 10, 10), count("rec", "cal", 10, 10)]
    );
    expect(finding.countMultiplier).toBe(1);
    expect(finding.suspectQuantity).toBe(1);
  });

  it("uses the bid's own multiplier rule, so an unusable multiplier counts as 1", () => {
    // layerQuantities treats a zero or non-finite multiplier as 1; the finding must agree.
    const broken = layer("rec", "Receptacles", { typical_multiplier: 0 });
    const [finding] = duplicatesOf(
      [CAL],
      [broken],
      [count("rec", "cal", 10, 10), count("rec", "cal", 10, 10)]
    );
    expect(finding.countMultiplier).toBe(1);
  });
});

describe("findDuplicateCounts: grid search matches a brute-force reference", () => {
  // A plain O(n^2) single-linkage search, written independently of the module.
  function reference(points: { id: string; x: number; y: number }[], radius: number) {
    const seen = new Set<string>();
    const clusters: string[][] = [];
    for (const start of points) {
      if (seen.has(start.id)) continue;
      const queue = [start];
      const members: typeof points = [];
      seen.add(start.id);
      while (queue.length > 0) {
        const current = queue.pop()!;
        members.push(current);
        for (const other of points) {
          if (seen.has(other.id)) continue;
          if (Math.hypot(current.x - other.x, current.y - other.y) < radius) {
            seen.add(other.id);
            queue.push(other);
          }
        }
      }
      if (members.length > 1) {
        clusters.push(members.map((m) => m.id).sort());
      }
    }
    return clusters.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }

  it.each([
    [1, 0.125],
    [2, 0.05],
    [3, null],
    [4, 0.01],
  ])("seed %i, scale %s", (seed, scale) => {
    const random = seededRandom(seed);
    const s = sheet("prop", "E-999", scale as number | null);
    const points = Array.from({ length: 400 }, (_, i) => ({
      id: `p${i}`,
      // 400 points in 200 x 200 units: about one neighbour per two points at the
      // widest radius used here, so clusters of several sizes form without one
      // giant component swallowing them all.
      x: random() * 200,
      y: random() * 200,
    }));
    const takeoffs = points.map((p) => count("rec", "prop", p.x, p.y, "confirmed", p.id));
    const [finding] = duplicatesOf([s], [REC], takeoffs);
    const radius = duplicateCountThreshold(s).units;
    const expected = reference(points, radius);
    expect(expected.length).toBeGreaterThan(0);
    const actual = finding.clusters
      .map((cluster) => [...cluster.takeoffIds].sort())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    expect(actual).toEqual(expected);
  });

  it("handles 20,000 spread-out counts quickly", () => {
    const random = seededRandom(99);
    const takeoffs = Array.from({ length: 20000 }, (_, i) =>
      count("rec", "cal", random() * 3000, random() * 3000, "confirmed", `q${i}`)
    );
    const started = performance.now();
    const found = duplicatesOf([CAL], [REC], takeoffs);
    const elapsed = performance.now() - started;
    expect(Array.isArray(found)).toBe(true);
    // Generous bound: this is a smoke test against a quadratic scan, not a benchmark.
    expect(elapsed).toBeLessThan(2000);
  });
});

describe("findEmptyCalibratedSheets", () => {
  it("flags a calibrated sheet with no takeoffs", () => {
    expect(findEmptyCalibratedSheets({ sheets: [CAL], takeoffs: [] })).toEqual([
      { sheetId: "cal", sheetName: "E-101", rejectedCount: 0 },
    ]);
  });

  it("does not flag an uncalibrated sheet: covers, legends and schedules have no scale", () => {
    expect(findEmptyCalibratedSheets({ sheets: [UNCAL], takeoffs: [] })).toEqual([]);
  });

  it.each([
    ["null", null],
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
  ])("treats a %s scale as uncalibrated", (_label, scale) => {
    expect(
      findEmptyCalibratedSheets({ sheets: [sheet("s", "S", scale)], takeoffs: [] })
    ).toEqual([]);
  });

  it("does not flag a calibrated sheet that has a confirmed takeoff", () => {
    expect(
      findEmptyCalibratedSheets({ sheets: [CAL], takeoffs: [count("rec", "cal", 1, 1)] })
    ).toEqual([]);
  });

  it("does not flag a sheet that has pending candidates: it is mid-review and pending-ai blocks", () => {
    expect(
      findEmptyCalibratedSheets({
        sheets: [CAL],
        takeoffs: [count("rec", "cal", 1, 1, "pending")],
      })
    ).toEqual([]);
  });

  it("flags a sheet whose candidates were all rejected and reports how many", () => {
    expect(
      findEmptyCalibratedSheets({
        sheets: [CAL],
        takeoffs: [count("rec", "cal", 1, 1, "rejected"), count("rec", "cal", 2, 2, "rejected")],
      })
    ).toEqual([{ sheetId: "cal", sheetName: "E-101", rejectedCount: 2 }]);
  });

  it("does not flag a sheet with a rejected candidate and a confirmed count", () => {
    expect(
      findEmptyCalibratedSheets({
        sheets: [CAL],
        takeoffs: [count("rec", "cal", 1, 1, "rejected"), count("rec", "cal", 2, 2)],
      })
    ).toEqual([]);
  });

  it("counts takeoffs of any kind as work on the sheet", () => {
    const linear: Takeoff = {
      ...count("rec", "cal", 0, 0),
      kind: "linear",
      geometry: { points: [[0, 0], [10, 0]] },
    };
    expect(findEmptyCalibratedSheets({ sheets: [CAL], takeoffs: [linear] })).toEqual([]);
  });

  it("reports several sheets in sheet order and names unnamed ones by page", () => {
    const a = sheet("a", "E-201", 0.1, { page_number: 1 });
    const b = sheet("b", "", 0.1, { page_number: 5 });
    const worked = sheet("c", "E-203", 0.1, { page_number: 3 });
    expect(
      findEmptyCalibratedSheets({
        sheets: [a, b, worked, UNCAL],
        takeoffs: [count("rec", "c", 1, 1)],
      }).map((f) => f.sheetName)
    ).toEqual(["E-201", "Page 5"]);
  });
});

describe("takeoffQaChecks", () => {
  it("returns nothing for a clean takeoff", () => {
    expect(
      takeoffQaChecks({
        sheets: [CAL, UNCAL],
        layers: [REC],
        takeoffs: [count("rec", "cal", 0, 0), count("rec", "cal", 100, 100)],
      })
    ).toEqual([]);
  });

  it("writes the duplicate detail with the sheet, the layer, the distance and the exact figures", () => {
    // (10,10) to (11,10): 1 unit x 0.125 = 0.125 ft = 1.5 in apart.
    const [check] = takeoffQaChecks({
      sheets: [CAL],
      layers: [REC],
      takeoffs: [count("rec", "cal", 10, 10), count("rec", "cal", 11, 10)],
    });
    expect(check.id).toBe("duplicate-counts");
    expect(check.title).toBe("Possible duplicate counts");
    expect(check.detail).toBe(
      "Counts on one layer sit almost on top of each other, so a device may be counted twice. " +
        "E-101, layer Receptacles: 2 counts in 1 spot within 3 in of each other " +
        "(closest 1.5 in); up to 1 count is extra. " +
        "Ganged devices in one box can be legitimate; delete any count that is a double click."
    );
  });

  it("writes PDF units when the sheet has no scale", () => {
    const [check] = takeoffQaChecks({
      sheets: [UNCAL],
      layers: [REC],
      takeoffs: [count("rec", "unc", 10, 10), count("rec", "unc", 11, 10)],
    });
    expect(check.detail).toContain(
      "E-102 (no scale set), layer Receptacles: 2 counts in 1 spot within 3 PDF units " +
        "of each other (closest 1 PDF unit); up to 1 count is extra."
    );
  });

  it("names five findings and summarises the rest", () => {
    const sheets = Array.from({ length: 7 }, (_, i) => sheet(`s${i}`, `E-${i}`, 0.125));
    const takeoffs = sheets.flatMap((s) => [count("rec", s.id, 5, 5), count("rec", s.id, 5, 5)]);
    const [check] = takeoffQaChecks({ sheets, layers: [REC], takeoffs });
    for (const named of ["E-0", "E-1", "E-2", "E-3", "E-4"]) {
      expect(check.detail).toContain(`${named}, layer Receptacles`);
    }
    expect(check.detail).not.toContain("E-5, layer");
    expect(check.detail).toContain("2 more sheet and layer combinations.");
  });

  it("writes the empty-sheet detail, singular and plural", () => {
    const [one] = takeoffQaChecks({ sheets: [CAL], layers: [], takeoffs: [] });
    expect(one.id).toBe("empty-calibrated-sheets");
    expect(one.title).toBe("Calibrated sheets have no takeoffs");
    expect(one.detail).toBe(
      "E-101 is calibrated but has no confirmed takeoff, so nothing from it is in this bid. " +
        "Confirm no electrical scope was missed; covers, legends and schedules are normally left uncalibrated."
    );
    const [many] = takeoffQaChecks({
      sheets: [CAL, sheet("b", "E-102b", 0.1)],
      layers: [],
      takeoffs: [count("rec", "b", 1, 1, "rejected")],
    });
    expect(many.detail).toContain("E-101, E-102b (1 rejected candidate) are calibrated but have no confirmed takeoff");
    expect(many.detail).toContain("nothing from them is in this bid");
  });

  it("summarises more than five empty sheets", () => {
    const sheets = Array.from({ length: 8 }, (_, i) => sheet(`s${i}`, `E-${i}`, 0.1));
    const [check] = takeoffQaChecks({ sheets, layers: [], takeoffs: [] });
    expect(check.detail).toContain("E-0, E-1, E-2, E-3, E-4 and 3 more are calibrated");
  });

  it("returns both checks when both apply, duplicates first", () => {
    const checks = takeoffQaChecks({
      sheets: [CAL, sheet("empty", "E-105", 0.125)],
      layers: [REC],
      takeoffs: [count("rec", "cal", 10, 10), count("rec", "cal", 10, 10)],
    });
    expect(checks.map((c) => c.id)).toEqual(["duplicate-counts", "empty-calibrated-sheets"]);
    expect(checks[1].detail).toContain("E-105");
    expect(checks[1].detail).not.toContain("E-101");
  });
});

describe("purity", () => {
  it("does not mutate deeply frozen inputs and is deterministic", () => {
    const deepFreeze = <T,>(value: T): T => {
      if (value && typeof value === "object") {
        for (const child of Object.values(value)) deepFreeze(child);
        Object.freeze(value);
      }
      return value;
    };
    const input = deepFreeze({
      sheets: [CAL, UNCAL, sheet("empty", "E-105", 0.125)].map((s) => structuredClone(s)),
      layers: [layer("rec", "Receptacles", { typical_multiplier: 2 })],
      takeoffs: [
        count("rec", "cal", 10, 10),
        count("rec", "cal", 10.5, 10),
        count("rec", "unc", 1, 1),
        count("rec", "unc", 1, 1, "rejected"),
      ],
    });
    const first = takeoffQaChecks(input);
    expect(first.map((check) => check.id)).toEqual(["duplicate-counts", "empty-calibrated-sheets"]);
    for (let i = 0; i < 20; i++) expect(takeoffQaChecks(input)).toEqual(first);
  });
});
