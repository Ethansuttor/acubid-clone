// Evaluation manifest format: committed manifests are current and agree with
// the tracked labels; invalid manifests and unavailable inputs fail clearly.
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { InputError, ManifestError, parseManifest, resolveInput, sha256, PRIVATE_ROOT_ENV, type InputSpec } from "../scripts/eval/manifest";
import { buildSyntheticManifests } from "../scripts/eval/make-synthetic-manifests";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("committed synthetic manifests", () => {
  const generated = buildSyntheticManifests();

  it.each(Object.keys(generated))("%s is up to date with its generator", rel => {
    expect(read(rel)).toBe(generated[rel]);
  });

  it.each(Object.keys(generated))("%s parses under format v1", rel => {
    const manifest = parseManifest(read(rel));
    expect(manifest.evidenceClass).toBe("synthetic");
    expect(manifest.cases.every(c => c.gates.maxApiCalls === 0 && c.labelProvenance === "synthetic-generator")).toBe(true);
    for (const [key, input] of Object.entries(manifest.inputs)) expect(resolveInput(key, input, ROOT).sha256).toBe(input.sha256);
  });

  it("carries every truth-file symbol of the evaluated classes, converted from centers to top-left boxes", () => {
    const manifest = parseManifest(read("evaluation/manifests/synthetic-sample-plan.v1.json"));
    const truth = JSON.parse(read("test-assets/sample-plan-truth.json")) as { sheets: { sheet_no: string; symbols: { kind: string; x: number; y: number; w: number; h: number }[] }[] };
    const counts = Object.fromEntries(manifest.cases.map(c => [c.id, c.expected.length]));
    expect(counts).toEqual({ "E-102-troffer": 50, "E-101-duplex": 27, "E-102-switch": 9, "E-102-exit": 4 });
    for (const c of manifest.cases) {
      const symbols = truth.sheets.find(s => s.sheet_no === c.sheet)!.symbols.filter(s => s.kind === c.symbolClass);
      expect(c.expected.map(b => [b.x + b.w / 2, b.y + b.h / 2, b.w, b.h])).toEqual(symbols.map(s => [s.x, s.y, s.w, s.h]));
      expect(c.example.box).toEqual(c.expected[0]);
      expect(c.negatives.map(n => n.label)).toEqual(["legend swatch: duplex", "legend swatch: troffer", "legend swatch: switch", "legend swatch: exit"]);
    }
  });

  it("uses the application defaults: 72% threshold, no size tolerance, SymbolSearch render scale", () => {
    for (const rel of Object.keys(generated)) {
      for (const c of parseManifest(read(rel)).cases) {
        expect(c.detector).toEqual({ minScore: 0.72, scaleTolerance: false });
        expect(c.render).toEqual({ scale: "symbol-search" });
        expect(c.split.set).toBe("regression");
      }
    }
  });
});

function minimal(overrides: Record<string, unknown> = {}, caseOverrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    format: "voltline-detection-eval", version: 1, id: "t", description: "test", evidenceClass: "synthetic", coordinateConvention: "pdf-top-left-points",
    inputs: { pdf: { kind: "pdf", fixtureId: "fixture", redistributable: true, path: "test-assets/sample-plan-E101-E102.pdf", sha256: "a".repeat(64) } },
    defaults: {
      detector: { minScore: 0.72, scaleTolerance: false }, render: { scale: "symbol-search" },
      scoring: { rule: "center-distance", radius: "truth-half-diagonal", radiusScale: 1 }, labelProvenance: "synthetic-generator",
      split: { project: "p", source: "s", set: "regression" }, gates: { maxApiCalls: 0, allowedStatus: ["completed"] },
    },
    cases: [{ id: "c", input: "pdf", page: 1, sheet: "E-1", symbolClass: "x", example: { box: { x: 1, y: 1, w: 10, h: 10 } }, expected: [{ x: 1, y: 1, w: 10, h: 10 }], ...caseOverrides }],
    ...overrides,
  });
}

function problems(text: string): string {
  try { parseManifest(text); } catch (error) { expect(error).toBeInstanceOf(ManifestError); return (error as ManifestError).problems.join("\n"); }
  throw new Error("expected the manifest to be rejected");
}

describe("manifest validation rejects rather than guesses", () => {
  it("accepts a minimal valid manifest", () => {
    expect(parseManifest(minimal()).cases[0]).toMatchObject({ id: "c", negatives: [], ignore: [], gates: { maxApiCalls: 0 } });
  });
  it.each([
    ["an unsupported version", minimal({ version: 2 }), /unsupported version 2/],
    ["an unknown field", minimal({ extra: true }), /unknown field "extra"/],
    ["an invalid JSON document", "{", /not valid JSON/],
    ["an undeclared input", minimal({}, { input: "missing" }), /undeclared input "missing"/],
    ["a malformed checksum", minimal({ inputs: { pdf: { kind: "pdf", fixtureId: "f", redistributable: true, path: "x.pdf", sha256: "abc" } } }), /sha256/],
    ["a path escaping the repository", minimal({ inputs: { pdf: { kind: "pdf", fixtureId: "f", redistributable: true, path: "../x.pdf", sha256: "a".repeat(64) } } }), /without \.\./],
    ["a private input with a repository path", minimal({ inputs: { pdf: { kind: "pdf", redistributable: false, path: "x.pdf", sha256: "a".repeat(64) } } }), /privatePath/],
    ["a threshold the matcher refuses", minimal({}, { detector: { minScore: 0.4, scaleTolerance: false } }), /minScore/],
    ["a nonzero API-call allowance", minimal({}, { gates: { maxApiCalls: 1 } }), /maxApiCalls: must be 0/],
    ["a failure status allowed to pass", minimal({}, { gates: { allowedStatus: ["failed"] } }), /can never pass a gate/],
    ["duplicate case IDs", minimal({ cases: [JSON.parse(minimal()).cases[0], JSON.parse(minimal()).cases[0]] }), /duplicate case id/],
    ["duplicate expected symbols", minimal({}, { expected: [{ x: 1, y: 1, w: 10, h: 10 }, { x: 1, y: 1, w: 10, h: 10 }] }), /duplicates expected\[0\]/],
    ["an expected symbol inside an ignored region", minimal({}, { ignore: [{ label: "title", box: { x: 0, y: 0, w: 50, h: 50 } }] }), /inside ignored region "title"/],
    ["an expected symbol inside a negative region", minimal({}, { negatives: [{ label: "legend", box: { x: 0, y: 0, w: 50, h: 50 } }] }), /inside negative region "legend"/],
    ["a zero-size box", minimal({}, { expected: [{ x: 1, y: 1, w: 0, h: 10 }] }), /expected\[0\]\.w/],
    ["real-plan labels from the synthetic generator", minimal({ evidenceClass: "real" }), /cannot come from the synthetic generator/],
    ["a missing expected list", minimal({}, { expected: undefined }), /expected: must be an array/],
  ])("rejects %s", (_name, text, pattern) => {
    expect(problems(text)).toMatch(pattern);
  });
});

describe("input resolution", () => {
  const pdfPath = "test-assets/sample-plan-E101-E102.pdf";
  const good: InputSpec = { kind: "pdf", fixtureId: "f", redistributable: true, path: pdfPath, sha256: sha256(readFileSync(path.join(ROOT, pdfPath))) };
  const fails = (spec: InputSpec, pattern: RegExp, env: Record<string, string | undefined> = {}) => {
    expect(() => resolveInput("pdf", spec, ROOT, env)).toThrow(InputError);
    expect(() => resolveInput("pdf", spec, ROOT, env)).toThrow(pattern);
  };

  it("resolves a tracked fixture by checksum", () => {
    expect(resolveInput("pdf", good, ROOT).bytes.byteLength).toBeGreaterThan(1000);
  });
  it("fails clearly for a missing file", () => fails({ ...good, path: "test-assets/does-not-exist.pdf" }, /file not found/));
  it("fails clearly for a checksum mismatch", () => fails({ ...good, sha256: "0".repeat(64) }, /checksum mismatch/));
  it("fails clearly for a file that is not a PDF", () => {
    const rel = "test-assets/sample-plan-truth.json";
    fails({ ...good, path: rel, sha256: sha256(readFileSync(path.join(ROOT, rel))) }, /not a PDF/);
  });
  it("fails clearly when the label source changed", () => fails({ ...good, labels: { path: "test-assets/sample-plan-truth.json", sha256: "0".repeat(64) } }, /label source checksum mismatch/));
  it("requires the private root for private inputs", () => fails({ kind: "pdf", redistributable: false, privatePath: "job/plan.pdf", sha256: good.sha256 }, new RegExp(`\\$${PRIVATE_ROOT_ENV}.*not set`)));
  it("refuses a private root inside the repository", () => {
    fails({ kind: "pdf", redistributable: false, privatePath: pdfPath, sha256: good.sha256 }, /must stay outside the repository/, { [PRIVATE_ROOT_ENV]: ROOT });
  });
  it("resolves a private input outside the repository and reports it without an absolute path", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "voltline-eval-"));
    mkdirSync(path.join(dir, "job"));
    writeFileSync(path.join(dir, "job", "plan.pdf"), readFileSync(path.join(ROOT, pdfPath)));
    const resolved = resolveInput("pdf", { kind: "pdf", redistributable: false, privatePath: "job/plan.pdf", sha256: good.sha256 }, ROOT, { [PRIVATE_ROOT_ENV]: dir });
    expect(resolved.sha256).toBe(good.sha256);
  });
});
