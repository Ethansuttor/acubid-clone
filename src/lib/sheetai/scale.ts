// Drawing-scale parsing.
//
// A plan drawn at 1/4" = 1'-0" means a quarter inch of paper is one foot, so
// one inch of paper is four feet. PDF user space is 72 units to the inch, so
// a stated scale gives feet-per-unit directly — provided the PDF was plotted
// at true size, which is why the app always asks the estimator to confirm.

/**
 * Feet represented by one inch of paper, or null if the text has no single
 * usable scale.
 *
 * Title-block text is noisy — sheet sizes ("24X36"), sheet numbering ("2 OF
 * 5") and revision marks sit right next to the scale, and a detail sheet can
 * print several scales at once. Every rule below exists because some piece of
 * that noise otherwise parses into a plausible-looking wrong number, and a
 * wrong scale silently mis-measures every run on the sheet:
 *
 *  - the paper term must carry an inch marker or be a fraction, so "REV 3 = 1'"
 *    is not a scale;
 *  - a trailing inches term must carry its own inch marker, so "1'-0"" reads as
 *    one foot but "1' 24X36" does not read as twenty-five feet;
 *  - inches must be under twelve;
 *  - and if the text yields two different scales, it yields none.
 */
export function parseDrawingScale(input: string): number | null {
  const s = (input ?? "").trim().toLowerCase();
  if (s === "") return null;
  // Not-to-scale markings must never produce a calibration.
  if (/\b(nts|n\.t\.s\.?|not to scale|as noted|varies|none|n\/a)\b/.test(s)) return null;

  //         whole          numerator      denominator      inch marker
  const paper = "(?:(\\d+(?:\\.\\d+)?)\\s*[-\\s]\\s*)?(\\d+(?:\\.\\d+)?)\\s*(?:\\/\\s*(\\d+(?:\\.\\d+)?))?\\s*(\"|\'\'|in\\b|inch(?:es)?\\b)?";
  const feet = "(\\d+(?:\\.\\d+)?)\\s*(?:\'|ft\\b|feet\\b|foot\\b)";
  // A trailing inches term only counts with its own marker.
  const inches = "(?:\\s*[-\\s]\\s*(\\d+(?:\\.\\d+)?)\\s*(?:\"|\'\'|in\\b|inch(?:es)?\\b))?";
  const re = new RegExp(`${paper}\\s*=\\s*${feet}${inches}`, "g");

  const found = new Set<number>();
  for (const m of s.matchAll(re)) {
    const [, whole, numerator, denominator, marker, ft, extraIn] = m;
    // Without a fraction or an inch marker this is not a paper measurement.
    if (!denominator && !marker) continue;

    const paperInches = denominator
      ? (whole ? Number(whole) : 0) + Number(numerator) / Number(denominator)
      : Number(numerator);
    const inchPart = extraIn ? Number(extraIn) : 0;
    if (inchPart >= 12) continue; // a misread like 1'-99"
    const realFeet = Number(ft) + inchPart / 12;

    if (!Number.isFinite(paperInches) || paperInches <= 0) continue;
    if (!Number.isFinite(realFeet) || realFeet <= 0) continue;

    const feetPerInch = realFeet / paperInches;
    // Guard against nonsense readings from a misread title block.
    if (feetPerInch < 0.05 || feetPerInch > 2000) continue;
    found.add(Number(feetPerInch.toFixed(9)));
  }

  // Two different scales in one string is ambiguous, not a best guess.
  return found.size === 1 ? [...found][0] : null;
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
    '1-1/2" = 1\'-0"': 2 / 3,
    '3" = 1\'-0"': 1 / 3,
  };
  for (const [label, v] of Object.entries(common)) {
    if (Math.abs(v - feetPerInch) < 1e-6) return label;
  }
  return `1" = ${Number(feetPerInch.toFixed(4))}'`;
}
