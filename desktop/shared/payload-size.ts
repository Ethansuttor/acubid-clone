/**
 * Structural size check for values crossing the C1 desktop bridge. Used as the
 * preload's first gate (so an oversized request is refused before it is
 * copied) and again, authoritatively, in the main process. Dependency-free so
 * the sandboxed preload can bundle it.
 */

/** Maximum nesting depth of a payload. Real DTOs nest three or four levels. */
export const MAX_PAYLOAD_DEPTH = 32;
/** Maximum number of values walked; bounds the cost of validation itself. */
export const MAX_PAYLOAD_NODES = 2_000_000;

export type SizeCheck =
  | { readonly ok: true; readonly bytes: number }
  | { readonly ok: false; readonly code: "too-large" | "invalid-input"; readonly message: string };

/**
 * Walk a structured-clone value and estimate its size in bytes. Strings count
 * as UTF-16 (two bytes per code unit), binary data by byteLength. Anything that
 * is not plain JSON-like data or binary — Map, Set, Date, class instances,
 * functions, symbols, cycles — is rejected: the C1 contract carries none of
 * them.
 */
export function measurePayload(value: unknown, limitBytes: number): SizeCheck {
  let bytes = 0;
  let nodes = 0;
  const onPath = new Set<object>();
  const tooLarge = (): SizeCheck => ({
    ok: false,
    code: "too-large",
    message: `The request exceeds the ${Math.floor(limitBytes / (1024 * 1024))} MB desktop bridge limit.`,
  });
  const invalid = (message: string): SizeCheck => ({ ok: false, code: "invalid-input", message });

  function walk(node: unknown, depth: number): SizeCheck | null {
    nodes += 1;
    if (nodes > MAX_PAYLOAD_NODES) return tooLarge();
    if (depth > MAX_PAYLOAD_DEPTH) return invalid("The request is nested too deeply.");
    if (node === null || node === undefined) {
      bytes += 1;
    } else if (typeof node === "string") {
      bytes += node.length * 2;
    } else if (typeof node === "number" || typeof node === "bigint") {
      bytes += 8;
    } else if (typeof node === "boolean") {
      bytes += 1;
    } else if (node instanceof ArrayBuffer) {
      bytes += node.byteLength;
    } else if (ArrayBuffer.isView(node)) {
      bytes += node.byteLength;
    } else if (typeof node === "object") {
      const isArray = Array.isArray(node);
      if (!isArray) {
        const proto = Object.getPrototypeOf(node);
        if (proto !== Object.prototype && proto !== null) {
          return invalid("The request contains a value that is not plain data.");
        }
      }
      if (onPath.has(node)) return invalid("The request contains a reference cycle.");
      onPath.add(node);
      bytes += 8;
      if (isArray) {
        for (const item of node as unknown[]) {
          const result = walk(item, depth + 1);
          if (result) return result;
          if (bytes > limitBytes) return tooLarge();
        }
      } else {
        for (const key of Object.keys(node)) {
          bytes += key.length * 2;
          const result = walk((node as Record<string, unknown>)[key], depth + 1);
          if (result) return result;
          if (bytes > limitBytes) return tooLarge();
        }
      }
      onPath.delete(node);
    } else {
      return invalid("The request contains a value that cannot cross the desktop bridge.");
    }
    return bytes > limitBytes ? tooLarge() : null;
  }

  const failure = walk(value, 0);
  return failure ?? { ok: true, bytes };
}
