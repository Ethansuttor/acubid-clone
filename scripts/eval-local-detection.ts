// Uses existing rasterized synthetic plan fixtures. No credentials or model mocks.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { prepareTemplates, matchLocalTile, chooseAiCandidates } from "../src/lib/autocount/local";
import { dedupeDetections } from "../src/lib/autocount/dedupe";
import { mapDetectionsToSheet } from "../src/lib/autocount/mapping";
import { evaluateMatches } from "./eval-autocount";
import type { Detection } from "../src/lib/autocount/types";

interface Manifest { sheet_no: string; symbol: string; scale: number; template: { w: number; h: number; binPath: string }; tiles: { x: number; y: number; w: number; h: number; binPath: string }[] }
const truth = JSON.parse(readFileSync("test-assets/sample-plan-truth.json", "utf8"));
const results = [];
for (const name of ["E-102-troffer", "E-101-duplex", "E-102-switch", "E-102-exit"]) {
  const dir = resolve("eval-out", name);
  const manifest: Manifest = JSON.parse(readFileSync(resolve(dir, "manifest.json"), "utf8"));
  const read = (entry: { w: number; h: number; binPath: string }) => ({ w: entry.w, h: entry.h, g: Float32Array.from(readFileSync(resolve(dir, entry.binPath))) });
  const start = performance.now();
  const templates = prepareTemplates(read(manifest.template));
  const found: Detection[] = [];
  for (const tile of manifest.tiles) {
    found.push(...matchLocalTile(read(tile), templates).map(hit => ({ ...hit, x: hit.x + tile.x, y: hit.y + tile.y })));
  }
  const unique = dedupeDetections(found, { centerFraction: 0.35 });
  const detections = mapDetectionsToSheet(unique, { x: 0, y: 0 }, manifest.scale);
  const expected = truth.sheets.find((sheet: { sheet_no: string }) => sheet.sheet_no === manifest.sheet_no).symbols.filter((symbol: { kind: string }) => symbol.kind === manifest.symbol);
  const result = { fixture: name, scope: "synthetic plan; existing raster fixture", threshold: 0.72, tiles: manifest.tiles.length, detections: detections.length, ...evaluateMatches(detections, expected), potentialAiCrops: chooseAiCandidates(unique).length, apiCalls: 0, timeMs: Math.round(performance.now() - start) };
  results.push(result);
  console.log(JSON.stringify(result));
}
writeFileSync("eval-out/local-detection-results.json", JSON.stringify(results, null, 2));
// These synthetic fixtures have exact ground truth. Preserve the report for
// diagnosis, but make accuracy regressions fail the command (and CI).
const failures = results.filter(result => result.falsePositives > 0 || result.falseNegatives > 0);
if (failures.length) {
  console.error(`Local detection regression: ${failures.map(result => result.fixture).join(", ")}`);
  process.exitCode = 1;
}
