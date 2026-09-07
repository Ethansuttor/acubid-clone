// Tests for autocount ClaudeVerifier, verification response parsing, and confidence blending (GA-6)

import { describe, it, expect } from "vitest";
import { blendConfidence, parseVerificationResults } from "@/lib/autocount/verify";

describe("GA-6: Verification response parser and confidence blend", () => {
  it("blends NCC score and model confidence equally (0.5 * ncc + 0.5 * model)", () => {
    expect(blendConfidence(0.8, 0.9)).toBeCloseTo(0.85, 5);
    expect(blendConfidence(1.0, 1.0)).toBe(1.0);
    expect(blendConfidence(0.0, 0.0)).toBe(0.0);
    expect(blendConfidence(0.5, 0.5)).toBe(0.5);
    expect(blendConfidence(0.6, 0.8)).toBeCloseTo(0.7, 5);
  });

  it("clamps and handles invalid confidence values", () => {
    expect(blendConfidence(NaN, 0.8)).toBeCloseTo(0.65, 5);
    expect(blendConfidence(1.5, 0.8)).toBeCloseTo(0.9, 5);
    expect(blendConfidence(-0.5, 0.8)).toBeCloseTo(0.4, 5);
  });

  it("parses clean JSON verification results", () => {
    const raw = JSON.stringify([
      { i: 1, match: true, confidence: 0.95 },
      { i: 2, match: false, confidence: 0.1 },
      { i: 3, match: true, confidence: 0.88 },
    ]);
    const results = parseVerificationResults(raw);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ index: 1, match: true, confidence: 0.95 });
    expect(results[1]).toEqual({ index: 2, match: false, confidence: 0.1 });
    expect(results[2]).toEqual({ index: 3, match: true, confidence: 0.88 });
  });

  it("accepts alternative index fields but refuses guessed boolean or confidence values", () => {
    const raw = JSON.stringify([
      { index: 10, match: "true", confidence: 0.92 },
      { index: 11, match: "false" },
    ]);
    const results = parseVerificationResults(raw);
    expect(results).toEqual([]);
    expect(parseVerificationResults('[{"index":10,"match":true,"confidence":0.92}]')).toEqual([{ index: 10, match: true, confidence: 0.92 }]);
  });

  it("tolerates markdown code fences and surrounding commentary", () => {
    const text = `
Here is the verification analysis:
\`\`\`json
[
  {"i": 1, "match": true, "confidence": 0.99},
  {"i": 2, "match": false, "confidence": 0.05}
]
\`\`\`
All candidate crops reviewed.
`;
    const results = parseVerificationResults(text);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ index: 1, match: true, confidence: 0.99 });
    expect(results[1]).toEqual({ index: 2, match: false, confidence: 0.05 });
  });

  it("returns [] for unparseable or non-array output", () => {
    expect(parseVerificationResults("no matches")).toEqual([]);
    expect(parseVerificationResults("[]")).toEqual([]);
    expect(parseVerificationResults('{"match": true}')).toEqual([]);
  });
});
