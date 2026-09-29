// The evaluation command's exit status and reports, exercised through the real
// CLI (scripts/eval/run.ts) on small generated drawings kept outside the
// repository as private inputs. Nothing here needs Python or a provider.
//   0 all gates met · 1 gate violated · 2 invalid/missing input · 130 cancelled
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PDFDocument, rgb } from "pdf-lib";
import { sha256, PRIVATE_ROOT_ENV } from "../scripts/eval/manifest";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules/tsx/dist/cli.mjs");
const H = 200;
const symbols = [[50, 50], [150, 50], [100, 140]];
const topLeft = ([x, y]: number[], w = 30, h = 15) => ({ x: x - w / 2, y: H - y - h / 2, w, h });

let work: string, privateRoot: string, pdfSha: string;

beforeAll(async () => {
  work = mkdtempSync(path.join(os.tmpdir(), "voltline-eval-cli-"));
  privateRoot = path.join(work, "private");
  mkdirSync(privateRoot);
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const page = doc.addPage([220, H]);
  for (const [x, y] of symbols) {
    page.drawRectangle({ x: x - 15, y: y - 7.5, width: 30, height: 15, borderWidth: 1.2, borderColor: rgb(0, 0, 0) });
    page.drawLine({ start: { x: x - 15, y: y - 7.5 }, end: { x: x + 15, y: y + 7.5 }, thickness: 1, color: rgb(0, 0, 0) });
  }
  page.drawCircle({ x: 190, y: 100, size: 8, borderWidth: 1.2, borderColor: rgb(0, 0, 0) }); // a different symbol class
  const bytes = await doc.save();
  writeFileSync(path.join(privateRoot, "plan.pdf"), bytes);
  pdfSha = sha256(bytes);
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

function manifest(overrides: { input?: Record<string, unknown>; expected?: unknown[]; caseExtra?: Record<string, unknown> } = {}) {
  return {
    format: "voltline-detection-eval", version: 1, id: "cli-test", description: "generated in test", evidenceClass: "synthetic", coordinateConvention: "pdf-top-left-points",
    inputs: { plan: { kind: "pdf", redistributable: false, privatePath: "plan.pdf", sha256: pdfSha, ...overrides.input } },
    defaults: {
      detector: { minScore: 0.72, scaleTolerance: false }, render: { scale: "symbol-search" },
      scoring: { rule: "center-distance", radius: "truth-half-diagonal", radiusScale: 1 }, labelProvenance: "synthetic-generator",
      split: { project: "cli", source: "test", set: "regression" },
      gates: { minPrecision: 1, minRecall: 1, maxFalsePositives: 0, maxFalseNegatives: 0, maxApiCalls: 0, allowedStatus: ["completed"] },
    },
    cases: [{
      id: "troffer", input: "plan", page: 1, sheet: "T-1", symbolClass: "troffer", example: { box: topLeft(symbols[0]) },
      expected: overrides.expected ?? symbols.map(s => topLeft(s)), negatives: [], ignore: [], ...overrides.caseExtra,
    }],
  };
}

let counter = 0;
function run(manifestBody: unknown, extraArgs: string[] = [], env: Record<string, string> = { [PRIVATE_ROOT_ENV]: privateRoot }) {
  const dir = path.join(work, `run-${counter++}`);
  mkdirSync(dir);
  const file = path.join(dir, "manifest.json");
  writeFileSync(file, typeof manifestBody === "string" ? manifestBody : JSON.stringify(manifestBody));
  const out = path.join(dir, "out");
  const child = spawnSync(process.execPath, [TSX, path.join(ROOT, "scripts/eval/run.ts"), "--manifest", file, "--out", out, "--no-artifacts", ...extraArgs], {
    cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" }, timeout: 120_000,
  });
  const reportPath = path.join(out, "cli-test", "report.json");
  const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : null;
  return { status: child.status, stdout: child.stdout, stderr: child.stderr, report, out };
}

describe("evaluation CLI exit status", () => {
  it("exits 0 and writes a report that says it is synthetic-only when every gate is met", () => {
    const result = run(manifest());
    expect(result.status, result.stderr).toBe(0);
    expect(result.report).toMatchObject({
      passed: true, exitCode: 0, scope: { evidenceClass: "synthetic", g6: "unverified" },
      selection: { manifestCases: 1, casesRun: 1, partial: false },
      totals: { expected: 3, truePositives: 3, falsePositives: 0, falseNegatives: 0, apiCalls: 0 },
    });
    expect(result.report.scope.statement).toMatch(/SYNTHETIC FIXTURES ONLY/);
    const c = result.report.cases[0];
    expect(c).toMatchObject({ status: "completed", apiCalls: 0, options: { minScore: 0.72, scaleTolerance: false } });
    expect(c.input).toEqual({ key: "plan", redistributable: false, location: `$${PRIVATE_ROOT_ENV}/plan.pdf`, sha256: pdfSha });
    expect(c.render.canvasWidth).toBeGreaterThan(0);
    expect(result.report.environment).toMatchObject({ node: process.version });
    expect(JSON.stringify(result.report)).not.toContain(privateRoot); // private locations are not disclosed
    expect(result.stdout).toMatch(/SYNTHETIC FIXTURES ONLY/);
  }, 120_000);

  it("exits 1 when a labeled symbol is not found, even though the other cases' totals look fine", () => {
    // The labeled box holds a drawn circle, which the troffer template does not match.
    const result = run(manifest({ expected: [...symbols.map(s => topLeft(s)), topLeft([190, 100], 20, 20)] }));
    expect(result.status).toBe(1);
    expect(result.report).toMatchObject({ passed: false, exitCode: 1, cases: [{ status: "completed", score: { truePositives: 3, falseNegatives: 1 } }] });
    expect(result.report.failingCases[0].violations.join()).toMatch(/false negative|recall/);
  }, 120_000);

  it("exits 1 when the detector finds an unlabeled symbol", () => {
    const result = run(manifest({ expected: symbols.slice(0, 2).map(s => topLeft(s)) }));
    expect(result.status).toBe(1);
    expect(result.report.cases[0].score).toMatchObject({ truePositives: 2, falsePositives: 1, falseNegatives: 0 });
  }, 120_000);

  it("marks a --case run as partial", () => {
    const body = manifest();
    body.cases.push({ ...body.cases[0], id: "second" });
    const result = run(body, ["--case", "troffer"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.report.selection).toEqual({ manifestCases: 2, casesRun: 1, partial: true });
  }, 120_000);

  it("exits 2 for an input that is not there, without running the detector", () => {
    const result = run(manifest({ input: { privatePath: "missing.pdf" } }));
    expect(result.status).toBe(2);
    expect(result.report.cases[0]).toMatchObject({ status: "input-error", score: null });
    expect(result.report.cases[0].statusDetail).toMatch(/file not found/);
    expect(result.report.cases[0].timingsMs.detect).toBeNull();
  }, 120_000);

  it("exits 2 for a checksum mismatch", () => {
    const result = run(manifest({ input: { sha256: "0".repeat(64) } }));
    expect(result.status).toBe(2);
    expect(result.report.cases[0].statusDetail).toMatch(/checksum mismatch/);
  }, 120_000);

  it("exits 2 for a private input when no private root is configured", () => {
    const result = run(manifest(), [], { [PRIVATE_ROOT_ENV]: "" });
    expect(result.status).toBe(2);
    expect(result.report.cases[0].statusDetail).toMatch(/not set/);
  }, 120_000);

  it("exits 2 for a manifest that does not validate, listing the problems", () => {
    const bad = manifest();
    (bad.cases[0] as Record<string, unknown>).page = 0;
    delete (bad.cases[0] as Record<string, unknown>).example;
    const result = run(bad);
    expect(result.status).toBe(2);
    expect(result.report).toBeNull();
    expect(result.stderr).toMatch(/Invalid evaluation manifest[\s\S]*page[\s\S]*example/);
  }, 120_000);

  it("exits 2 for a manifest that is not JSON", () => {
    const result = run("{ not json");
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/not valid JSON/);
  }, 120_000);

  it("exits 2 for an unknown case id or argument", () => {
    expect(run(manifest(), ["--case", "nope"]).status).toBe(2);
    expect(run(manifest(), ["--bogus"]).status).toBe(2);
  }, 120_000);
});
