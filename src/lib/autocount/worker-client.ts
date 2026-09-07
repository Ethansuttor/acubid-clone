import type { Detection } from "./types";
import type { GrayImage } from "./ncc";
import type { LocalOptions } from "./local";

export function createLocalMatcher(signal: AbortSignal) {
  const worker = new Worker(new URL("./local.worker.ts", import.meta.url), { type: "module" });
  let rejectPending: ((error: Error) => void) | undefined;
  const abort = () => { worker.terminate(); rejectPending?.(new DOMException("Detection cancelled", "AbortError")); };
  signal.addEventListener("abort", abort, { once: true });
  function send(payload: object, buffer: ArrayBuffer): Promise<{ detections: Detection[] }> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { worker.terminate(); rejectPending?.(new Error("A detection tile timed out. Try a smaller symbol or disable size tolerance.")); }, 60_000);
      const cleanup = () => { clearTimeout(timer); rejectPending = undefined; };
      rejectPending = error => { cleanup(); reject(error); };
      worker.onmessage = event => {
        cleanup();
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data);
      };
      worker.onerror = () => { cleanup(); reject(new Error("The local detector worker could not start. Reload the page and try again.")); };
      try { worker.postMessage(payload, [buffer]); }
      catch (error) { cleanup(); reject(error); }
    });
  }
  return {
    async init(template: GrayImage, options: LocalOptions) { await send({ template, ...options }, template.g.buffer as ArrayBuffer); },
    async match(image: GrayImage, minScore: number) { return (await send({ image, minScore }, image.g.buffer as ArrayBuffer)).detections; },
    close() { worker.terminate(); signal.removeEventListener("abort", abort); },
  };
}
