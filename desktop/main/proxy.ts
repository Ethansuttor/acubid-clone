/**
 * `voltline://app/*` → this launch's loopback Next.js server.
 *
 * The renderer's origin is the privileged scheme, never `127.0.0.1:<port>`,
 * so the workspace's IndexedDB/Web Locks/localStorage keep the same origin no
 * matter which free port the server bound. Every upstream request carries the
 * launch's secret token (the server refuses requests without it), and every
 * response must carry the launch's identity header (the proxy refuses a
 * response from anything else). Uses Node's http client in the main process,
 * so no Chromium proxy setting or system proxy can divert loopback traffic.
 */

import http from "node:http";
import { Readable } from "node:stream";
import { APP_ORIGIN } from "../shared/constants";
import { LAUNCH_ID_HEADER, LAUNCH_TOKEN_HEADER, LOOPBACK_HOST } from "./config";

export interface UpstreamTarget {
  readonly port: number;
  readonly token: string;
  readonly launchId: string;
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);

/** Request headers for the upstream call. Caller-supplied Voltline headers are
 * dropped so a page cannot forge or probe the launch token, and compression is
 * disabled: loopback gains nothing from it and it keeps bodies unambiguous. */
export function upstreamRequestHeaders(
  incoming: Iterable<[string, string]>,
  target: UpstreamTarget
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [rawName, value] of incoming) {
    const name = rawName.toLowerCase();
    if (HOP_BY_HOP.has(name) || name.startsWith("x-voltline-") || name === "accept-encoding") continue;
    headers[name] = value;
  }
  headers.host = `${LOOPBACK_HOST}:${target.port}`;
  headers["accept-encoding"] = "identity";
  headers[LAUNCH_TOKEN_HEADER] = target.token;
  return headers;
}

/** Map an absolute upstream Location back onto the app origin. */
export function rewriteLocation(location: string, port: number): string {
  const upstreamOrigin = `http://${LOOPBACK_HOST}:${port}`;
  try {
    const url = new URL(location, `${upstreamOrigin}/`);
    if (url.origin !== upstreamOrigin) return location;
    // Relative locations resolve the same against either origin.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(location)) return location;
    return `${APP_ORIGIN}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return location;
  }
}

export type ResponseHeaderCheck =
  | { readonly ok: true; readonly headers: Headers }
  | { readonly ok: false; readonly reason: string };

export function downstreamResponseHeaders(
  incoming: http.IncomingHttpHeaders,
  target: UpstreamTarget
): ResponseHeaderCheck {
  const identity = incoming[LAUNCH_ID_HEADER];
  if (identity !== target.launchId) {
    return { ok: false, reason: "The response did not come from this launch's local server." };
  }
  const headers = new Headers();
  for (const [rawName, value] of Object.entries(incoming)) {
    const name = rawName.toLowerCase();
    if (value === undefined || HOP_BY_HOP.has(name) || name.startsWith("x-voltline-")) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      headers.append(name, name === "location" ? rewriteLocation(item, target.port) : item);
    }
  }
  return { ok: true, headers };
}

export function textResponse(status: number, title: string, detail: string): Response {
  const escape = (text: string) =>
    text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
  const body =
    `<!doctype html><meta charset="utf-8"><title>${escape(title)}</title>` +
    `<body style="font:14px system-ui,sans-serif;margin:3rem;max-width:40rem;color:#1b2430;background:#f3f5f7">` +
    `<h1 style="font-size:18px">${escape(title)}</h1><p>${escape(detail)}</p></body>`;
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}

const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

/** Forward one renderer request to the loopback server. Never throws. */
export function proxyToServer(request: Request, target: UpstreamTarget): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  return new Promise<Response>((resolve) => {
    let settled = false;
    const finish = (response: Response) => {
      if (!settled) {
        settled = true;
        resolve(response);
      }
    };
    const upstream = http.request(
      {
        host: LOOPBACK_HOST,
        port: target.port,
        method,
        path: `${url.pathname}${url.search}`,
        headers: upstreamRequestHeaders(request.headers.entries(), target),
        // One connection per request is simplest and loopback-cheap; it also
        // means a restarted server never inherits a stale keep-alive socket.
        agent: false,
      },
      (response) => {
        const status = response.statusCode ?? 502;
        const mapped = downstreamResponseHeaders(response.headers, target);
        if (!mapped.ok) {
          response.resume();
          finish(textResponse(502, "Voltline could not verify its local server", mapped.reason));
          return;
        }
        if (status < 200 || status > 599) {
          response.resume();
          finish(textResponse(502, "Voltline's local server sent an unsupported response", `Status ${status}.`));
          return;
        }
        const body =
          method === "HEAD" || NULL_BODY_STATUS.has(status)
            ? null
            : (Readable.toWeb(response) as unknown as ReadableStream<Uint8Array>);
        if (body === null) response.resume();
        finish(new Response(body, { status, statusText: response.statusMessage, headers: mapped.headers }));
      }
    );
    upstream.on("error", (error) => {
      finish(
        textResponse(
          502,
          "Voltline's local server is not responding",
          `The request could not reach the local server (${error.message}). Your saved work is stored on this computer.`
        )
      );
    });
    if (request.body && method !== "GET" && method !== "HEAD") {
      const body = Readable.fromWeb(request.body as unknown as import("node:stream/web").ReadableStream);
      body.on("error", (error) => upstream.destroy(error));
      body.pipe(upstream);
    } else {
      upstream.end();
    }
  });
}
