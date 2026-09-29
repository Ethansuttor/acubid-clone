// Report assembly for the detection evaluation. Separates per-case gate
// outcomes (which decide the exit status) from totals (context only), and
// states the evidence scope in every output.

import { execFileSync } from "node:child_process";
import os from "node:os";
import type { EvidenceClass, Manifest } from "./manifest";
import type { CaseResult } from "./harness";
import { RENDERER_DIFFERENCES, rendererInfo, type RendererInfo } from "./render";

export const REPORT_FORMAT = "voltline-detection-eval-report";
export const REPORT_VERSION = 1;

export const EXIT = { ok: 0, gateFailure: 1, inputError: 2, harnessError: 3, cancelled: 130 } as const;

export function scopeStatement(evidenceClass: EvidenceClass): string {
  return evidenceClass === "synthetic"
    ? "SYNTHETIC FIXTURES ONLY. These generated drawings have exact labels; the results establish nothing about detection accuracy on real plans. Release gate G6 (real-plan precision/recall) remains UNVERIFIED."
    : "Real-plan manifest. Metrics describe only the listed inputs and labels. G6 additionally requires estimator-verified labels on a project-level holdout that was not used for tuning; check split and labelProvenance before citing these numbers.";
}

export interface Environment {
  timestamp: string;
  git: { commit: string | null; dirty: boolean | null; dirtyPaths: string[] };
  node: string;
  platform: string;
  arch: string;
  osRelease: string;
  cpuModel: string;
  logicalCpus: number;
  totalMemoryGiB: number;
  loadAverage1m: number[];
  renderer: RendererInfo;
  timingCaveat: string;
}

function git(repoRoot: string, args: string[]): string | null {
  try { return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
}

export function collectEnvironment(repoRoot: string): Environment {
  const status = git(repoRoot, ["status", "--porcelain", "--untracked-files=all"]);
  const dirtyPaths = status === null ? [] : status.split("\n").filter(Boolean).map(line => line.slice(3));
  return {
    timestamp: new Date().toISOString(),
    git: { commit: git(repoRoot, ["rev-parse", "HEAD"]), dirty: status === null ? null : dirtyPaths.length > 0, dirtyPaths: dirtyPaths.slice(0, 50) },
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    logicalCpus: os.cpus().length,
    totalMemoryGiB: Math.round((os.totalmem() / 2 ** 30) * 10) / 10,
    loadAverage1m: [Math.round(os.loadavg()[0] * 100) / 100],
    renderer: rendererInfo(),
    timingCaveat: "Single run per case on this machine; other work may share the CPU (see loadAverage1m, sampled at start and end). Timings are indicative, not a benchmark.",
  };
}

export interface Totals {
  note: string;
  cases: number;
  byStatus: Record<string, number>;
  expected: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  negativeHits: number;
  apiCalls: number;
}

export function totalsOf(cases: CaseResult[]): Totals {
  const byStatus: Record<string, number> = {};
  for (const c of cases) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  const sum = (pick: (c: CaseResult) => number) => cases.reduce((total, c) => total + pick(c), 0);
  return {
    note: "Context only. Gates are applied to each case separately; a total never passes a failing case. Cases without a score contribute nothing here, so check byStatus.",
    cases: cases.length,
    byStatus,
    expected: sum(c => c.score?.expected ?? 0),
    truePositives: sum(c => c.score?.truePositives ?? 0),
    falsePositives: sum(c => c.score?.falsePositives ?? 0),
    falseNegatives: sum(c => c.score?.falseNegatives ?? 0),
    negativeHits: sum(c => c.score?.negativeHits ?? 0),
    apiCalls: sum(c => c.apiCalls),
  };
}

export interface ManifestReport {
  reportFormat: typeof REPORT_FORMAT;
  reportVersion: typeof REPORT_VERSION;
  scope: { evidenceClass: EvidenceClass; statement: string; g6: "unverified" };
  manifest: { id: string; path: string; sha256: string; format: string; version: number; description: string };
  environment: Environment;
  rendererDifferences: readonly string[];
  /**
   * Cases of the manifest that were not run (a --case filter or a cancelled
   * run). A partial report is a diagnostic, not the full regression result.
   */
  selection: { manifestCases: number; casesRun: number; partial: boolean };
  cases: CaseResult[];
  totals: Totals;
  passed: boolean;
  failingCases: { id: string; status: string; violations: string[]; detail?: string }[];
  exitCode: number;
}

export function exitCodeFor(cases: CaseResult[], cancelled: boolean): number {
  if (cancelled || cases.some(c => c.status === "cancelled")) return EXIT.cancelled;
  if (cases.some(c => c.status === "input-error")) return EXIT.inputError;
  if (cases.some(c => !c.gates.passed)) return EXIT.gateFailure;
  return EXIT.ok;
}

export function buildReport(manifest: Manifest, manifestPath: string, manifestSha: string, environment: Environment, cases: CaseResult[], cancelled: boolean): ManifestReport {
  const selection = { manifestCases: manifest.cases.length, casesRun: cases.length, partial: cases.length < manifest.cases.length };
  const failingCases = cases.filter(c => !c.gates.passed).map(c => ({ id: c.id, status: c.status, violations: c.gates.violations, ...(c.statusDetail ? { detail: c.statusDetail } : {}) }));
  return {
    reportFormat: REPORT_FORMAT,
    reportVersion: REPORT_VERSION,
    // Nothing in this harness can verify G6; a real-plan report still says so.
    scope: { evidenceClass: manifest.evidenceClass, statement: scopeStatement(manifest.evidenceClass), g6: "unverified" },
    manifest: { id: manifest.id, path: manifestPath, sha256: manifestSha, format: manifest.format, version: manifest.version, description: manifest.description },
    environment,
    rendererDifferences: RENDERER_DIFFERENCES,
    selection,
    cases,
    totals: totalsOf(cases),
    passed: failingCases.length === 0 && !cancelled,
    failingCases,
    exitCode: exitCodeFor(cases, cancelled),
  };
}

const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(1)}%`);
const fmtSec = (ms: number | null | undefined) => (ms === null || ms === undefined ? "-" : (ms / 1000).toFixed(1));

export function renderText(report: ManifestReport): string {
  const lines: string[] = [];
  lines.push(`# Detection evaluation: ${report.manifest.id}`, "");
  lines.push(`> ${report.scope.statement}`, "");
  if (report.selection.partial) lines.push(`> PARTIAL RUN: ${report.selection.casesRun} of ${report.selection.manifestCases} manifest cases were run. This is a diagnostic run, not the full regression result; the pass/fail status and exit code cover only the cases that ran.`, "");
  lines.push(`Manifest: ${report.manifest.path} (sha256 ${report.manifest.sha256.slice(0, 16)}…, format v${report.manifest.version})`);
  const env = report.environment;
  lines.push(`Commit: ${env.git.commit ?? "unknown"}${env.git.dirty ? " (working tree has uncommitted changes)" : ""}`);
  lines.push(`Runtime: Node ${env.node} ${env.platform}/${env.arch}, ${env.cpuModel} × ${env.logicalCpus}, ${env.totalMemoryGiB} GiB, load avg (1m) ${env.loadAverage1m.join(" → ")}`);
  lines.push(`Renderer: pdfjs-dist ${env.renderer.pdfjsVersion} + @napi-rs/canvas ${env.renderer.canvasVersion}; detector: production src/lib/autocount pipeline, local only`, "");
  lines.push("| Case | Status | Expected | TP | FP | FN | Legend/neg hits | Precision | Recall | Count error | API calls | Scale | Canvas px | Template px | Tiles (uniform skipped) | Render s | Detect s | Tile p50/p95 s |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | ---: | --- |");
  for (const c of report.cases) {
    const s = c.score, d = c.detection;
    lines.push(`| ${c.id} | ${c.status} | ${c.expectedCount} | ${s?.truePositives ?? "-"} | ${s?.falsePositives ?? "-"} | ${s?.falseNegatives ?? "-"} | ${s?.negativeHits ?? "-"} | ${fmtPct(s?.precision)} | ${fmtPct(s?.recall)} | ${s ? (s.countError > 0 ? "+" : "") + s.countError : "-"} | ${c.apiCalls} | ${c.render ? c.render.scale.toFixed(4) : "-"} | ${c.render ? `${c.render.canvasWidth}×${c.render.canvasHeight}` : "-"} | ${c.template ? `${c.template.width}×${c.template.height}` : "-"} | ${d ? `${d.tiles} (${d.skippedUniformTiles})` : "-"} | ${fmtSec(c.timingsMs.render)} | ${fmtSec(c.timingsMs.detect)} | ${d ? `${fmtSec(d.tileTimings.p50Ms)}/${fmtSec(d.tileTimings.p95Ms)}` : "-"} |`);
  }
  const t = report.totals;
  lines.push("", `Totals (context only; gates are per case): ${t.truePositives}/${t.expected} expected symbols matched, ${t.falsePositives} false positive(s), ${t.falseNegatives} false negative(s), ${t.negativeHits} labeled-negative hit(s), ${t.apiCalls} API call(s). Status counts: ${Object.entries(t.byStatus).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
  lines.push("", `Options: ${[...new Set(report.cases.map(c => `minScore ${c.options.minScore}, scaleTolerance ${c.options.scaleTolerance}, assist ${c.options.assist}, render scale ${c.options.renderScale}, match radius ${c.options.radiusScale} × half-diagonal`))].join("; ")}.`);
  lines.push("", report.passed ? `Result: every case${report.selection.partial ? " that ran" : ""} met its declared gates${report.selection.partial ? " (PARTIAL RUN)" : ""}.` : "Result: FAILED.");
  for (const f of report.failingCases) lines.push(`- ${f.id} [${f.status}]: ${f.violations.join("; ")}${f.detail ? ` — ${f.detail}` : ""}`);
  lines.push("", "Known renderer differences from the application:");
  for (const d of report.rendererDifferences) lines.push(`- ${d}`);
  lines.push("", `Timing caveat: ${env.timingCaveat}`, "");
  return lines.join("\n");
}

/** Compact, reviewable summary suitable for committing as evidence (no per-detection lists). */
export function summarize(reports: ManifestReport[]) {
  return {
    summaryFormat: "voltline-detection-eval-summary",
    version: 1,
    scope: [...new Set(reports.map(r => r.scope.statement))],
    environment: reports[0]?.environment,
    manifests: reports.map(r => ({
      id: r.manifest.id,
      path: r.manifest.path,
      sha256: r.manifest.sha256,
      passed: r.passed,
      exitCode: r.exitCode,
      selection: r.selection,
      totals: r.totals,
      cases: r.cases.map(c => ({
        id: c.id, status: c.status, ...(c.statusDetail ? { statusDetail: c.statusDetail } : {}),
        input: c.input, page: c.page, symbolClass: c.symbolClass, split: c.split,
        options: c.options,
        expected: c.expectedCount, truePositives: c.score?.truePositives ?? null, falsePositives: c.score?.falsePositives ?? null,
        falseNegatives: c.score?.falseNegatives ?? null, negativeHits: c.score?.negativeHits ?? null,
        precision: c.score?.precision ?? null, recall: c.score?.recall ?? null, countError: c.score?.countError ?? null,
        apiCalls: c.apiCalls, render: c.render, template: c.template && { width: c.template.width, height: c.template.height, sha256: c.template.sha256 },
        detection: c.detection, detectionsSha256: c.detectionsSha256, timingsMs: c.timingsMs, gateViolations: c.gates.violations,
      })),
    })),
  };
}
