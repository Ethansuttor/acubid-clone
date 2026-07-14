// Feet/inch parsing and formatting for calibration and length display.

/**
 * Parse a distance entered by the user into decimal feet.
 * Accepts: 25 | 25.5 | 25' | 25'6 | 25' 6" | 25 ft 6 in | 6" (inches only).
 * Returns null when unparseable or non-positive.
 */
export function parseDistanceFt(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/,/g, "");
  if (!s) return null;

  // inches only: 6" or 6in
  let m = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|in(?:ches)?)$/);
  if (m) {
    const ft = parseFloat(m[1]) / 12;
    return ft > 0 ? ft : null;
  }

  // feet with optional inches: 25 | 25.5 | 25' | 25ft | 25'6 | 25' 6" | 25 ft 6 in | 25-6
  m = s.match(
    /^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)?\s*[- ]?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in(?:ches)?)?)?$/
  );
  if (!m) return null;
  const feet = parseFloat(m[1]);
  const inches = m[2] ? parseFloat(m[2]) : 0;
  if (inches >= 12 && m[2]) return null;
  const total = feet + inches / 12;
  return total > 0 ? total : null;
}

/** 25.5 -> 25'-6" (nearest inch). */
export function formatFtIn(ft: number): string {
  const totalIn = Math.round(ft * 12);
  const f = Math.floor(totalIn / 12);
  const i = totalIn % 12;
  return `${f}'-${i}"`;
}

export function fmt(n: number, dp = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtQty(n: number): string {
  return Number.isInteger(n)
    ? n.toLocaleString("en-US")
    : n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
