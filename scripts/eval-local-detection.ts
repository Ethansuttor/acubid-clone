// LEGACY reproduction of the September 7 synthetic evaluation (90/90 symbols).
//
// Inputs: Python-rendered rasters from scripts/render_eval_tiles.py
// (pypdfium2, render scale min(4, max(1.5, 72 / symbol edge)) without the app's
// 32-megapixel cap, the Python tiling port and its old brightness-based blank
// filter). Missing inputs are regenerated from the tracked test-assets PDF;
// pass --regenerate to rebuild them all. Requires the Python packages in
// scripts/requirements-eval.txt. No credentials or model mocks.
//
// Matching uses production local.ts on those tiles, but tiling, render scale
// and renderer differ from the application. For the application-faithful
// evaluation use `npm run eval:detection` (scripts/eval/run.ts).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { prepareTemplates, matchLocalTile, chooseAiCandidates } from "../src/lib/autocount/local";
import { dedupeDetections } from "../src/lib/autocount/dedupe";
import { mapDetectionsToSheet } from "../src/lib/autocount/mapping";
import { evaluateMatches } from "./eval/scoring";
import type { Detection } from "../src/lib/autocount/types";

interface Manifest { sheet_no: string; symbol: string; scale: number; page: number; canvas: { w: number; h: number }; template: { w: number; h: number; binPath: string }; tiles: { x: number; y: number; w: number; h: number; binPath: string }[] }

const FIXTURES = [
  { name: "E-102-troffer", page: 2, symbol: "troffer" },
  { name: "E-101-duplex", page: 1, symbol: "duplex" },
  { name: "E-102-switch", page: 2, symbol: "switch" },
  { name: "E-102-exit", page: 2, symbol: "exit" },
];
const PDF = "test-assets/sample-plan-E101-E102.pdf";
const TRUTH = "test-assets/sample-plan-truth.json";
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

function python(args: string[]) {
  try {
    return execFileSync("python", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const detail = error as { stderr?: string; message: string };
    console.error(`Python step failed: python ${args.join(" ")}\n${detail.stderr || detail.message}`);
    console.error("Install the pinned evaluation dependencies: python -m pip install -r scripts/requirements-eval.txt");
    process.exit(2);
  }
}

for (const input of [PDF, TRUTH]) {
  if (!existsSync(input)) { console.error(`Missing tracked input ${input}; run from the repository root.`); process.exit(2); }
}
const regenerate = process.argv.includes("--regenerate");
const truth = JSON.parse(readFileSync(TRUTH, "utf8"));
mkdirSync("eval-out", { recursive: true });
const results = [];
for (const fixture of FIXTURES) {
  const dir = resolve("eval-out", fixture.name);
  if (regenerate || !existsSync(resolve(dir, "manifest.json"))) {
    python(["-c", "import pypdfium2, PIL"]);
    console.error(`Rendering ${fixture.name} with scripts/render_eval_tiles.py…`);
    python(["scripts/render_eval_tiles.py", "--page", String(fixture.page), "--symbol", fixture.symbol, "--out-dir", `eval-out/${fixture.name}`]);
  }
  const manifest: Manifest = JSON.parse(readFileSync(resolve(dir, "manifest.json"), "utf8"));
  const bytes = (entry: { binPath: string }) => {
    const file = resolve(dir, entry.binPath);
    if (!existsSync(file)) { console.error(`Missing raster ${file}; rerun with --regenerate.`); process.exit(2); }
    return readFileSync(file);
  };
  const read = (entry: { w: number; h: number; binPath: string }) => {
    const raw = bytes(entry);
    if (raw.length !== entry.w * entry.h) { console.error(`Raster ${entry.binPath} has ${raw.length} bytes, expected ${entry.w * entry.h}; rerun with --regenerate.`); process.exit(2); }
    return { w: entry.w, h: entry.h, g: Float32Array.from(raw) };
  };
  const start = performance.now();
  const templates = prepareTemplates(read(manifest.template));
  const found: Detection[] = [];
  for (const tile of manifest.tiles) {
    found.push(...matchLocalTile(read(tile), templates).map(hit => ({ ...hit, x: hit.x + tile.x, y: hit.y + tile.y })));
  }
  const unique = dedupeDetections(found, { centerFraction: 0.35 });
  const detections = mapDetectionsToSheet(unique, { x: 0, y: 0 }, manifest.scale);
  const expected = truth.sheets.find((sheet: { sheet_no: string }) => sheet.sheet_no === manifest.sheet_no).symbols.filter((symbol: { kind: string }) => symbol.kind === manifest.symbol);
  const tileHashes = sha256(manifest.tiles.map(tile => sha256(bytes(tile))).join("\n"));
  const result = {
    fixture: fixture.name,
    scope: "synthetic plan; LEGACY harness (pypdfium2 raster, Python tiling port, uncapped render scale); not the application path",
    threshold: 0.72,
    renderScale: manifest.scale,
    canvas: `${manifest.canvas.w}x${manifest.canvas.h}`,
    template: `${manifest.template.w}x${manifest.template.h}`,
    tiles: manifest.tiles.length,
    detections: detections.length,
    ...evaluateMatches(detections, expected),
    potentialAiCrops: chooseAiCandidates(unique).length,
    apiCalls: 0,
    timeMs: Math.round(performance.now() - start),
    inputs: { pdfSha256: sha256(readFileSync(PDF)), templateSha256: sha256(bytes(manifest.template)), tilesSha256: tileHashes },
  };
  results.push(result);
  console.log(JSON.stringify(result));
}
writeFileSync("eval-out/local-detection-results.json", JSON.stringify(results, null, 2));
console.log("Synthetic fixtures only: this establishes nothing about real plans (G6 unverified).");
// These synthetic fixtures have exact ground truth. Preserve the report for
// diagnosis, but make accuracy regressions fail the command (and CI).
const failures = results.filter(result => result.falsePositives > 0 || result.falseNegatives > 0);
if (failures.length) {
  console.error(`Local detection regression: ${failures.map(result => result.fixture).join(", ")}`);
  process.exitCode = 1;
}
