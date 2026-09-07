#!/usr/bin/env npx tsx
// Runs full parameter evaluation across all 4 ground truth symbols (troffer, duplex, switch, exit)
// on E-101 and E-102.

import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import type { EvalMetrics } from "./eval-autocount";

interface TestCase {
  page: number;
  sheetNo: string;
  symbol: string;
  minScore: number;
}

const TEST_CASES: TestCase[] = [
  { page: 2, sheetNo: "E-102", symbol: "troffer", minScore: 0.5 },
  { page: 2, sheetNo: "E-102", symbol: "exit", minScore: 0.5 },
  { page: 2, sheetNo: "E-102", symbol: "switch", minScore: 0.5 },
  { page: 1, sheetNo: "E-101", symbol: "duplex", minScore: 0.5 },
];

async function main() {
  const rootDir = path.resolve(__dirname, "..");
  const allResults: EvalMetrics[] = [];

  console.log(`\n======================================================`);
  console.log(`RUNNING FULL GA-8 EVALUATION BENCHMARK SUITE`);
  console.log(`======================================================\n`);

  for (const tc of TEST_CASES) {
    console.log(`\n>>> Evaluating ${tc.sheetNo} (Page ${tc.page}) - Symbol '${tc.symbol}'`);
    const outDir = `eval-out/${tc.sheetNo}-${tc.symbol}`;
    fs.mkdirSync(path.resolve(rootDir, outDir), { recursive: true });

    // Step 1: Render evaluation tiles
    console.log(`[1/2] Rendering tiles...`);
    execFileSync("python", [
      path.resolve(rootDir, "scripts/render_eval_tiles.py"),
      "--page",
      String(tc.page),
      "--symbol",
      tc.symbol,
      "--out-dir",
      outDir,
    ]);

    // Step 2: Run evaluation harness
    console.log(`[2/2] Running eval-autocount...`);
    const resJsonPath = path.resolve(rootDir, `${outDir}/results.json`);
    execFileSync(
      "npx",
      [
        "tsx",
        path.resolve(rootDir, "scripts/eval-autocount.ts"),
        "--manifest",
        `${outDir}/manifest.json`,
        "--strategy",
        "ncc-verify",
        "--min-score",
        String(tc.minScore),
        "--mock",
        "--json",
        resJsonPath,
      ],
      { stdio: "inherit", shell: true }
    );

    const metrics: EvalMetrics = JSON.parse(fs.readFileSync(resJsonPath, "utf-8"));
    allResults.push(metrics);
  }

  console.log(`\n\n==================== FINAL GA-8 BENCHMARK RESULTS TABLE ====================`);
  console.log(
    `Strategy   | Model           | Sheet | Symbol   | Truth | TP | FP | FN | Precision | Recall | F1    | Time (s) | Crops Sent`
  );
  console.log(
    `-----------+-----------------+-------+----------+-------+----+----+----+-----------+--------+-------+----------+-----------`
  );

  for (const r of allResults) {
    const p = (r.precision * 100).toFixed(1) + "%";
    const rec = (r.recall * 100).toFixed(1) + "%";
    const f1 = r.f1.toFixed(3);
    const time = (r.totalTimeMs / 1000).toFixed(2) + "s";
    console.log(
      `${r.strategy.padEnd(10)} | ${r.model.slice(0, 15).padEnd(15)} | ${r.sheet.padEnd(5)} | ${r.symbol.padEnd(
        8
      )} | ${String(r.groundTruthCount).padEnd(5)} | ${String(r.truePositives).padEnd(2)} | ${String(
        r.falsePositives
      ).padEnd(2)} | ${String(r.falseNegatives).padEnd(2)} | ${p.padEnd(9)} | ${rec.padEnd(6)} | ${f1.padEnd(
        5
      )} | ${time.padEnd(8)} | ${String(r.dedupedCount)}`
    );
  }
  console.log(`============================================================================\n`);

  // Write master benchmark JSON
  const masterPath = path.resolve(rootDir, "eval-out/benchmark-summary.json");
  fs.writeFileSync(masterPath, JSON.stringify(allResults, null, 2), "utf-8");
  console.log(`Saved benchmark summary to ${masterPath}`);
}

main().catch((e) => {
  console.error("Benchmark failed:", e);
  process.exit(1);
});
