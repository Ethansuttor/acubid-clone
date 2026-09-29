// Unit coverage for the pure parts of the desktop shell (track D1/D2): switch
// parsing, URL policy, the privileged-side IPC gate, the unavailable-backend
// contract answers, payload measurement, the close state machine, the server
// child environment and the loopback proxy's header rules. Electron itself is
// exercised by e2e-desktop against the staged app.

import path from "node:path";
import { describe, expect, it } from "vitest";
import { IPC_PROTOCOL_VERSION, MAX_IPC_PAYLOAD_BYTES } from "../desktop/contracts";
import { CloseGuard, type CloseChoice, type CloseGuardEffects } from "../desktop/main/close-guard";
import {
  DEFAULT_STARTUP_TIMEOUT_MS,
  LAUNCH_ID_HEADER,
  LAUNCH_TOKEN_HEADER,
  parseDesktopArgs,
  resolveServerDir,
} from "../desktop/main/config";
import { gateIpcMessage, type GateEvent } from "../desktop/main/ipc-gate";
import { dispatchIpc } from "../desktop/main/ipc-handlers";
import { isNavigationAllowed, isPermissionAllowed, isRendererRequestBlocked, urlOrigin } from "../desktop/main/navigation";
import { downstreamResponseHeaders, rewriteLocation, upstreamRequestHeaders } from "../desktop/main/proxy";
import { OutputTail, serverEnvironment } from "../desktop/main/server-env";
import { measurePayload } from "../desktop/shared/payload-size";

describe("desktop switches", () => {
  const abs = path.resolve("scratch", "data");
  it("accepts an absolute data dir, port and timeouts and ignores foreign switches", () => {
    const result = parseDesktopArgs(["--no-sandbox", `--voltline-data-dir=${abs}`, "--voltline-server-port=3150", "--voltline-startup-timeout-ms=5000"]);
    expect(result).toEqual({
      ok: true,
      options: { dataDir: abs, startupTimeoutMs: 5000, serverPort: 3150, closeSettleMs: 5000 },
    });
  });
  it("defaults to an OS-assigned port and the default startup deadline", () => {
    const result = parseDesktopArgs([]);
    expect(result).toMatchObject({ ok: true, options: { dataDir: null, serverPort: null, startupTimeoutMs: DEFAULT_STARTUP_TIMEOUT_MS } });
  });
  it("rejects malformed Voltline switches instead of defaulting", () => {
    for (const arg of [
      "--voltline-data-dir=relative/path",
      "--voltline-data-dir=",
      "--voltline-server-port=80",
      "--voltline-server-port=abc",
      "--voltline-startup-timeout-ms=5",
      "--voltline-close-settle-ms=999999",
      "--voltline-unknown=1",
    ]) {
      expect(parseDesktopArgs([arg]).ok, arg).toBe(false);
    }
  });
  it("derives the server payload from the app path, not the working directory", () => {
    expect(resolveServerDir("/opt/Voltline/resources/app", path.posix)).toBe("/opt/Voltline/resources/server");
    expect(resolveServerDir("C:\\Program Files\\Voltline\\resources\\app.asar", path.win32)).toBe(
      "C:\\Program Files\\Voltline\\resources\\server"
    );
  });
});

describe("URL policy", () => {
  it("reads the origin of custom-scheme URLs (where WHATWG origin is 'null')", () => {
    expect(urlOrigin("voltline://app/project/1?x=1")).toBe("voltline://app");
    expect(urlOrigin("about:blank")).toBeNull();
  });
  it("keeps each window on its own origin", () => {
    expect(isNavigationAllowed("workspace", "voltline://app/login")).toBe(true);
    expect(isNavigationAllowed("workspace", "voltline://shell/status.html")).toBe(false);
    expect(isNavigationAllowed("workspace", "http://127.0.0.1:3000/")).toBe(false);
    expect(isNavigationAllowed("workspace", "file:///etc/passwd")).toBe(false);
    expect(isNavigationAllowed("workspace", "javascript:alert(1)")).toBe(false);
    expect(isNavigationAllowed("shell", "voltline://shell/status.html")).toBe(true);
    expect(isNavigationAllowed("shell", "voltline://app/")).toBe(false);
  });
  it("cancels renderer http(s)/ws(s)/ftp requests and grants permissions only to the app origin", () => {
    for (const url of ["http://127.0.0.1:1/", "https://example.com/", "ws://x/", "wss://x/", "ftp://x/", "not a url"]) {
      expect(isRendererRequestBlocked(url), url).toBe(true);
    }
    expect(isRendererRequestBlocked("voltline://app/_next/static/a.js")).toBe(false);
    expect(isRendererRequestBlocked("blob:voltline://app/abc")).toBe(false);
    expect(isPermissionAllowed("persistent-storage", "voltline://app/")).toBe(true);
    expect(isPermissionAllowed("persistent-storage", "voltline://shell/status.html")).toBe(false);
    expect(isPermissionAllowed("media", "voltline://app/")).toBe(false);
    expect(isPermissionAllowed("persistent-storage", null)).toBe(false);
  });
});

describe("IPC gate", () => {
  const workspace = new Set([7]);
  const goodEvent: GateEvent = { sender: { id: 7 }, senderFrame: { url: "voltline://app/project/1", parent: null } };
  const request = (over: Record<string, unknown> = {}) => ({
    protocol: IPC_PROTOCOL_VERSION,
    requestId: "r1",
    operation: "app.capabilities",
    payload: null,
    ...over,
  });
  const refusal = (event: GateEvent, message: unknown, limit?: number) => {
    const decision = gateIpcMessage(event, message, workspace, limit);
    return decision.ok ? null : decision.response.error;
  };

  it("accepts a well-formed request from the workspace's main frame", () => {
    expect(gateIpcMessage(goodEvent, request(), workspace).ok).toBe(true);
  });
  it("refuses unknown senders, subframes, other origins and destroyed frames", () => {
    expect(refusal({ ...goodEvent, sender: { id: 8 } }, request())?.code).toBe("unauthorized");
    expect(refusal({ ...goodEvent, senderFrame: { url: "voltline://app/", parent: {} } }, request())?.code).toBe("unauthorized");
    expect(refusal({ ...goodEvent, senderFrame: { url: "voltline://shell/status.html", parent: null } }, request())?.code).toBe("unauthorized");
    expect(refusal({ ...goodEvent, senderFrame: { url: "http://127.0.0.1:3000/", parent: null } }, request())?.code).toBe("unauthorized");
    expect(refusal({ ...goodEvent, senderFrame: null }, request())?.code).toBe("unauthorized");
  });
  it("refuses malformed envelopes, wrong protocol versions and unknown operations", () => {
    for (const message of [null, "x", [], 42, request({ extra: 1 }), { protocol: 1, requestId: "r", operation: "app.capabilities" }]) {
      expect(refusal(goodEvent, message)?.code, JSON.stringify(message)).toBe("invalid-input");
    }
    expect(refusal(goodEvent, request({ protocol: IPC_PROTOCOL_VERSION + 1 }))?.code).toBe("invalid-input");
    expect(refusal(goodEvent, request({ operation: "storage.rawSql" }))?.code).toBe("invalid-input");
    expect(refusal(goodEvent, request({ requestId: "" }))?.code).toBe("invalid-input");
    expect(refusal(goodEvent, request({ requestId: "x".repeat(65) }))?.code).toBe("invalid-input");
  });
  it("bounds payload size and rejects values that are not plain data", () => {
    expect(refusal(goodEvent, request({ payload: "x".repeat(600) }), 1024)?.code).toBe("too-large");
    expect(refusal(goodEvent, request({ payload: new Map() }))?.code).toBe("invalid-input");
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(refusal(goodEvent, request({ payload: cycle }))?.code).toBe("invalid-input");
    expect(refusal(goodEvent, request({ payload: () => 1 }))?.code).toBe("invalid-input");
  });
  it("never echoes an unusable request id", () => {
    const decision = gateIpcMessage(goodEvent, request({ requestId: "x".repeat(200), extra: 1 }), workspace);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.response.requestId).toBe("");
  });
});

describe("operations without a backend", () => {
  const context = { appVersion: "0.0.0-test" };
  it("answers app.capabilities honestly: IndexedDB preview, no managed credentials", async () => {
    const response = await dispatchIpc({ protocol: IPC_PROTOCOL_VERSION, requestId: "a", operation: "app.capabilities", payload: null }, context);
    expect(response).toMatchObject({
      ok: true,
      value: { recordStore: "indexeddb", fileStore: "indexeddb", managedCredentials: false, appVersion: "0.0.0-test" },
    });
  });
  it("returns an explicit unavailable error for storage, AI and credential operations", async () => {
    for (const operation of ["storage.select", "storage.putFile", "storage.restore", "ai.verifyCrops", "ai.analyzeSheets", "ai.cancel", "credential.set", "credential.status"] as const) {
      const response = await dispatchIpc({ protocol: IPC_PROTOCOL_VERSION, requestId: "b", operation, payload: null }, context);
      expect(response, operation).toMatchObject({ ok: false, error: { code: "unavailable" } });
    }
  });
});

describe("payload measurement", () => {
  it("counts binary data by byteLength and stays under the limit for normal DTOs", () => {
    const result = measurePayload({ path: "a.pdf", bytes: new ArrayBuffer(1000), contentType: "application/pdf" }, MAX_IPC_PAYLOAD_BYTES);
    expect(result.ok && result.bytes).toBeGreaterThan(1000);
  });
  it("rejects oversized binary, deep nesting, dates and class instances", () => {
    expect(measurePayload(new ArrayBuffer(2048), 1024)).toMatchObject({ ok: false, code: "too-large" });
    let deep: unknown = 1;
    for (let i = 0; i < 40; i += 1) deep = { deep };
    expect(measurePayload(deep, MAX_IPC_PAYLOAD_BYTES)).toMatchObject({ ok: false, code: "invalid-input" });
    expect(measurePayload(new Date(), 1024)).toMatchObject({ ok: false, code: "invalid-input" });
    expect(measurePayload(Symbol("x"), 1024)).toMatchObject({ ok: false, code: "invalid-input" });
  });
});

describe("close guard", () => {
  function harness(choice: CloseChoice) {
    let now = 0;
    const timers: { at: number; run: () => void }[] = [];
    const calls = { requestClose: 0, asked: 0 };
    const effects: CloseGuardEffects = {
      requestClose: () => {
        calls.requestClose += 1;
      },
      ask: async () => {
        calls.asked += 1;
        return choice;
      },
      now: () => now,
      schedule: (run, delay) => {
        const timer = { at: now + delay, run };
        timers.push(timer);
        return () => timers.splice(timers.indexOf(timer), 1);
      },
    };
    const guard = new CloseGuard(effects, { settleWindowMs: 1000, pollIntervalMs: 250 });
    const advance = (ms: number) => {
      now += ms;
      for (const timer of timers.filter((t) => t.at <= now)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.run();
      }
    };
    return { guard, calls, advance };
  }

  it("keeps the window open and retries while local saves are pending", () => {
    const { guard, calls, advance } = harness("keep-editing");
    expect(guard.onUnloadBlocked()).toBe(false);
    expect(guard.current).toBe("waiting");
    advance(250);
    expect(calls.requestClose).toBe(1);
    expect(calls.asked).toBe(0);
  });
  it("asks once the settle window passes, and keep-editing leaves the window open", async () => {
    const { guard, calls, advance } = harness("keep-editing");
    guard.onUnloadBlocked();
    advance(1000);
    expect(guard.onUnloadBlocked()).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.asked).toBe(1);
    expect(guard.current).toBe("idle");
  });
  it("only the explicit discard choice lets an unsaved window close", async () => {
    const { guard, advance } = harness("discard");
    guard.onUnloadBlocked();
    advance(1000);
    guard.onUnloadBlocked();
    await Promise.resolve();
    await Promise.resolve();
    expect(guard.current).toBe("forcing");
    expect(guard.onUnloadBlocked()).toBe(true);
  });
});

describe("server child environment and output", () => {
  it("passes only an allowlist and pins production, telemetry, loopback and port", () => {
    const env = serverEnvironment(
      { PATH: "/usr/bin", NODE_OPTIONS: "--require x", ELECTRON_RUN_AS_NODE: "1", HTTPS_PROXY: "http://p", ANTHROPIC_API_KEY: "sk-secret", HOME: "/home/u", TEMP: "C:\\Temp" },
      3150
    );
    expect(env).toEqual({
      HOME: "/home/u",
      TEMP: "C:\\Temp",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      HOSTNAME: "127.0.0.1",
      PORT: "3150",
    });
    expect(serverEnvironment({}).PORT).toBe("0");
  });
  it("keeps a bounded tail of child output", () => {
    const tail = new OutputTail(3);
    tail.push("a\nb\nc\nd\npartial");
    expect(tail.text()).toBe("b\nc\nd\npartial");
  });
});

describe("loopback proxy rules", () => {
  const target = { port: 41234, token: "t".repeat(43), launchId: "launch-1" };
  it("drops caller-supplied Voltline headers, hop-by-hop headers and compression, then adds the token", () => {
    const headers = upstreamRequestHeaders(
      [
        ["Host", "app"],
        ["Connection", "keep-alive"],
        ["Accept-Encoding", "gzip"],
        ["X-Voltline-Launch-Token", "forged"],
        ["X-Voltline-Anything", "1"],
        ["Content-Type", "application/json"],
      ],
      target
    );
    expect(headers).toEqual({
      "content-type": "application/json",
      host: "127.0.0.1:41234",
      "accept-encoding": "identity",
      [LAUNCH_TOKEN_HEADER]: target.token,
    });
  });
  it("accepts only responses stamped with this launch's identity", () => {
    expect(downstreamResponseHeaders({ [LAUNCH_ID_HEADER]: "other" }, target).ok).toBe(false);
    expect(downstreamResponseHeaders({}, target).ok).toBe(false);
    const ok = downstreamResponseHeaders({ [LAUNCH_ID_HEADER]: "launch-1", "content-type": "text/html", "transfer-encoding": "chunked" }, target);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.headers.get("content-type")).toBe("text/html");
      expect(ok.headers.has("transfer-encoding")).toBe(false);
      expect(ok.headers.has(LAUNCH_ID_HEADER)).toBe(false);
    }
  });
  it("maps absolute upstream redirects back onto the app origin and leaves others alone", () => {
    expect(rewriteLocation("http://127.0.0.1:41234/login?x=1", 41234)).toBe("voltline://app/login?x=1");
    expect(rewriteLocation("/login", 41234)).toBe("/login");
    expect(rewriteLocation("https://example.com/", 41234)).toBe("https://example.com/");
  });
});
