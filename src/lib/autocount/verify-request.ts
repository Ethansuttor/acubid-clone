import type { VerifyRequest } from "./types";

function smallPng(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 300_000 || !value.startsWith("data:image/png;base64,")) return false;
  const encoded = value.slice(22);
  if (encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return false;
  try {
    const bytes = atob(encoded);
    if (bytes.length < 24 || bytes.slice(0, 8) !== "\x89PNG\r\n\x1a\n" || bytes.slice(12, 16) !== "IHDR") return false;
    const read = (offset: number) => ((bytes.charCodeAt(offset) * 256 + bytes.charCodeAt(offset + 1)) * 256 + bytes.charCodeAt(offset + 2)) * 256 + bytes.charCodeAt(offset + 3);
    const width = read(16), height = read(20);
    return width >= 1 && height >= 1 && width <= 256 && height <= 256;
  } catch { return false; }
}

export function validateVerifyRequest(value: unknown): value is VerifyRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as VerifyRequest;
  if (request.mode !== "verify" || !smallPng(request.template) || !Array.isArray(request.crops) || request.crops.length < 1 || request.crops.length > 12) return false;
  const indices = new Set<number>();
  for (const crop of request.crops) {
    if (!crop || !Number.isInteger(crop.index) || crop.index < 0 || indices.has(crop.index) || !smallPng(crop.image)) return false;
    indices.add(crop.index);
  }
  return true;
}
