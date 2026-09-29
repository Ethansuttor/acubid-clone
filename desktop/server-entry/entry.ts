/**
 * Entry script for the standalone Next.js server when it runs as an Electron
 * utility process. Bundled to `server/voltline-server-entry.js` next to the
 * standalone `server.js`, which it loads unmodified.
 *
 * It waits for the launch secrets on the private parent port, then wraps the
 * first HTTP server Next.js creates:
 *   - the listener is forced onto 127.0.0.1 and the port the parent chose (0,
 *     an OS-assigned free port, unless one was requested explicitly), so a
 *     busy default port can never block startup and nothing listens
 *     off-loopback;
 *   - every request must carry this launch's token (403 otherwise), so other
 *     local processes and DNS-rebinding pages cannot use the server;
 *   - every response carries this launch's id, which the main process checks;
 *   - once listening, {launchId, port, address} is reported to the parent.
 * If Next.js ever stops creating its server through `http.createServer`, no
 * report is sent and startup fails visibly at the deadline instead of
 * running unguarded.
 */

import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import path from "node:path";

const TOKEN_HEADER = "x-voltline-launch-token";
const ID_HEADER = "x-voltline-launch-id";
const LOOPBACK = "127.0.0.1";

interface ParentPort {
  once(event: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (!parentPort) {
  console.error("voltline-server-entry must run as an Electron utility process.");
  process.exit(70);
}

function tokenMatches(expected: Buffer, supplied: string | string[] | undefined): boolean {
  if (typeof supplied !== "string") return false;
  const candidate = Buffer.from(supplied);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

parentPort.once("message", ({ data }) => {
  const start = data as { type?: unknown; launchId?: unknown; token?: unknown; port?: unknown } | null;
  if (
    !start ||
    start.type !== "start" ||
    typeof start.launchId !== "string" ||
    typeof start.token !== "string" ||
    start.token.length < 32 ||
    typeof start.port !== "number" ||
    !Number.isInteger(start.port) ||
    start.port < 0 ||
    start.port > 65_535
  ) {
    console.error("voltline-server-entry received an invalid start message.");
    process.exit(71);
  }
  const launchId = start.launchId;
  const listenPort = start.port;
  const expectedToken = Buffer.from(start.token);

  const originalCreateServer = http.createServer;
  let wrapped = false;
  (http as { createServer: unknown }).createServer = function createServer(this: unknown, ...args: unknown[]) {
    if (wrapped) return (originalCreateServer as (...a: unknown[]) => http.Server).apply(this, args);
    wrapped = true;
    const index = args.findIndex((arg) => typeof arg === "function");
    if (index >= 0) {
      const listener = args[index] as http.RequestListener;
      args[index] = function guarded(this: unknown, req: http.IncomingMessage, res: http.ServerResponse) {
        if (!tokenMatches(expectedToken, req.headers[TOKEN_HEADER])) {
          res.writeHead(403, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
          res.end("Forbidden");
          return;
        }
        delete req.headers[TOKEN_HEADER];
        res.setHeader(ID_HEADER, launchId);
        return listener.call(this as http.Server, req, res);
      };
    }
    const server = (originalCreateServer as (...a: unknown[]) => http.Server).apply(this, args);

    // WebSocket upgrades (unused in production) get the same token rule.
    const emit = server.emit;
    server.emit = function guardedEmit(this: http.Server, event: string | symbol, ...rest: unknown[]) {
      if (event === "upgrade") {
        const req = rest[0] as http.IncomingMessage;
        const socket = rest[1] as { destroy(): void };
        if (!tokenMatches(expectedToken, req.headers[TOKEN_HEADER])) {
          socket.destroy();
          return true;
        }
      }
      return emit.call(this, event, ...rest);
    } as typeof server.emit;

    const listen = server.listen;
    server.listen = function forcedLoopback(this: http.Server, ...listenArgs: unknown[]) {
      const callback = listenArgs.find((arg) => typeof arg === "function");
      const forced: unknown[] = callback ? [listenPort, LOOPBACK, callback] : [listenPort, LOOPBACK];
      return (listen as (...args: unknown[]) => http.Server).apply(this, forced);
    } as typeof server.listen;

    server.once("listening", () => {
      const address = server.address() as AddressInfo | null;
      parentPort.postMessage({
        type: "listening",
        launchId,
        port: address?.port ?? null,
        address: address?.address ?? null,
      });
    });
    return server;
  };

  process.env.HOSTNAME = LOOPBACK;
  // The unmodified standalone server, resolved next to this file.
  createRequire(__filename)(path.join(__dirname, "server.js"));
});
