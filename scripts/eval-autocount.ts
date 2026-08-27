#!/usr/bin/env npx tsx
// Offline evaluation harness for AI auto-count accuracy.
// Supports two strategies:
// 1. "ncc-verify" (GA-6 / GA-7): 2-stage deterministic NCC template matcher + ClaudeVerifier
// 2. "tile-scan" (GA-2 / GA-3 baseline): whole-tile scanning via ClaudeDetector

import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { ClaudeDetector } from "../src/lib/autocount/claude";
import { ClaudeVerifier, blendConfidence } from "../src/lib/autocount/verify";
import { matchAll, type GrayImage } from "../src/lib/autocount/ncc";
import { dedupeDetections } from "../src/lib/autocount/dedupe";
import { mapDetectionsToSheet, detectionCenter } from "../src/lib/autocount/mapping";
import type { Detection, SymbolDetector, SymbolVerifier } from "../src/lib/autocount/types";

interface ManifestTile {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  path: string;
  binPath?: string;
}

interface Manifest {
  pdf: string;
  page: number;
  sheet_no: string;
  scale: number;
  symbol: string;
  canvas: { w: number; h: number; binPath?: string };
  template: {
    path: string;
    binPath?: string;
    w: number;
    h: number;
    pageBox: { x: number; y: number; w: number; h: number };
  };
  tiles: ManifestTile[];
}

interface TruthSymbol {
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TruthSheet {
  sheet_no: string;
  sheet_name: string;
  page_number: number;
  width: number;
  height: number;
  symbols: TruthSymbol[];
}

interface TruthData {
  sheets: TruthSheet[];
}

export interface EvalMetrics {
  sheet: string;
  symbol: string;
  scale: number;
  strategy: string;
  model: string;
  minScore?: number;
  groundTruthCount: number;
  detectedRawCount: number;
  dedupedCount: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
  totalTimeMs: number;
  tileTimings?: { tileIndex: number; timeMs: number; detections: number }[];
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: Record<string, string | boolean | number> = {
    manifest: "eval-out/manifest.json",
    truth: "test-assets/sample-plan-truth.json",
    strategy: "ncc-verify",
    minScore: 0.5,
    json: "",
    sweep: false,
    mock: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--manifest" && i + 1 < args.length) opts.manifest = args[++i];
    else if (a === "--truth" && i + 1 < args.length) opts.truth = args[++i];
    else if (a === "--strategy" && i + 1 < args.length) opts.strategy = args[++i];
    else if (a === "--model" && i + 1 < args.length) opts.model = args[++i];
    else if (a === "--verify-model" && i + 1 < args.length) opts.verifyModel = args[++i];
    else if (a === "--min-score" && i + 1 < args.length) opts.minScore = parseFloat(args[++i]);
    else if (a === "--json") {
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        opts.json = args[++i];
      } else {
        opts.json = "eval-out/results.json";
      }
    } else if (a === "--sweep") opts.sweep = true;
    else if (a === "--mock") opts.mock = true;
  }
  return opts;
}

function toBase64Png(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function loadGrayImageFromBin(binPath: string, w: number, h: number): GrayImage {
  const buf = fs.readFileSync(binPath);
  const g = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    g[i] = buf[i];
  }
  return { g, w, h };
}

export function evaluateMatches(
  detections: Detection[],
  groundTruths: TruthSymbol[]
): {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
} {
  const candidates: { detIdx: number; truthIdx: number; dist: number }[] = [];

  for (let d = 0; d < detections.length; d++) {
    const det = detections[d];
    const detCenter = detectionCenter(det);

    for (let t = 0; t < groundTruths.length; t++) {
      const truth = groundTruths[t];
      const dist = Math.hypot(detCenter.x - truth.x, detCenter.y - truth.y);
      const halfDiagonal = 0.5 * Math.hypot(truth.w, truth.h);

      if (dist <= halfDiagonal) {
        candidates.push({ detIdx: d, truthIdx: t, dist });
      }
    }
  }

  candidates.sort((a, b) => a.dist - b.dist);

  const matchedDets = new Set<number>();
  const matchedTruths = new Set<number>();

  for (const c of candidates) {
    if (!matchedDets.has(c.detIdx) && !matchedTruths.has(c.truthIdx)) {
      matchedDets.add(c.detIdx);
      matchedTruths.add(c.truthIdx);
    }
  }

  const tp = matchedTruths.size;
  const fp = detections.length - matchedDets.size;
  const fn = groundTruths.length - matchedTruths.size;

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    precision,
    recall,
    f1,
  };
}

function runNCCPass(manifest: Manifest, manifestDir: string, minScore: number): Detection[] {
  let tplGray: GrayImage;
  if (manifest.template.binPath && fs.existsSync(path.resolve(manifestDir, manifest.template.binPath))) {
    tplGray = loadGrayImageFromBin(
      path.resolve(manifestDir, manifest.template.binPath),
      manifest.template.w,
      manifest.template.h
    );
  } else {
    throw new Error("Missing template.gray.bin. Run scripts/render_eval_tiles.py first.");
  }

  const rawCandidates: Detection[] = [];
  for (let i = 0; i < manifest.tiles.length; i++) {
    const tile = manifest.tiles[i];
    const tileBinPath = tile.binPath
      ? path.resolve(manifestDir, tile.binPath)
      : path.resolve(manifestDir, `tiles/tile_${tile.index}.gray.bin`);

    const tileGray = loadGrayImageFromBin(tileBinPath, tile.w, tile.h);
    const hits = matchAll(tileGray, tplGray, minScore);

    for (const h of hits) {
      rawCandidates.push({ ...h, x: h.x + tile.x, y: h.y + tile.y });
    }
  }

  return dedupeDetections(rawCandidates);
}

async function verifyCandidates(
  manifest: Manifest,
  manifestDir: string,
  candidates: Detection[],
  verifyModelName: string,
  isMock: boolean,
  apiKey: string | undefined
): Promise<Detection[]> {
  if (candidates.length === 0) return [];

  const templatePath = path.resolve(manifestDir, manifest.template.path);
  const templatePng = toBase64Png(templatePath);

  // Write candidates to file for crop_patch.py
  const candidatesPath = path.resolve(manifestDir, "ncc-candidates.json");
  fs.writeFileSync(candidatesPath, JSON.stringify(candidates, null, 2), "utf-8");

  // Crop candidate patches
  const cropsDir = path.resolve(manifestDir, "crops");
  execFileSync("python", [
    path.resolve(__dirname, "crop_patch.py"),
    "--manifest",
    path.resolve(manifestDir, "manifest.json"),
    "--candidates",
    candidatesPath,
    "--out-dir",
    cropsDir,
  ]);

  const cropManifest: { index: number; path: string; box: Detection }[] = JSON.parse(
    fs.readFileSync(path.resolve(cropsDir, "manifest.json"), "utf-8")
  );

  let verifier: SymbolVerifier;
  if (isMock || !apiKey) {
    verifier = {
      model: `${verifyModelName} (mock)`,
      async verifyCrops(_tpl, crops) {
        return crops.map((c) => {
          const orig = cropManifest[c.index - 1];
          return {
            index: c.index,
            match: (orig?.box.confidence ?? 0) >= 0.45,
            confidence: orig?.box.confidence ?? 0.8,
          };
        });
      },
    };
  } else {
    verifier = new ClaudeVerifier(apiKey, verifyModelName);
  }

  const verifiedList: Detection[] = [];
  const BATCH_SIZE = 24;

  for (let b = 0; b < cropManifest.length; b += BATCH_SIZE) {
    const batch = cropManifest.slice(b, b + BATCH_SIZE);
    const batchCrops = batch.map((item) => ({
      index: item.index,
      image: toBase64Png(path.resolve(manifestDir, item.path)),
    }));

    const results = await verifier.verifyCrops(templatePng, batchCrops);
    for (const r of results) {
      if (r.match) {
        const orig = cropManifest[r.index - 1];
        if (orig) {
          const blended = blendConfidence(orig.box.confidence, r.confidence);
          verifiedList.push({ ...orig.box, confidence: blended });
        }
      }
    }
  }

  return mapDetectionsToSheet(verifiedList, { x: 0, y: 0 }, manifest.scale);
}

async function run() {
  const opts = parseArgs();
  const manifestPath = path.resolve(String(opts.manifest));
  const truthPath = path.resolve(String(opts.truth));

  if (!fs.existsSync(manifestPath)) {
    console.error(`Manifest file not found: ${manifestPath}`);
    console.error("Run `python scripts/render_eval_tiles.py` first to generate tiles.");
    process.exit(1);
  }

  if (!fs.existsSync(truthPath)) {
    console.error(`Ground truth JSON not found: ${truthPath}`);
    process.exit(1);
  }

  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const truthData: TruthData = JSON.parse(fs.readFileSync(truthPath, "utf-8"));

  const targetSheet = truthData.sheets.find((s) => s.page_number === manifest.page);
  if (!targetSheet) {
    console.error(`No sheet found in truth for page ${manifest.page}`);
    process.exit(1);
  }

  const targetTruthSymbols = targetSheet.symbols.filter((s) => s.kind === manifest.symbol);
  const manifestDir = path.dirname(manifestPath);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const isMock = Boolean(opts.mock) || (!apiKey && process.env.NODE_ENV !== "production");

  const modelName = String(opts.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6");
  const verifyModelName = String(opts.verifyModel ?? modelName);
  const strategy = String(opts.strategy);
  const minScore = Number(opts.minScore);

  console.log(`\n================ EVALUATION HARNESS ================`);
  console.log(`Sheet: ${manifest.sheet_no} (Page ${manifest.page}), Symbol: ${manifest.symbol}`);
  console.log(`Ground Truth Count: ${targetTruthSymbols.length}`);
  console.log(`Render Scale S: ${manifest.scale.toFixed(4)}`);
  console.log(`Active Tiles: ${manifest.tiles.length}`);
  console.log(`Strategy: ${strategy}`);
  console.log(`Model: ${strategy === "ncc-verify" ? verifyModelName : modelName}`);
  if (isMock) console.log(`[NOTE] Running in MOCK mode (no ANTHROPIC_API_KEY set or --mock passed)`);

  if (opts.sweep) {
    console.log(`\n--- Running Parameter Sweep (minScore: 0.4, 0.5, 0.6, 0.7) ---`);
    console.log(`[NCC Pass] Generating base candidates at minScore = 0.4...`);
    const t0 = Date.now();
    const baseCandidates = runNCCPass(manifest, manifestDir, 0.4);
    const nccTime = Date.now() - t0;
    console.log(`[NCC Pass] Generated ${baseCandidates.length} base candidates in ${(nccTime / 1000).toFixed(2)}s`);

    const scores = [0.4, 0.5, 0.6, 0.7];
    const sweepResults: EvalMetrics[] = [];

    for (const score of scores) {
      const iterStart = Date.now();
      const filtered = baseCandidates.filter((c) => c.confidence >= score);
      const verifiedDets = await verifyCandidates(
        manifest,
        manifestDir,
        filtered,
        verifyModelName,
        isMock,
        apiKey
      );
      const evalMetrics = evaluateMatches(verifiedDets, targetTruthSymbols);
      const iterTime = Date.now() - iterStart + nccTime;

      sweepResults.push({
        sheet: manifest.sheet_no,
        symbol: manifest.symbol,
        scale: manifest.scale,
        strategy: "ncc-verify",
        model: verifyModelName,
        minScore: score,
        groundTruthCount: targetTruthSymbols.length,
        detectedRawCount: filtered.length,
        dedupedCount: filtered.length,
        truePositives: evalMetrics.truePositives,
        falsePositives: evalMetrics.falsePositives,
        falseNegatives: evalMetrics.falseNegatives,
        precision: evalMetrics.precision,
        recall: evalMetrics.recall,
        f1: evalMetrics.f1,
        totalTimeMs: iterTime,
      });
    }

    console.log(`\n================ SWEEP RESULTS MATRIX ================`);
    console.log(
      `Strategy     | Model           | minScore | Candidates | TP | FP | Precision | Recall | F1    | Time`
    );
    console.log(`-------------+-----------------+----------+------------+----+----+-----------+--------+-------+------`);
    for (const r of sweepResults) {
      const p = (r.precision * 100).toFixed(1) + "%";
      const rec = (r.recall * 100).toFixed(1) + "%";
      const f1 = r.f1.toFixed(3);
      const time = (r.totalTimeMs / 1000).toFixed(2) + "s";
      console.log(
        `${r.strategy.padEnd(12)} | ${r.model.slice(0, 15).padEnd(15)} | ${String(r.minScore).padEnd(8)} | ${String(
          r.dedupedCount
        ).padEnd(10)} | ${String(r.truePositives).padEnd(2)} | ${String(r.falsePositives).padEnd(2)} | ${p.padEnd(
          9
        )} | ${rec.padEnd(6)} | ${f1.padEnd(5)} | ${time}`
      );
    }
    console.log(`======================================================\n`);

    if (opts.json) {
      const jsonPath = path.resolve(String(opts.json));
      fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
      fs.writeFileSync(jsonPath, JSON.stringify(sweepResults, null, 2), "utf-8");
      console.log(`Wrote sweep results to ${jsonPath}`);
    }
  } else {
    const t0 = Date.now();
    let finalSheetDetections: Detection[] = [];
    let detectedRawCount = 0;
    let dedupedCount = 0;

    if (strategy === "ncc-verify") {
      const candidates = runNCCPass(manifest, manifestDir, minScore);
      detectedRawCount = candidates.length;
      dedupedCount = candidates.length;
      finalSheetDetections = await verifyCandidates(
        manifest,
        manifestDir,
        candidates,
        verifyModelName,
        isMock,
        apiKey
      );
    } else {
      // Whole tile scan
      let detector: SymbolDetector;
      if (isMock || !apiKey) {
        detector = {
          model: `${modelName} (mock)`,
          async detectInTile() {
            return [];
          },
        };
      } else {
        detector = new ClaudeDetector(apiKey, modelName);
      }

      const templatePath = path.resolve(manifestDir, manifest.template.path);
      const templatePng = toBase64Png(templatePath);
      const allTileDets: Detection[] = [];

      for (let i = 0; i < manifest.tiles.length; i++) {
        const tile = manifest.tiles[i];
        const tilePng = toBase64Png(path.resolve(manifestDir, tile.path));
        const hits = await detector.detectInTile(templatePng, tilePng, {
          templateW: manifest.template.w,
          templateH: manifest.template.h,
          tileW: tile.w,
          tileH: tile.h,
        });
        const mapped = mapDetectionsToSheet(hits, { x: tile.x, y: tile.y }, manifest.scale);
        allTileDets.push(...mapped);
      }

      detectedRawCount = allTileDets.length;
      finalSheetDetections = dedupeDetections(allTileDets);
      dedupedCount = finalSheetDetections.length;
    }

    const totalTimeMs = Date.now() - t0;
    const evalResults = evaluateMatches(finalSheetDetections, targetTruthSymbols);

    const metrics: EvalMetrics = {
      sheet: manifest.sheet_no,
      symbol: manifest.symbol,
      scale: manifest.scale,
      strategy,
      model: strategy === "ncc-verify" ? verifyModelName : modelName,
      minScore,
      groundTruthCount: targetTruthSymbols.length,
      detectedRawCount,
      dedupedCount,
      truePositives: evalResults.truePositives,
      falsePositives: evalResults.falsePositives,
      falseNegatives: evalResults.falseNegatives,
      precision: evalResults.precision,
      recall: evalResults.recall,
      f1: evalResults.f1,
      totalTimeMs,
    };

    console.log(`\n---------------- RESULTS ----------------`);
    console.log(`Ground Truth:    ${metrics.groundTruthCount}`);
    console.log(`Raw Detections:  ${metrics.detectedRawCount}`);
    console.log(`Deduped Count:   ${metrics.dedupedCount}`);
    console.log(`True Positives:  ${metrics.truePositives}`);
    console.log(`False Positives: ${metrics.falsePositives}`);
    console.log(`False Negatives: ${metrics.falseNegatives}`);
    console.log(`Precision:       ${(metrics.precision * 100).toFixed(1)}%`);
    console.log(`Recall:          ${(metrics.recall * 100).toFixed(1)}%`);
    console.log(`F1 Score:        ${metrics.f1.toFixed(3)}`);
    console.log(`Total Time:      ${(metrics.totalTimeMs / 1000).toFixed(2)}s`);
    console.log(`-----------------------------------------\n`);

    if (opts.json) {
      const jsonPath = path.resolve(String(opts.json));
      fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
      fs.writeFileSync(jsonPath, JSON.stringify(metrics, null, 2), "utf-8");
      console.log(`Wrote JSON metrics to ${jsonPath}`);
    }
  }
}

if (process.argv[1] && process.argv[1].includes("eval-autocount")) {
  run().catch((e) => {
    console.error("Eval failed:", e);
    process.exit(1);
  });
}
