import { describe, it, expect } from "vitest";
import { parseDistanceFt, formatFtIn } from "@/lib/units";

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
