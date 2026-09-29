// Runs a browser-style module worker (self.onmessage / self.postMessage) inside
// a Node worker thread so the evaluation harness can execute the production
// src/lib/autocount/local.worker.ts unchanged. Loaded by node-worker.ts.
import { parentPort, workerData } from "node:worker_threads";

if (!parentPort) throw new Error("worker-bootstrap.mjs must run in a worker thread.");
const port = parentPort;
globalThis.self = globalThis;
globalThis.postMessage = message => port.postMessage(message);
// Import first, then listen: MessagePort queues messages until a listener is
// attached, so no request can arrive before the worker has set onmessage.
await import(workerData.moduleUrl);
port.on("message", data => {
  if (typeof globalThis.onmessage !== "function") {
    port.postMessage({ error: "Evaluation worker module did not install self.onmessage." });
    return;
  }
  globalThis.onmessage({ data });
});
