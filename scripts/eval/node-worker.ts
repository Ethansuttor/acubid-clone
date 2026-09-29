// Browser `Worker` adapter for Node, used only by the evaluation harness.
//
// src/lib/autocount/worker-client.ts constructs
//   new Worker(new URL("./local.worker.ts", import.meta.url), { type: "module" })
// and talks to it with postMessage/onmessage, a 60-second per-operation timer
// and terminate(). This adapter runs that same production worker module in a
// real Node worker thread, so the harness exercises the production client,
// worker, matcher and timeout/cancellation code instead of a re-implementation.
// It is not part of the application bundle.

import { Worker as NodeWorker } from "node:worker_threads";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const BOOTSTRAP = fileURLToPath(new URL("./worker-bootstrap.mjs", import.meta.url));

/** Worker threads need a TypeScript loader to import local.worker.ts. */
function workerExecArgv(): string[] {
  if (process.execArgv.some(arg => arg.includes("tsx"))) return [...process.execArgv];
  const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
  return [...process.execArgv, "--import", loader];
}

export interface WorkerShimStats {
  /** Workers constructed (one per detectOnCanvas call in production code). */
  created: number;
  /** Workers terminated by the client (close, cancel or timeout). */
  terminated: number;
  /** Messages posted from the harness side to a worker. */
  posted: number;
}

type MessageHandler = ((event: { data: unknown }) => void) | null;
type ErrorHandler = ((event: unknown) => void) | null;

export function installNodeWebWorker(): { stats: WorkerShimStats; restore(): void } {
  const stats: WorkerShimStats = { created: 0, terminated: 0, posted: 0 };
  const execArgv = workerExecArgv();

  class NodeWebWorker {
    onmessage: MessageHandler = null;
    onerror: ErrorHandler = null;
    private readonly thread: NodeWorker;
    private closed = false;

    constructor(url: URL | string, options?: { type?: string }) {
      const moduleUrl = typeof url === "string" ? url : url.href;
      if (!moduleUrl.startsWith("file:")) throw new Error(`Evaluation worker must be a local file URL, received ${moduleUrl}.`);
      if (options?.type && options.type !== "module") throw new Error(`Unsupported worker type ${options.type}.`);
      stats.created++;
      this.thread = new NodeWorker(BOOTSTRAP, { workerData: { moduleUrl }, execArgv });
      this.thread.on("message", data => { if (!this.closed) this.onmessage?.({ data }); });
      this.thread.on("error", error => { if (!this.closed) this.onerror?.(error); });
      this.thread.on("exit", code => {
        if (!this.closed && code !== 0) this.onerror?.(new Error(`Evaluation worker exited with code ${code}.`));
      });
    }

    postMessage(message: unknown, transfer?: ArrayBuffer[]) {
      if (this.closed) throw new Error("Evaluation worker was terminated.");
      stats.posted++;
      this.thread.postMessage(message, transfer);
    }

    terminate() {
      if (this.closed) return;
      this.closed = true;
      stats.terminated++;
      void this.thread.terminate();
    }
  }

  const globals = globalThis as { Worker?: unknown };
  const previous = globals.Worker;
  globals.Worker = NodeWebWorker;
  return {
    stats,
    restore() {
      if (previous === undefined) delete globals.Worker;
      else globals.Worker = previous;
    },
  };
}
