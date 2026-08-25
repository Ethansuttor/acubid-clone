// Drawing-scale parsing.
//
// A plan drawn at 1/4" = 1'-0" means a quarter inch of paper is one foot, so
// one inch of paper is four feet. PDF user space is 72 units to the inch, so
// a stated scale gives feet-per-unit directly — provided the PDF was plotted
// at true size, which is why the app always asks the estimator to confirm.

/** Feet represented by one inch of paper, or null if the text has no usable scale. */
export function parseDrawingScale(input: string): number | null {
  const s = (input ?? "").trim().toLowerCase();
  if (s === "") return null;
  // Not-to-scale markings must never produce a calibration.
  if (/\b(nts|n\.t\.s\.?|not to scale|as noted|varies|none)\b/.test(s)) return null;

  const paper = "(\\d+(?:\\.\\d+)?)\\s*(?:\\/\\s*(\\d+(?:\\.\\d+)?))?\\s*(?:\"|''|in\\b|inch(?:es)?\\b)?";
  const feet = "(\\d+(?:\\.\\d+)?)\\s*(?:'|ft\\b|feet\\b|foot\\b)";
  const inches = "(?:\\s*[-\\s]\\s*(\\d+(?:\\.\\d+)?)\\s*(?:\"|''|in\\b)?)?";
  const m = s.match(new RegExp(`${paper}\\s*=\\s*${feet}${inches}`));
  if (!m) return null;

  const [, whole, denom, ft, extraIn] = m;
  const paperInches = denom ? Number(whole) / Number(denom) : Number(whole);
  const realFeet = Number(ft) + (extraIn ? Number(extraIn) / 12 : 0);
  if (!Number.isFinite(paperInches) || paperInches <= 0) return null;
  if (!Number.isFinite(realFeet) || realFeet <= 0) return null;

  const feetPerInch = realFeet / paperInches;
  // Guard against nonsense readings from a misread title block.
  if (feetPerInch < 0.05 || feetPerInch > 2000) return null;
  return feetPerInch;
}

/** PDF user-space units per inch. */
export const UNITS_PER_INCH = 72;

/** Feet per PDF unit for a scale expressed as feet per inch of paper. */
export function feetPerUnit(feetPerInch: number): number {
  return feetPerInch / UNITS_PER_INCH;
}

/**
 * A calibration record equivalent to the stated scale: one inch of paper
 * (72 units) measured as `feetPerInch` feet. Stored in the same shape as a
 * hand calibration so recalibrating by hand later behaves identically.
 */
export function calibrationFromScale(feetPerInch: number): {
  p1: [number, number];
  p2: [number, number];
  distance_ft: number;
} {
  return { p1: [0, 0], p2: [UNITS_PER_INCH, 0], distance_ft: feetPerInch };
}

/** Human-readable form, e.g. 4 -> `1" = 4'`. */
export function formatScale(feetPerInch: number): string {
  const common: Record<string, number> = {
    '1/16" = 1\'-0"': 16,
    '3/32" = 1\'-0"': 32 / 3,
    '1/8" = 1\'-0"': 8,
    '3/16" = 1\'-0"': 16 / 3,
    '1/4" = 1\'-0"': 4,
    '3/8" = 1\'-0"': 8 / 3,
    '1/2" = 1\'-0"': 2,
    '3/4" = 1\'-0"': 4 / 3,
    '1" = 1\'-0"': 1,
  };
  for (const [label, v] of Object.entries(common)) {
    if (Math.abs(v - feetPerInch) < 1e-6) return label;
  }
  return `1" = ${Number(feetPerInch.toFixed(4))}'`;
}
