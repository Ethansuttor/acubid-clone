// The acceptance comparison engine (A1). These tests are about the harness
// refusing to declare success in the situations where a wrong bid looks right.

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  exitCodeFor,
  reconcile,
  renderReport,
  type ActualLine,
  type ExpectedLine,
  type ReconciliationInput,
} from "../../scripts/acceptance/reconcile";
import { loadJob, runSyntheticFixture } from "../../scripts/acceptance/compare-estimate";

const TOLERANCES = { measuredFraction: 0.01, currency: 0.005, laborHours: 0.0005 };

function expected(overrides: Partial<ExpectedLine> = {}): ExpectedLine {
  return {
    code: "DPLX-15",
    unit: "EA",
    kind: "counted",
    quantity: 8,
    materialCost: 22.8,
    laborHours: 1.6,
    ...overrides,
  };
}

function actual(overrides: Partial<ActualLine> = {}): ActualLine {
  return {
    code: "DPLX-15",
    unit: "EA",
    quantity: 8,
    materialCost: 22.8,
    laborHours: 1.6,
    ...overrides,
  };
}

function input(overrides: Partial<ReconciliationInput> = {}): ReconciliationInput {
  return {
    jobAlias: "test-job",
    provenance: "real",
    tolerances: TOLERANCES,
    expectedLines: [expected()],
    actualLines: [actual()],
    expectedTotals: { materialBase: 22.8, laborHoursBase: 1.6, bidPrice: 100 },
    actualTotals: { materialBase: 22.8, laborHoursBase: 1.6, bidPrice: 100 },
    openItems: [],
    knownUnsupportedScope: [],
    ...overrides,
  };
}

describe("agreement", () => {
  it("reconciles when lines and totals agree and nothing is open", () => {
    const result = reconcile(input());
    expect(result.verdict).toBe("reconciled");
    expect(exitCodeFor(result)).toBe(0);
  });
});

describe("counted quantities have no tolerance", () => {
  it("fails on a single miscounted device", () => {
    const result = reconcile(
      input({ expectedLines: [expected({ quantity: 47 })], actualLines: [actual({ quantity: 46 })] })
    );
    expect(result.verdict).toBe("discrepancies");
    expect(result.lines[0].differences[0]).toMatchObject({
      field: "quantity",
      expected: 47,
      actual: 46,
      tolerance: 0,
    });
  });
});

describe("measured quantities use the recorded tolerance", () => {
  it("accepts a traced length inside the estimator's tolerance", () => {
    const result = reconcile(
      input({
        expectedLines: [expected({ code: "EMT-075", unit: "FT", kind: "measured", quantity: 100 })],
        actualLines: [actual({ code: "EMT-075", unit: "FT", quantity: 100.5 })],
      })
    );
    expect(result.lines[0].status).toBe("match");
  });

  it("rejects one outside it", () => {
    const result = reconcile(
      input({
        expectedLines: [expected({ code: "EMT-075", unit: "FT", kind: "measured", quantity: 100 })],
        actualLines: [actual({ code: "EMT-075", unit: "FT", quantity: 101.5 })],
      })
    );
    expect(result.lines[0].status).toBe("differs");
    expect(result.lines[0].differences[0].tolerance).toBe(1);
  });

  it("applies no tolerance at all when the estimator recorded none", () => {
    const result = reconcile(
      input({
        tolerances: { ...TOLERANCES, measuredFraction: 0 },
        expectedLines: [expected({ unit: "FT", kind: "measured", quantity: 100 })],
        actualLines: [actual({ unit: "FT", quantity: 100.01 })],
      })
    );
    expect(result.lines[0].status).toBe("differs");
  });
});

describe("offsetting errors", () => {
  it("does not pass a job whose totals match while its lines do not", () => {
    const result = reconcile(
      input({
        expectedLines: [
          expected({ code: "A", materialCost: 100 }),
          expected({ code: "B", materialCost: 100 }),
        ],
        actualLines: [
          actual({ code: "A", materialCost: 150 }),
          actual({ code: "B", materialCost: 50 }),
        ],
        expectedTotals: { materialBase: 200, laborHoursBase: 1.6, bidPrice: 100 },
        actualTotals: { materialBase: 200, laborHoursBase: 1.6, bidPrice: 100 },
      })
    );
    expect(result.totals.every((total) => total.within)).toBe(true);
    expect(result.offsettingDifferences).toBe(true);
    expect(result.verdict).toBe("discrepancies");
    expect(exitCodeFor(result)).toBe(1);
    expect(renderReport(result)).toMatch(/Do not accept on the strength of the total/);
  });

  it("does not raise the offsetting flag when the lines agree", () => {
    expect(reconcile(input()).offsettingDifferences).toBe(false);
  });
});

describe("scope the comparison would otherwise lose", () => {
  it("reports a line the app never produced", () => {
    const result = reconcile(input({ actualLines: [] }));
    expect(result.lines[0].status).toBe("missing-from-app");
    expect(result.verdict).toBe("discrepancies");
  });

  it("reports a line the estimator never expected", () => {
    const result = reconcile(input({ actualLines: [actual(), actual({ code: "SURPRISE" })] }));
    expect(result.lines.map((line) => line.status)).toContain("unexpected-in-app");
    expect(result.verdict).toBe("discrepancies");
  });

  it("catches a unit mismatch even when the number agrees", () => {
    const result = reconcile(
      input({
        expectedLines: [expected({ unit: "FT" })],
        actualLines: [actual({ unit: "EA" })],
      })
    );
    expect(result.lines[0].differences[0]).toMatchObject({
      field: "unit",
      expected: "FT",
      actual: "EA",
    });
  });
});

describe("open items are never a pass", () => {
  it("withholds reconciliation when quantity could not be priced", () => {
    const result = reconcile(
      input({
        openItems: [
          { kind: "unlinked", detail: "Fire alarm: no item or assembly chosen", severity: "missing" },
        ],
      })
    );
    expect(result.verdict).toBe("open-items");
    expect(exitCodeFor(result)).toBe(1);
    expect(renderReport(result)).toMatch(/quantity carried but not priced/);
  });

  it("withholds reconciliation for known unsupported scope", () => {
    const result = reconcile(input({ knownUnsupportedScope: ["Selectable alternates"] }));
    expect(result.verdict).toBe("open-items");
    expect(renderReport(result)).toMatch(/never counted as a pass/);
  });
});

describe("report honesty", () => {
  it("labels a synthetic run and denies it establishes acceptance", () => {
    const report = renderReport(reconcile(input({ provenance: "synthetic" })));
    expect(report).toMatch(/SYNTHETIC/);
    expect(report).toMatch(/cannot establish real-estimate acceptance/);
    expect(report).toMatch(/Real acceptance remains pending/);
  });

  it("does not carry that disclaimer into a real run", () => {
    expect(renderReport(reconcile(input({ provenance: "real" })))).not.toMatch(/SYNTHETIC/);
  });
});

describe("job files", () => {
  it("refuses a job file with no recorded tolerances", () => {
    const path = join(tmpdir(), `voltline-job-${Date.now()}.json`);
    writeFileSync(path, JSON.stringify({ jobAlias: "x", provenance: "real" }));
    expect(() => loadJob(path)).toThrow(/tolerances/i);
  });

  it("loads the synthetic job file shipped with the harness", () => {
    const job = loadJob("scripts/acceptance/jobs/synthetic-fixture.json");
    expect(job.provenance).toBe("synthetic");
    expect(job.expectedLines.length).toBeGreaterThan(0);
  });
});

describe("the synthetic run drives the application's own math", () => {
  it("reproduces the hand-calculated fixture totals", () => {
    const run = runSyntheticFixture();
    expect(run.totals.materialBase).toBeCloseTo(566.16, 8);
    expect(run.totals.laborHoursBase).toBeCloseTo(13.528, 8);
    expect(run.totals.bidPrice).toBeCloseTo(2280.82624, 8);
    expect(run.openItems).toEqual([]);
  });

  it("reconciles against the shipped expectations", () => {
    const job = loadJob("scripts/acceptance/jobs/synthetic-fixture.json");
    const run = runSyntheticFixture();
    const result = reconcile({
      jobAlias: job.jobAlias,
      provenance: job.provenance,
      tolerances: job.measurementTolerances,
      expectedLines: job.expectedLines,
      actualLines: run.lines,
      expectedTotals: job.expectedTotals,
      actualTotals: run.totals,
      openItems: run.openItems,
      knownUnsupportedScope: job.knownUnsupportedScope,
    });
    expect(result.verdict).toBe("reconciled");
  });

  it("would notice if the pipeline started dropping a line", () => {
    const job = loadJob("scripts/acceptance/jobs/synthetic-fixture.json");
    const run = runSyntheticFixture();
    const result = reconcile({
      jobAlias: job.jobAlias,
      provenance: job.provenance,
      tolerances: job.measurementTolerances,
      expectedLines: job.expectedLines,
      // Simulate the app losing the troffers.
      actualLines: run.lines.filter((line) => line.code !== "LED-2X4"),
      expectedTotals: job.expectedTotals,
      actualTotals: run.totals,
      openItems: run.openItems,
      knownUnsupportedScope: job.knownUnsupportedScope,
    });
    expect(result.verdict).toBe("discrepancies");
    expect(result.lines.find((line) => line.code === "LED-2X4")?.status).toBe("missing-from-app");
  });
});
