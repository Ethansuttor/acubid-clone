import { describe, it, expect } from "vitest";
import { parseDistanceFt, formatFtIn, parseNumericInput } from "@/lib/units";

describe("parseDistanceFt", () => {
  it.each([
    ["25", 25],
    ["25.5", 25.5],
    ["25'", 25],
    ["25'6", 25.5],
    [`25' 6"`, 25.5],
    ["25 ft 6 in", 25.5],
    ["25-6", 25.5],
    [`6"`, 0.5],
    ["6in", 0.5],
    ["1,250", 1250],
  ])("parses %s -> %d ft", (input, expected) => {
    expect(parseDistanceFt(input)).toBeCloseTo(expected as number);
  });

  it.each([["", null], ["abc", null], ["0", null], ["-5", null], ["25'14\"", null]])(
    "rejects %s",
    (input) => {
      expect(parseDistanceFt(input as string)).toBeNull();
    }
  );
});

describe("formatFtIn", () => {
  it("formats decimal feet as ft-in", () => {
    expect(formatFtIn(25.5)).toBe(`25'-6"`);
    expect(formatFtIn(20)).toBe(`20'-0"`);
    expect(formatFtIn(0.5)).toBe(`0'-6"`);
  });
});

describe("parseNumericInput", () => {
  it("accepts money with symbols, spaces and thousands separators", () => {
    expect(parseNumericInput("$1,250.00")).toBe(1250);
    // "12 000" previously committed as $12 by parseFloat
    expect(parseNumericInput("12 000")).toBe(12000);
    expect(parseNumericInput("12.5")).toBe(12.5);
    expect(parseNumericInput("-10")).toBe(-10);
    expect(parseNumericInput("")).toBe(0);
  });

  it("returns null for input it cannot read, so callers keep the old value", () => {
    expect(parseNumericInput("abc")).toBeNull();
    expect(parseNumericInput("12abc")).toBeNull();
    // European decimal comma must not silently become 35
    expect(parseNumericInput("3,5")).toBeNull();
  });
});
