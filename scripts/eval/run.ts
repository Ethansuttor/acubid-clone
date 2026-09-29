#!/usr/bin/env npx tsx
// Reproducible, offline detection evaluation.
//
//   npm run eval:detection [-- --manifest <file>]... [--case <id>]... [--out <dir>]
//                              [--case-timeout-ms <n>] [--summary-out <file>] [--no-artifacts]
//
// For every manifest (default: all evaluation/manifests/*.json) it verifies
// each input's checksum, renders the page from the tracked PDF with pdf.js,
// runs the production local detection pipeline in worker threads, scores the
// pending candidates one-to-one against the labels, applies each case's gates
// and writes eval-out/detection-eval/<manifest>/report.{json,md}.
//
// Exit status: 0 all gates met; 1 a gate was violated (including failed,
// timed-out or zero-match cases); 2 a manifest or input was missing/invalid;
// 3 the harness itself crashed; 130 cancelled. No network or provider access
// is attempted.

import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InputError, ManifestError, parseManifest, resolveInput, sha256, type Manifest, type ResolvedInput } from "./manifest";
import { inputErrorResult, runCase, type CaseResult } from "./harness";
import { buildReport, collectEnvironment, EXIT, renderText, summarize, type ManifestReport } from "./report";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_MANIFEST_DIR = path.join(REPO_ROOT, "evaluation/manifests");

interface Args { manifests: string[]; cases: string[]; out: string; caseTimeoutMs: number; summaryOut?: string; artifacts: boolean }

function usage(message: string): never {
  console.error(`${message}\nUsage: npm run eval:detection -- [--manifest <file>]... [--case <id>]... [--out <dir>] [--case-timeout-ms <n>] [--summary-out <file>] [--no-artifacts]`);
  process.exit(EXIT.inputError);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { manifests: [], cases: [], out: path.join(REPO_ROOT, "eval-out/detection-eval"), caseTimeoutMs: 15 * 60_000, artifacts: true };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => { const v = argv[++i]; if (v === undefined || v.startsWith("--")) usage(`${flag} needs a value`); return v; };
    if (flag === "--manifest") args.manifests.push(path.resolve(value()));
    else if (flag === "--case") args.cases.push(value());
    else if (flag === "--out") args.out = path.resolve(value());
    else if (flag === "--case-timeout-ms") { const n = Number(value()); if (!Number.isInteger(n) || n <= 0) usage("--case-timeout-ms must be a positive integer"); args.caseTimeoutMs = n; }
    else if (flag === "--summary-out") args.summaryOut = path.resolve(value());
    else if (flag === "--no-artifacts") args.artifacts = false;
    else usage(`Unknown argument ${flag}`);
  }
  if (!args.manifests.length) {
    if (!existsSync(DEFAULT_MANIFEST_DIR)) usage(`No manifests given and ${DEFAULT_MANIFEST_DIR} does not exist`);
    args.manifests = readdirSync(DEFAULT_MANIFEST_DIR).filter(f => f.endsWith(".json")).sort().map(f => path.join(DEFAULT_MANIFEST_DIR, f));
    if (!args.manifests.length) usage(`No manifests found in ${DEFAULT_MANIFEST_DIR}`);
  }
  return args;
}

const display = (file: string) => (path.relative(REPO_ROOT, file).startsWith("..") ? file : path.relative(REPO_ROOT, file));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const controller = new AbortController();
  const onSignal = () => { console.error("\nCancelling: the current case stops; no partial detections are scored."); controller.abort(); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  // Parse every manifest before running anything so a bad one fails fast.
  const loaded: { file: string; text: string; manifest: Manifest }[] = [];
  let invalid = false;
  for (const file of args.manifests) {
    try {
      const text = readFileSync(file, "utf8");
      loaded.push({ file, text, manifest: parseManifest(text) });
    } catch (error) {
      invalid = true;
      console.error(`${display(file)}: ${error instanceof ManifestError || error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (invalid) process.exit(EXIT.inputError);
  const known = new Set(loaded.flatMap(l => l.manifest.cases.map(c => c.id)));
  const unknown = args.cases.filter(id => !known.has(id));
  if (unknown.length) usage(`Unknown case id(s): ${unknown.join(", ")}`);

  const reports: ManifestReport[] = [];
  for (const { file, text, manifest } of loaded) {
    const environment = collectEnvironment(REPO_ROOT);
    const cases = manifest.cases.filter(c => !args.cases.length || args.cases.includes(c.id));
    if (!cases.length) continue;
    console.log(`\n== ${manifest.id} (${display(file)}): ${cases.length} case(s), evidence class ${manifest.evidenceClass}`);
    const resolved = new Map<string, ResolvedInput | InputError>();
    const results: CaseResult[] = [];
    for (const spec of cases) {
      if (controller.signal.aborted) break;
      if (!resolved.has(spec.input)) {
        try { resolved.set(spec.input, resolveInput(spec.input, manifest.inputs[spec.input], REPO_ROOT)); }
        catch (error) { resolved.set(spec.input, error instanceof InputError ? error : new InputError(spec.input, String(error))); }
      }
      const input = resolved.get(spec.input)!;
      const artifactDir = args.artifacts ? path.join(args.out, manifest.id, spec.id) : undefined;
      const result = input instanceof InputError
        ? inputErrorResult(spec, { key: spec.input, spec: manifest.inputs[spec.input] }, input.message)
        : await runCase(spec, input, { signal: controller.signal, caseTimeoutMs: args.caseTimeoutMs, artifactDir });
      if (artifactDir) result.artifacts = result.artifacts.map(display);
      results.push(result);
      const s = result.score;
      console.log(`  ${spec.id}: ${result.status}${s ? ` · expected ${s.expected} · TP ${s.truePositives} FP ${s.falsePositives} FN ${s.falseNegatives} · legend/negative hits ${s.negativeHits}` : ""} · API calls ${result.apiCalls}${result.render ? ` · scale ${result.render.scale.toFixed(4)} ${result.render.canvasWidth}×${result.render.canvasHeight}px` : ""} · ${(result.timingsMs.total / 1000).toFixed(1)} s${result.gates.passed ? "" : ` · GATE: ${result.gates.violations.join("; ")}`}${result.statusDetail && !result.gates.passed ? ` (${result.statusDetail})` : ""}`);
    }
    environment.loadAverage1m.push(Math.round(os.loadavg()[0] * 100) / 100);
    const report = buildReport(manifest, display(file), sha256(text), environment, results, controller.signal.aborted);
    reports.push(report);
    const dir = path.join(args.out, manifest.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2) + "\n");
    const markdown = renderText(report);
    writeFileSync(path.join(dir, "report.md"), markdown);
    console.log("\n" + markdown);
    console.log(`Report: ${display(path.join(dir, "report.json"))}`);
  }

  if (args.summaryOut) {
    mkdirSync(path.dirname(args.summaryOut), { recursive: true });
    writeFileSync(args.summaryOut, JSON.stringify(summarize(reports), null, 2) + "\n");
    console.log(`Summary: ${display(args.summaryOut)}`);
  }
  // Precedence: cancelled > input error > gate failure > ok.
  const codes = reports.map(r => r.exitCode);
  const combined = controller.signal.aborted || codes.includes(EXIT.cancelled) ? EXIT.cancelled
    : codes.includes(EXIT.inputError) ? EXIT.inputError
      : codes.includes(EXIT.gateFailure) ? EXIT.gateFailure : EXIT.ok;
  if (combined !== EXIT.ok) console.error(`\nDetection evaluation did not pass (exit ${combined}).`);
  process.exitCode = combined;
}

main().catch(error => {
  console.error("Detection evaluation harness error:", error);
  process.exitCode = EXIT.harnessError;
});
