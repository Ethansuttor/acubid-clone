// Versioned detection-evaluation manifest (format "voltline-detection-eval", version 1).
//
// A manifest names its inputs by checksum, says where each comes from
// (a redistributable fixture tracked in Git, or a private file resolved under
// VOLTLINE_EVAL_PRIVATE_DIR outside the repository), and lists evaluation
// cases: page, example box, render scale policy, detector options, expected
// symbol boxes, labeled negatives, ignored regions, split and accuracy gates.
//
// Coordinate convention "pdf-top-left-points": PDF user-space units at render
// scale 1, measured from the top-left corner of the page as pdf.js
// getViewport({ scale: 1 }) presents it (y grows downward). This is the
// convention SymbolSearch.tsx uses for the example box and for stored
// takeoff geometry. A box is { x, y, w, h } with (x, y) its top-left corner.
//
// Validation rejects rather than guesses: unknown fields, missing values,
// out-of-range numbers, duplicate IDs and contradictory labels are errors.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const MANIFEST_FORMAT = "voltline-detection-eval";
export const MANIFEST_VERSION = 1;
export const COORDINATE_CONVENTION = "pdf-top-left-points";
export const PRIVATE_ROOT_ENV = "VOLTLINE_EVAL_PRIVATE_DIR";

export interface PageBox { x: number; y: number; w: number; h: number }
export interface LabeledRegion { label: string; box: PageBox }

export type EvidenceClass = "synthetic" | "real";
export type LabelProvenance = "synthetic-generator" | "estimator-verified" | "unverified";
export type SplitSet = "regression" | "tuning" | "holdout";

export interface InputSpec {
  kind: "pdf";
  /** Stable identifier for a redistributable fixture. */
  fixtureId?: string;
  redistributable: boolean;
  /** Repository-relative path; only for redistributable inputs. */
  path?: string;
  /** Path relative to $VOLTLINE_EVAL_PRIVATE_DIR; only for private inputs. */
  privatePath?: string;
  sha256: string;
  /** How the input was produced, e.g. a generator script. */
  generator?: string;
  /** Optional label source the expected boxes were copied from, pinned by checksum. */
  labels?: { path: string; sha256: string };
}

export interface DetectorOptions { minScore: number; scaleTolerance: boolean }
export type RenderSpec = { scale: "symbol-search" } | { scale: number };
export interface ScoringSpec { rule: "center-distance"; radius: "truth-half-diagonal"; radiusScale: number }
export interface Gates {
  minPrecision?: number;
  minRecall?: number;
  maxFalsePositives?: number;
  maxFalseNegatives?: number;
  maxNegativeHits?: number;
  maxAbsCountError?: number;
  /** Local-only evaluation must make zero provider requests; values above 0 are rejected. */
  maxApiCalls: 0;
  allowedStatus: RunStatus[];
}

export type RunStatus = "completed" | "zero-match" | "failed" | "timed-out" | "cancelled" | "input-error";
export const RUN_STATUSES: readonly RunStatus[] = ["completed", "zero-match", "failed", "timed-out", "cancelled", "input-error"];

export interface CaseSpec {
  id: string;
  input: string;
  page: number;
  sheet: string;
  symbolClass: string;
  split: { project: string; source: string; set: SplitSet };
  labelProvenance: LabelProvenance;
  example: { box: PageBox; note?: string };
  expected: PageBox[];
  negatives: LabeledRegion[];
  ignore: LabeledRegion[];
  detector: DetectorOptions;
  render: RenderSpec;
  scoring: ScoringSpec;
  gates: Gates;
  note?: string;
}

export interface Manifest {
  format: typeof MANIFEST_FORMAT;
  version: typeof MANIFEST_VERSION;
  id: string;
  description: string;
  evidenceClass: EvidenceClass;
  coordinateConvention: typeof COORDINATE_CONVENTION;
  inputs: Record<string, InputSpec>;
  cases: CaseSpec[];
}

export class ManifestError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid evaluation manifest:\n  - ${problems.join("\n  - ")}`);
    this.name = "ManifestError";
  }
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SHA256 = /^[0-9a-f]{64}$/;

class Checker {
  problems: string[] = [];
  fail(where: string, message: string) { this.problems.push(`${where}: ${message}`); }

  object(value: unknown, where: string, allowed: string[]): Json | undefined {
    if (!isObject(value)) { this.fail(where, "must be an object"); return undefined; }
    for (const key of Object.keys(value)) if (!allowed.includes(key)) this.fail(where, `unknown field "${key}"`);
    return value;
  }
  string(value: unknown, where: string, pattern?: RegExp): string | undefined {
    if (typeof value !== "string" || !value.trim()) { this.fail(where, "must be a non-empty string"); return undefined; }
    if (pattern && !pattern.test(value)) { this.fail(where, `"${value}" does not match ${pattern}`); return undefined; }
    return value;
  }
  optionalString(value: unknown, where: string): string | undefined {
    return value === undefined ? undefined : this.string(value, where);
  }
  number(value: unknown, where: string, min: number, max: number, integer = false): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      this.fail(where, `must be a finite ${integer ? "integer" : "number"} in [${min}, ${max}]`);
      return undefined;
    }
    return value;
  }
  oneOf<T extends string>(value: unknown, where: string, options: readonly T[]): T | undefined {
    if (typeof value !== "string" || !options.includes(value as T)) { this.fail(where, `must be one of ${options.join(", ")}`); return undefined; }
    return value as T;
  }
  box(value: unknown, where: string): PageBox | undefined {
    const o = this.object(value, where, ["x", "y", "w", "h"]);
    if (!o) return undefined;
    const x = this.number(o.x, `${where}.x`, 0, 1e6), y = this.number(o.y, `${where}.y`, 0, 1e6);
    const w = this.number(o.w, `${where}.w`, 1e-6, 1e6), h = this.number(o.h, `${where}.h`, 1e-6, 1e6);
    return x === undefined || y === undefined || w === undefined || h === undefined ? undefined : { x, y, w, h };
  }
  regions(value: unknown, where: string): LabeledRegion[] {
    if (!Array.isArray(value)) { this.fail(where, "must be an array"); return []; }
    return value.flatMap((entry, i) => {
      const o = this.object(entry, `${where}[${i}]`, ["label", "box"]);
      if (!o) return [];
      const label = this.string(o.label, `${where}[${i}].label`), box = this.box(o.box, `${where}[${i}].box`);
      return label && box ? [{ label, box }] : [];
    });
  }
}

const center = (box: PageBox) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
const contains = (box: PageBox, point: { x: number; y: number }) => point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;

function parseDetector(c: Checker, value: unknown, where: string): DetectorOptions | undefined {
  const o = c.object(value, where, ["minScore", "scaleTolerance"]);
  if (!o) return undefined;
  // Same bounds matchLocalTile enforces; checked here so a bad manifest is an
  // input error rather than a detector failure.
  const minScore = c.number(o.minScore, `${where}.minScore`, 0.5, 1);
  if (typeof o.scaleTolerance !== "boolean") c.fail(`${where}.scaleTolerance`, "must be a boolean");
  return minScore === undefined || typeof o.scaleTolerance !== "boolean" ? undefined : { minScore, scaleTolerance: o.scaleTolerance };
}

function parseRender(c: Checker, value: unknown, where: string): RenderSpec | undefined {
  const o = c.object(value, where, ["scale"]);
  if (!o) return undefined;
  if (o.scale === "symbol-search") return { scale: "symbol-search" };
  const scale = c.number(o.scale, `${where}.scale`, 0.1, 8);
  return scale === undefined ? undefined : { scale };
}

function parseScoring(c: Checker, value: unknown, where: string): ScoringSpec | undefined {
  const o = c.object(value, where, ["rule", "radius", "radiusScale"]);
  if (!o) return undefined;
  const rule = c.oneOf(o.rule, `${where}.rule`, ["center-distance"] as const);
  const radius = c.oneOf(o.radius, `${where}.radius`, ["truth-half-diagonal"] as const);
  const radiusScale = c.number(o.radiusScale, `${where}.radiusScale`, 0.1, 2);
  return rule && radius && radiusScale !== undefined ? { rule, radius, radiusScale } : undefined;
}

function parseGates(c: Checker, value: unknown, where: string): Gates | undefined {
  const o = c.object(value, where, ["minPrecision", "minRecall", "maxFalsePositives", "maxFalseNegatives", "maxNegativeHits", "maxAbsCountError", "maxApiCalls", "allowedStatus"]);
  if (!o) return undefined;
  const gates: Gates = { maxApiCalls: 0, allowedStatus: [] };
  for (const key of ["minPrecision", "minRecall"] as const) if (o[key] !== undefined) gates[key] = c.number(o[key], `${where}.${key}`, 0, 1);
  for (const key of ["maxFalsePositives", "maxFalseNegatives", "maxNegativeHits", "maxAbsCountError"] as const) {
    if (o[key] !== undefined) gates[key] = c.number(o[key], `${where}.${key}`, 0, 1e6, true);
  }
  if (o.maxApiCalls !== 0) c.fail(`${where}.maxApiCalls`, "must be 0: local-only evaluation never calls a provider");
  if (!Array.isArray(o.allowedStatus) || o.allowedStatus.length === 0) c.fail(`${where}.allowedStatus`, "must be a non-empty array");
  else gates.allowedStatus = o.allowedStatus.flatMap((s, i) => {
    const status = c.oneOf(s, `${where}.allowedStatus[${i}]`, RUN_STATUSES);
    if (status === "input-error" || status === "failed" || status === "cancelled" || status === "timed-out") {
      c.fail(`${where}.allowedStatus[${i}]`, `"${status}" can never pass a gate`);
      return [];
    }
    return status ? [status] : [];
  });
  return gates;
}

/** Parses and validates manifest JSON text. Throws ManifestError listing every problem found. */
export function parseManifest(text: string): Manifest {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (error) { throw new ManifestError([`not valid JSON (${(error as Error).message})`]); }
  const c = new Checker();
  const o = c.object(raw, "manifest", ["$comment", "format", "version", "id", "description", "evidenceClass", "coordinateConvention", "inputs", "defaults", "cases"]);
  if (!o) throw new ManifestError(c.problems);
  if (o.format !== MANIFEST_FORMAT) c.fail("manifest.format", `must be "${MANIFEST_FORMAT}"`);
  if (o.version !== MANIFEST_VERSION) c.fail("manifest.version", `unsupported version ${JSON.stringify(o.version)}; this harness reads version ${MANIFEST_VERSION}`);
  const id = c.string(o.id, "manifest.id", ID);
  const description = c.string(o.description, "manifest.description");
  const evidenceClass = c.oneOf(o.evidenceClass, "manifest.evidenceClass", ["synthetic", "real"] as const);
  if (o.coordinateConvention !== COORDINATE_CONVENTION) c.fail("manifest.coordinateConvention", `must be "${COORDINATE_CONVENTION}"`);

  const inputs: Record<string, InputSpec> = {};
  const rawInputs = c.object(o.inputs, "manifest.inputs", Object.keys(isObject(o.inputs) ? o.inputs : {}));
  for (const [key, value] of Object.entries(rawInputs ?? {})) {
    const where = `inputs.${key}`;
    if (!ID.test(key)) c.fail(where, "input IDs must be simple identifiers");
    const i = c.object(value, where, ["kind", "fixtureId", "redistributable", "path", "privatePath", "sha256", "generator", "labels"]);
    if (!i) continue;
    const kind = c.oneOf(i.kind, `${where}.kind`, ["pdf"] as const);
    const sha256 = c.string(i.sha256, `${where}.sha256`, SHA256);
    if (typeof i.redistributable !== "boolean") c.fail(`${where}.redistributable`, "must be a boolean");
    const spec: InputSpec = { kind: kind ?? "pdf", redistributable: i.redistributable === true, sha256: sha256 ?? "" };
    if (i.redistributable === true) {
      spec.path = c.string(i.path, `${where}.path`);
      spec.fixtureId = c.string(i.fixtureId, `${where}.fixtureId`, ID);
      if (i.privatePath !== undefined) c.fail(`${where}.privatePath`, "redistributable inputs use path, not privatePath");
      if (spec.path && (path.isAbsolute(spec.path) || spec.path.split(/[\\/]/).includes(".."))) c.fail(`${where}.path`, "must be a repository-relative path without ..");
    } else if (i.redistributable === false) {
      spec.privatePath = c.string(i.privatePath, `${where}.privatePath`);
      if (i.path !== undefined) c.fail(`${where}.path`, "private inputs use privatePath relative to $" + PRIVATE_ROOT_ENV);
      if (spec.privatePath && (path.isAbsolute(spec.privatePath) || spec.privatePath.split(/[\\/]/).includes(".."))) c.fail(`${where}.privatePath`, "must be relative to $" + PRIVATE_ROOT_ENV + " without ..");
      if (i.fixtureId !== undefined) spec.fixtureId = c.string(i.fixtureId, `${where}.fixtureId`, ID);
    }
    spec.generator = c.optionalString(i.generator, `${where}.generator`);
    if (i.labels !== undefined) {
      const l = c.object(i.labels, `${where}.labels`, ["path", "sha256"]);
      const lp = l && c.string(l.path, `${where}.labels.path`), ls = l && c.string(l.sha256, `${where}.labels.sha256`, SHA256);
      if (lp && ls) spec.labels = { path: lp, sha256: ls };
    }
    inputs[key] = spec;
  }
  if (Object.keys(inputs).length === 0) c.fail("manifest.inputs", "must declare at least one input");

  const defaults = o.defaults === undefined ? {} : c.object(o.defaults, "manifest.defaults", ["detector", "render", "scoring", "gates", "split", "labelProvenance"]) ?? {};
  const cases: CaseSpec[] = [];
  if (!Array.isArray(o.cases) || o.cases.length === 0) c.fail("manifest.cases", "must be a non-empty array");
  const seen = new Set<string>();
  for (const [index, value] of (Array.isArray(o.cases) ? o.cases : []).entries()) {
    const where = `cases[${index}]`;
    const k = c.object(value, where, ["id", "input", "page", "sheet", "symbolClass", "split", "labelProvenance", "example", "expected", "negatives", "ignore", "detector", "render", "scoring", "gates", "note"]);
    if (!k) continue;
    const caseId = c.string(k.id, `${where}.id`, ID);
    if (caseId && seen.has(caseId)) c.fail(`${where}.id`, `duplicate case id "${caseId}"`);
    if (caseId) seen.add(caseId);
    const input = c.string(k.input, `${where}.input`);
    if (input && !inputs[input]) c.fail(`${where}.input`, `references undeclared input "${input}"`);
    const page = c.number(k.page, `${where}.page`, 1, 100000, true);
    const sheet = c.string(k.sheet, `${where}.sheet`);
    const symbolClass = c.string(k.symbolClass, `${where}.symbolClass`);
    const splitRaw = k.split ?? defaults.split;
    const s = c.object(splitRaw, `${where}.split`, ["project", "source", "set"]);
    const split = s && { project: c.string(s.project, `${where}.split.project`) ?? "", source: c.string(s.source, `${where}.split.source`) ?? "", set: c.oneOf(s.set, `${where}.split.set`, ["regression", "tuning", "holdout"] as const) ?? "regression" };
    const labelProvenance = c.oneOf(k.labelProvenance ?? defaults.labelProvenance, `${where}.labelProvenance`, ["synthetic-generator", "estimator-verified", "unverified"] as const);
    const e = c.object(k.example, `${where}.example`, ["box", "note"]);
    const exampleBox = e && c.box(e.box, `${where}.example.box`);
    const exampleNote = e && c.optionalString(e.note, `${where}.example.note`);
    if (!Array.isArray(k.expected)) c.fail(`${where}.expected`, "must be an array (use [] for a negative-only case)");
    const expected = (Array.isArray(k.expected) ? k.expected : []).flatMap((b, i) => { const box = c.box(b, `${where}.expected[${i}]`); return box ? [box] : []; });
    const negatives = c.regions(k.negatives ?? [], `${where}.negatives`);
    const ignore = c.regions(k.ignore ?? [], `${where}.ignore`);
    const detector = parseDetector(c, k.detector ?? defaults.detector, `${where}.detector`);
    const render = parseRender(c, k.render ?? defaults.render, `${where}.render`);
    const scoring = parseScoring(c, k.scoring ?? defaults.scoring, `${where}.scoring`);
    const gates = parseGates(c, { ...(isObject(defaults.gates) ? defaults.gates : {}), ...(isObject(k.gates) ? k.gates : {}) }, `${where}.gates`);
    if (k.gates !== undefined && !isObject(k.gates)) c.fail(`${where}.gates`, "must be an object");

    // Labels must not contradict each other.
    expected.forEach((box, i) => {
      const point = center(box);
      for (const region of ignore) if (contains(region.box, point)) c.fail(`${where}.expected[${i}]`, `lies inside ignored region "${region.label}"`);
      for (const region of negatives) if (contains(region.box, point)) c.fail(`${where}.expected[${i}]`, `lies inside negative region "${region.label}"`);
      expected.slice(0, i).forEach((other, j) => {
        if (Math.hypot(center(other).x - point.x, center(other).y - point.y) < 1e-6) c.fail(`${where}.expected[${i}]`, `duplicates expected[${j}]`);
      });
    });
    if (evidenceClass === "synthetic" && labelProvenance && labelProvenance !== "synthetic-generator") c.fail(`${where}.labelProvenance`, "synthetic manifests use synthetic-generator labels");
    if (evidenceClass === "real" && labelProvenance === "synthetic-generator") c.fail(`${where}.labelProvenance`, "real-plan labels cannot come from the synthetic generator");

    if (caseId && input && page !== undefined && sheet && symbolClass && split && labelProvenance && exampleBox && detector && render && scoring && gates) {
      cases.push({ id: caseId, input, page, sheet, symbolClass, split, labelProvenance, example: { box: exampleBox, ...(exampleNote ? { note: exampleNote } : {}) }, expected, negatives, ignore, detector, render, scoring, gates, ...(typeof k.note === "string" ? { note: k.note } : {}) });
    }
  }
  if (c.problems.length) throw new ManifestError(c.problems);
  return { format: MANIFEST_FORMAT, version: MANIFEST_VERSION, id: id!, description: description!, evidenceClass: evidenceClass!, coordinateConvention: COORDINATE_CONVENTION, inputs, cases };
}

export function sha256(data: NodeJS.ArrayBufferView | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface ResolvedInput { key: string; spec: InputSpec; absolutePath: string; bytes: Uint8Array; sha256: string }

export class InputError extends Error {
  constructor(readonly input: string, message: string) {
    super(`Input "${input}": ${message}`);
    this.name = "InputError";
  }
}

/**
 * Locates an input, reads it and verifies its checksum. Private inputs must
 * resolve outside the repository so customer drawings are not committed.
 */
export function resolveInput(key: string, spec: InputSpec, repoRoot: string, env: Record<string, string | undefined> = process.env): ResolvedInput {
  let absolutePath: string;
  if (spec.redistributable) {
    absolutePath = path.resolve(repoRoot, spec.path!);
    if (path.relative(repoRoot, absolutePath).startsWith("..")) throw new InputError(key, "redistributable fixture path escapes the repository");
  } else {
    const root = env[PRIVATE_ROOT_ENV];
    if (!root) throw new InputError(key, `private input needs $${PRIVATE_ROOT_ENV} (a directory outside the repository); it is not set`);
    absolutePath = path.resolve(root, spec.privatePath!);
    const relative = path.relative(repoRoot, absolutePath);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) throw new InputError(key, "private inputs must stay outside the repository");
  }
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) throw new InputError(key, `file not found at ${spec.redistributable ? spec.path : `$${PRIVATE_ROOT_ENV}/${spec.privatePath}`}`);
  const bytes = new Uint8Array(readFileSync(absolutePath));
  const actual = sha256(bytes);
  if (actual !== spec.sha256) throw new InputError(key, `checksum mismatch: manifest ${spec.sha256}, file ${actual}`);
  if (spec.kind === "pdf" && Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") throw new InputError(key, "is not a PDF file");
  if (spec.labels) {
    const labelPath = path.resolve(repoRoot, spec.labels.path);
    if (!existsSync(labelPath)) throw new InputError(key, `label source not found at ${spec.labels.path}`);
    const labelSha = sha256(readFileSync(labelPath));
    if (labelSha !== spec.labels.sha256) throw new InputError(key, `label source checksum mismatch: manifest ${spec.labels.sha256}, file ${labelSha}`);
  }
  return { key, spec, absolutePath, bytes, sha256: actual };
}
