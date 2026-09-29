#!/usr/bin/env node

/**
 * Voltline Commercial Estimating Engine Benchmark Runner
 *
 * Measures high-throughput performance across all four core calculation phases
 * on a large-scale enterprise project fixture (50 sheets, 200 layers, 1,000 items,
 * 200 assemblies, 10,000 takeoffs, and 50 direct costs).
 *
 * Usage:
 *   npm run bench
 *   npm run bench -- [options]
 *
 * Options:
 *   --iterations <n>, -i <n>   Number of measurement iterations (default: 30)
 *   --warmup <n>, -w <n>       Number of warmup iterations (default: 5)
 *   --seed <n>, -s <n>         PRNG seed for deterministic dataset (default: 42)
 *   --json                     Output raw JSON results for CI/CD tracking
 *   --help, -h                 Show help message
 */

import { performance } from "node:perf_hooks";
import os from "node:os";
import { generateLargeEstimateFixture } from "../tests/fixtures/large-estimate-fixture";
import {
  layerQuantities,
  extendEstimate,
  materialRollup,
  estimateTotals,
  summarize,
  type LayerQuantity,
  type ExtendedEstimate,
  type EstimateSummary,
} from "../src/lib/estimate";
import { bidPreflight, type BidPreflightInput, type BidPreflight } from "../src/lib/preflight";

export interface BenchmarkOptions {
  iterations: number;
  warmup: number;
  seed: number;
  json: boolean;
}

export interface PhaseTimingResult {
  phase: string;
  warmupRuns: number;
  measuredRuns: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  stdDevMs: number;
  opsPerSec: number;
}

export interface BenchmarkReport {
  timestamp: string;
  environment: {
    node: string;
    v8: string;
    os: string;
    arch: string;
    cpu: string;
    cpuCores: number;
    totalMemGb: number;
    freeMemGb: number;
  };
  configuration: BenchmarkOptions;
  dataset: {
    documents: number;
    sheets: number;
    items: number;
    assemblies: number;
    assemblyItems: number;
    layers: number;
    takeoffs: number;
    directCosts: number;
  };
  benchmarks: PhaseTimingResult[];
  verification: {
    extendedLines: number;
    estimateIssues: number;
    rollupItems: number;
    baseMaterialCost: number;
    baseLaborHours: number;
    totalBidPrice: number;
    preflightReady: boolean;
    blockerCount: number;
    warningCount: number;
    passed: boolean;
  };
}

export function parseCliArgs(args: string[]): BenchmarkOptions {
  const options: BenchmarkOptions = {
    iterations: 30,
    warmup: 5,
    seed: 42,
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--iterations" || arg === "-i") {
      const val = parseInt(args[++i], 10);
      if (!isNaN(val) && val > 0) options.iterations = val;
    } else if (arg === "--warmup" || arg === "-w") {
      const val = parseInt(args[++i], 10);
      if (!isNaN(val) && val >= 0) options.warmup = val;
    } else if (arg === "--seed" || arg === "-s") {
      const val = parseInt(args[++i], 10);
      if (!isNaN(val)) options.seed = val;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Voltline Estimating Engine Benchmark

Options:
  --iterations, -i <n>   Number of measurement iterations (default: 30)
  --warmup, -w <n>       Number of warmup iterations (default: 5)
  --seed, -s <n>         PRNG seed for deterministic dataset (default: 42)
  --json                 Output raw JSON results for CI/CD tracking
  --help, -h             Show this help message
`);
      process.exit(0);
    }
  }

  return options;
}

export function computeStatistics(
  phase: string,
  durationsMs: number[],
  warmupRuns: number
): PhaseTimingResult {
  if (durationsMs.length === 0) {
    throw new Error(`Cannot compute statistics for empty duration set in phase: ${phase}`);
  }

  const sorted = [...durationsMs].sort((a, b) => a - b);
  const count = sorted.length;
  const minMs = sorted[0];
  const maxMs = sorted[count - 1];
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const meanMs = sum / count;

  const medianMs =
    count % 2 === 0
      ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
      : sorted[Math.floor(count / 2)];

  const p95Index = Math.min(Math.floor(count * 0.95), count - 1);
  const p95Ms = sorted[p95Index];

  const variance =
    sorted.reduce((acc, v) => acc + Math.pow(v - meanMs, 2), 0) / count;
  const stdDevMs = Math.sqrt(variance);

  const opsPerSec = meanMs > 0 ? 1000 / meanMs : 0;

  return {
    phase,
    warmupRuns,
    measuredRuns: count,
    minMs: Math.round(minMs * 100) / 100,
    maxMs: Math.round(maxMs * 100) / 100,
    meanMs: Math.round(meanMs * 100) / 100,
    medianMs: Math.round(medianMs * 100) / 100,
    p95Ms: Math.round(p95Ms * 100) / 100,
    stdDevMs: Math.round(stdDevMs * 100) / 100,
    opsPerSec: Math.round(opsPerSec * 10) / 10,
  };
}

export function runEstimateBenchmark(options: BenchmarkOptions): BenchmarkReport {
  const { warmup, iterations, seed } = options;

  // 1. Fixture Generation Timing
  const genTimes: number[] = [];
  let fixture = generateLargeEstimateFixture({ seed });

  for (let i = 0; i < warmup; i++) {
    generateLargeEstimateFixture({ seed: seed + i + 1 });
  }
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    const f = generateLargeEstimateFixture({ seed });
    const t1 = performance.now();
    genTimes.push(t1 - t0);
    if (i === 0) fixture = f;
  }
  const fixtureStats = computeStatistics("Fixture Generation (PRNG)", genTimes, warmup);

  // 2. Phase 1: layerQuantities
  let lastQuantities: LayerQuantity[] = [];
  const p1Times: number[] = [];
  for (let i = 0; i < warmup; i++) {
    layerQuantities(fixture.layers, fixture.takeoffs, fixture.sheets);
  }
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    lastQuantities = layerQuantities(fixture.layers, fixture.takeoffs, fixture.sheets);
    const t1 = performance.now();
    p1Times.push(t1 - t0);
  }
  const p1Stats = computeStatistics("Phase 1: layerQuantities", p1Times, warmup);

  // 3. Phase 2: extendEstimate
  let lastExtended: ExtendedEstimate = { lines: [], issues: [] };
  const p2Times: number[] = [];
  for (let i = 0; i < warmup; i++) {
    extendEstimate(lastQuantities, fixture.items, fixture.assemblies, fixture.assemblyItems);
  }
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    lastExtended = extendEstimate(
      lastQuantities,
      fixture.items,
      fixture.assemblies,
      fixture.assemblyItems
    );
    const t1 = performance.now();
    p2Times.push(t1 - t0);
  }
  const p2Stats = computeStatistics("Phase 2: extendEstimate", p2Times, warmup);

  // 4. Phase 3: summarize (estimateTotals + materialRollup + summarize)
  let lastSummary!: EstimateSummary;
  let lastRollupRows = 0;
  const p3Times: number[] = [];
  for (let i = 0; i < warmup; i++) {
    materialRollup(lastExtended.lines);
    const totals = estimateTotals(lastExtended.lines);
    summarize({
      ...totals,
      laborRate: fixture.project.labor_rate,
      wastePct: fixture.project.waste_pct,
      taxPct: fixture.project.tax_pct,
      laborFactorPct: fixture.project.labor_factor_pct,
      laborBurdenPct: fixture.project.labor_burden_pct,
      smallToolsPct: fixture.project.small_tools_pct,
      contingencyPct: fixture.project.contingency_pct,
      escalationPct: fixture.project.escalation_pct,
      bondPct: fixture.project.bond_pct,
      overheadPct: fixture.project.overhead_pct,
      profitPct: fixture.project.profit_pct,
      directCosts: fixture.directCosts,
    });
  }
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    const rollup = materialRollup(lastExtended.lines);
    const totals = estimateTotals(lastExtended.lines);
    lastSummary = summarize({
      ...totals,
      laborRate: fixture.project.labor_rate,
      wastePct: fixture.project.waste_pct,
      taxPct: fixture.project.tax_pct,
      laborFactorPct: fixture.project.labor_factor_pct,
      laborBurdenPct: fixture.project.labor_burden_pct,
      smallToolsPct: fixture.project.small_tools_pct,
      contingencyPct: fixture.project.contingency_pct,
      escalationPct: fixture.project.escalation_pct,
      bondPct: fixture.project.bond_pct,
      overheadPct: fixture.project.overhead_pct,
      profitPct: fixture.project.profit_pct,
      directCosts: fixture.directCosts,
    });
    const t1 = performance.now();
    p3Times.push(t1 - t0);
    if (i === 0) lastRollupRows = rollup.length;
  }
  const p3Stats = computeStatistics("Phase 3: summarize & rollup", p3Times, warmup);

  // 5. Phase 4: bidPreflight
  const preflightInput: BidPreflightInput = {
    project: fixture.project,
    sheets: fixture.sheets,
    layers: fixture.layers,
    takeoffs: fixture.takeoffs,
    lines: lastExtended.lines,
    issues: lastExtended.issues,
    summary: lastSummary,
    directCosts: fixture.directCosts,
    pendingWrites: 0,
    saveState: "saved",
  };
  let lastPreflight!: BidPreflight;
  const p4Times: number[] = [];
  for (let i = 0; i < warmup; i++) {
    bidPreflight(preflightInput);
  }
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    lastPreflight = bidPreflight(preflightInput);
    const t1 = performance.now();
    p4Times.push(t1 - t0);
  }
  const p4Stats = computeStatistics("Phase 4: bidPreflight", p4Times, warmup);

  // 6. Full Pipeline End-to-End (Phase 1 -> Phase 2 -> Phase 3 -> Phase 4)
  const fullTimes: number[] = [];
  for (let i = 0; i < warmup; i++) {
    const q = layerQuantities(fixture.layers, fixture.takeoffs, fixture.sheets);
    const e = extendEstimate(q, fixture.items, fixture.assemblies, fixture.assemblyItems);
    materialRollup(e.lines);
    const tot = estimateTotals(e.lines);
    const s = summarize({
      ...tot,
      laborRate: fixture.project.labor_rate,
      wastePct: fixture.project.waste_pct,
      taxPct: fixture.project.tax_pct,
      laborFactorPct: fixture.project.labor_factor_pct,
      laborBurdenPct: fixture.project.labor_burden_pct,
      smallToolsPct: fixture.project.small_tools_pct,
      contingencyPct: fixture.project.contingency_pct,
      escalationPct: fixture.project.escalation_pct,
      bondPct: fixture.project.bond_pct,
      overheadPct: fixture.project.overhead_pct,
      profitPct: fixture.project.profit_pct,
      directCosts: fixture.directCosts,
    });
    bidPreflight({
      project: fixture.project,
      sheets: fixture.sheets,
      layers: fixture.layers,
      takeoffs: fixture.takeoffs,
      lines: e.lines,
      issues: e.issues,
      summary: s,
      directCosts: fixture.directCosts,
      pendingWrites: 0,
      saveState: "saved",
    });
  }
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    const q = layerQuantities(fixture.layers, fixture.takeoffs, fixture.sheets);
    const e = extendEstimate(q, fixture.items, fixture.assemblies, fixture.assemblyItems);
    materialRollup(e.lines);
    const tot = estimateTotals(e.lines);
    const s = summarize({
      ...tot,
      laborRate: fixture.project.labor_rate,
      wastePct: fixture.project.waste_pct,
      taxPct: fixture.project.tax_pct,
      laborFactorPct: fixture.project.labor_factor_pct,
      laborBurdenPct: fixture.project.labor_burden_pct,
      smallToolsPct: fixture.project.small_tools_pct,
      contingencyPct: fixture.project.contingency_pct,
      escalationPct: fixture.project.escalation_pct,
      bondPct: fixture.project.bond_pct,
      overheadPct: fixture.project.overhead_pct,
      profitPct: fixture.project.profit_pct,
      directCosts: fixture.directCosts,
    });
    bidPreflight({
      project: fixture.project,
      sheets: fixture.sheets,
      layers: fixture.layers,
      takeoffs: fixture.takeoffs,
      lines: e.lines,
      issues: e.issues,
      summary: s,
      directCosts: fixture.directCosts,
      pendingWrites: 0,
      saveState: "saved",
    });
    const t1 = performance.now();
    fullTimes.push(t1 - t0);
  }
  const fullStats = computeStatistics("Full Pipeline (P1-P4)", fullTimes, warmup);

  const benchmarks: PhaseTimingResult[] = [
    fixtureStats,
    p1Stats,
    p2Stats,
    p3Stats,
    p4Stats,
    fullStats,
  ];

  const blockerIds = new Set(lastPreflight.blockers.map((check) => check.id));
  const fixtureProducedExpectedBlockers =
    blockerIds.size === 2 &&
    blockerIds.has("pending-ai") &&
    blockerIds.has("missing-quantity");
  const passed =
    lastQuantities.length === fixture.layers.length &&
    lastExtended.lines.length > 0 &&
    lastSummary.bidPrice > 0 &&
    Number.isFinite(lastSummary.bidPrice) &&
    fixtureProducedExpectedBlockers;

  return {
    timestamp: new Date().toISOString(),
    environment: {
      node: process.version,
      v8: process.versions.v8,
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      cpu: os.cpus()[0]?.model ?? "Generic CPU",
      cpuCores: os.cpus().length,
      totalMemGb: Math.round((os.totalmem() / 1024 / 1024 / 1024) * 10) / 10,
      freeMemGb: Math.round((os.freemem() / 1024 / 1024 / 1024) * 10) / 10,
    },
    configuration: options,
    dataset: {
      documents: fixture.documents.length,
      sheets: fixture.sheets.length,
      items: fixture.items.length,
      assemblies: fixture.assemblies.length,
      assemblyItems: fixture.assemblyItems.length,
      layers: fixture.layers.length,
      takeoffs: fixture.takeoffs.length,
      directCosts: fixture.directCosts.length,
    },
    benchmarks,
    verification: {
      extendedLines: lastExtended.lines.length,
      estimateIssues: lastExtended.issues.length,
      rollupItems: lastRollupRows,
      baseMaterialCost: lastSummary.materialBase,
      baseLaborHours: lastSummary.laborHoursBase,
      totalBidPrice: lastSummary.bidPrice,
      preflightReady: lastPreflight.ready,
      blockerCount: lastPreflight.blockers.length,
      warningCount: lastPreflight.warnings.length,
      passed,
    },
  };
}

export function printFormattedReport(report: BenchmarkReport): void {
  console.log("================================================================================");
  console.log("             VOLTLINE COMMERCIAL ESTIMATING ENGINE BENCHMARK                    ");
  console.log("================================================================================");
  console.log(`Timestamp:     ${report.timestamp}`);
  console.log(`Environment:   Node.js ${report.environment.node} | V8 ${report.environment.v8} | ${report.environment.os} (${report.environment.arch})`);
  console.log(`CPU / Memory:  ${report.environment.cpu} (${report.environment.cpuCores} cores) | ${report.environment.totalMemGb} GB Total`);
  console.log(`Configuration: Seed=${report.configuration.seed} | Warmup=${report.configuration.warmup} runs | Measured=${report.configuration.iterations} iterations`);
  console.log("--------------------------------------------------------------------------------\n");

  console.log("DATASET SCALE METRICS (Large-Scale Commercial Estimating Project):");
  console.log("+-----------------------------------+--------------------+---------------------------------------+");
  console.log("| Entity                            | Count              | Scale / Complexity Description        |");
  console.log("+-----------------------------------+--------------------+---------------------------------------+");
  console.log(`| Plan Documents                    | ${String(report.dataset.documents).padEnd(18)} | Multi-page PDF plan volumes           |`);
  console.log(`| Plan Sheets                       | ${String(report.dataset.sheets).padEnd(18)} | Calibrated drawings (scale 0.1 ft/pt) |`);
  console.log(`| Database Items                    | ${String(report.dataset.items).padEnd(18)} | Specification-grade electrical items  |`);
  console.log(`| Assemblies                        | ${String(report.dataset.assemblies).padEnd(18)} | Multi-component takeoff assemblies    |`);
  console.log(`| Assembly Component Items          | ${String(report.dataset.assemblyItems).padEnd(18)} | Nested item references & quantities   |`);
  console.log(`| Estimating Layers                 | ${String(report.dataset.layers).padEnd(18)} | Count, Linear, Area, Typical Multipliers|`);
  console.log(`| Takeoff Objects                   | ${String(report.dataset.takeoffs).padEnd(18)} | 95% confirmed, AI hits, polylines     |`);
  console.log(`| Direct Vendor & Sub Costs         | ${String(report.dataset.directCosts).padEnd(18)} | Quotes, subs, equipment, permits, O&P |`);
  console.log("+-----------------------------------+--------------------+---------------------------------------+\n");

  console.log("BENCHMARK TIMING BREAKDOWN:");
  console.log("+----------------------------------+--------+--------+------------+------------+------------+------------+------------+");
  console.log("| Benchmark Phase                  | Warmup | Iter   | Median     | Mean       | Min / Max  | p95        | Throughput |");
  console.log("+----------------------------------+--------+--------+------------+------------+------------+------------+------------+");

  for (const b of report.benchmarks) {
    const name = b.phase.padEnd(32);
    const warmupStr = String(b.warmupRuns).padStart(6);
    const iterStr = String(b.measuredRuns).padStart(6);
    const medianStr = `${b.medianMs.toFixed(2)} ms`.padStart(10);
    const meanStr = `${b.meanMs.toFixed(2)} ms`.padStart(10);
    const minMaxStr = `${b.minMs.toFixed(1)}/${b.maxMs.toFixed(1)}ms`.padStart(10);
    const p95Str = `${b.p95Ms.toFixed(2)} ms`.padStart(10);
    const opsStr = `${b.opsPerSec.toFixed(1)} ops/s`.padStart(10);

    console.log(`| ${name} | ${warmupStr} | ${iterStr} | ${medianStr} | ${meanStr} | ${minMaxStr} | ${p95Str} | ${opsStr} |`);
  }
  console.log("+----------------------------------+--------+--------+------------+------------+------------+------------+------------+\n");

  console.log("ENGINE OUTPUT & INTEGRITY VERIFICATION:");
  console.log(`- Extended Estimate Lines:    ${report.verification.extendedLines}`);
  console.log(`- Material Rollup Item Rows:  ${report.verification.rollupItems}`);
  console.log(`- Base Material Cost:         $${report.verification.baseMaterialCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`- Base Labor Hours:           ${report.verification.baseLaborHours.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} hrs`);
  console.log(`- Total Bid Price:            $${report.verification.totalBidPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`- Preflight Readiness:        ${report.verification.preflightReady ? "READY" : "BLOCKED"} (${report.verification.blockerCount} blockers, ${report.verification.warningCount} warnings)`);
  console.log(`- Invariant Check Status:     ${report.verification.passed ? "PASSED [OK]" : "FAILED [ERROR]"}`);
  console.log("--------------------------------------------------------------------------------");
  if (report.verification.passed) {
    console.log("[SUCCESS] Benchmark executed cleanly and all calculation invariants held.\n");
  } else {
    console.error("[FAILURE] One or more invariant checks failed during benchmark execution.\n");
  }
}

export function main(): void {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const report = runEstimateBenchmark(options);

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printFormattedReport(report);
    }

    if (!report.verification.passed) {
      process.exit(1);
    }
    process.exit(0);
  } catch (error) {
    console.error("[BENCHMARK ERROR]:", error);
    process.exit(1);
  }
}

if (typeof require !== "undefined" && require.main === module) {
  main();
} else if (process.argv[1]?.includes("benchmark-estimate")) {
  main();
}
