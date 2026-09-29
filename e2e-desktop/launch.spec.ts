// D1/D2 smoke: the staged production payload starts inside Electron's own
// runtime, the workspace loads from the stable `voltline://app` origin, the
// bridge is the only privileged surface the page sees, and the workspace
// (IndexedDB under that origin) survives a restart even when the loopback
// server comes back on a different port.

import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { APP_ORIGIN, launchVoltline, makeDataDir, osSandboxExpected, removeDir, waitSaved } from "./support/app";

test.describe("staged desktop app", () => {
  let dataDir: string;
  test.beforeEach(() => {
    dataDir = makeDataDir();
  });
  test.afterEach(() => {
    removeDir(dataDir);
  });

  test("starts the staged server and loads /login on the stable origin", async () => {
    const app = await launchVoltline({ dataDir });
    try {
      const page = await app.workspace();
      await expect(page.getByRole("button", { name: "Open workspace" })).toBeVisible();

      const view = await page.evaluate(() => ({
        origin: location.origin,
        secure: isSecureContext,
        locks: typeof navigator.locks?.request,
        idb: typeof indexedDB?.open,
        bridgeKeys: Object.keys((window as unknown as { voltline?: object }).voltline ?? {}).sort(),
        hasProcess: typeof (window as unknown as { process?: unknown }).process,
        hasRequire: typeof (window as unknown as { require?: unknown }).require,
      }));
      expect(view.origin).toBe(APP_ORIGIN);
      expect(view.secure).toBe(true);
      expect(view.locks).toBe("function");
      expect(view.idb).toBe("function");
      // The page sees the C1 bridge and nothing else privileged.
      expect(view.bridgeKeys).toEqual(["invoke", "protocol"]);
      expect(view.hasProcess).toBe("undefined");
      expect(view.hasRequire).toBe("undefined");

      const snapshot = await app.snapshot();
      expect(snapshot.serverState).toBe("ready");
      expect(snapshot.server?.port).toBeGreaterThan(1023);
      expect(snapshot.serverDir).toContain(`resources${process.platform === "win32" ? "\\" : "/"}server`);
      expect(snapshot.blockedRequests).toBe(0);
      expect(snapshot.startupError).toBeNull();

      // Renderer hardening as configured on the live window.
      const prefs = await app.electron.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith("voltline://app/"));
        // Present at runtime; missing from Electron 44's type declarations.
        const contents = win?.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> } | undefined;
        const p = contents?.getLastWebPreferences();
        return p ? { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration } : null;
      });
      expect(prefs).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false });

      // Operations without a backend answer with an explicit contract error.
      const answers = await page.evaluate(async () => {
        const bridge = (window as unknown as {
          voltline: { invoke(op: string, payload: unknown): Promise<{ ok: boolean; error?: { code: string } }> };
        }).voltline;
        return {
          capabilities: await bridge.invoke("app.capabilities", null),
          storage: await bridge.invoke("storage.health", null),
          credential: await bridge.invoke("credential.status", null),
          bogus: await bridge.invoke("storage.rawSql", null),
        };
      });
      expect(answers.capabilities.ok).toBe(true);
      expect(answers.storage).toMatchObject({ ok: false, error: { code: "unavailable" } });
      expect(answers.credential).toMatchObject({ ok: false, error: { code: "unavailable" } });
      expect(answers.bogus).toMatchObject({ ok: false, error: { code: "invalid-input" } });

      // A request to the loopback server that bypasses the scheme is cancelled.
      const port = snapshot.server?.port;
      const direct = await page.evaluate((p) => fetch(`http://127.0.0.1:${p}/login`).then(() => "reached", () => "blocked"), port);
      expect(direct).toBe("blocked");

      // POST through the scheme proxy reaches the production API route, which is closed in production.
      const api = await page.evaluate(() =>
        fetch("/api/autocount", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.status)
      );
      expect(api).toBe(401);
    } finally {
      await app.dispose();
    }
  });

  test("keeps the workspace across a restart on a different server port", async () => {
    const name = `Desktop persistence ${Date.now()}`;
    const first = await launchVoltline({ dataDir, args: ["--voltline-server-port=3161"] });
    try {
      expect((await first.snapshot()).server?.port).toBe(3161);
      const page = await first.workspace();
      await page.getByRole("button", { name: "Open workspace" }).click();
      await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
      await page.getByLabel("Project name", { exact: true }).fill(name);
      await page.getByRole("button", { name: "Create project" }).click();
      await expect(page).toHaveURL(/\/project\//);
      await expect(page.getByText(name, { exact: true })).toBeVisible();
      await waitSaved(page);
      await first.quit();
    } finally {
      await first.dispose();
    }

    const second = await launchVoltline({ dataDir, args: ["--voltline-server-port=3162"] });
    try {
      expect((await second.snapshot()).server?.port).toBe(3162);
      const page = await second.workspace();
      expect(await page.evaluate(() => location.origin)).toBe(APP_ORIGIN);
      // Still signed in, and the project created under the other port is there.
      await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 30_000 });
    } finally {
      await second.dispose();
    }
  });

  test("renderers run under the OS sandbox (Linux seccomp filter)", async () => {
    test.skip(process.platform !== "linux", "The seccomp check reads /proc; Windows sandboxing is not verified here.");
    test.skip(!osSandboxExpected, "VOLTLINE_E2E_NO_SANDBOX=1: the OS sandbox is disabled for this run and NOT verified.");
    const app = await launchVoltline({ dataDir });
    try {
      await app.workspace();
      const renderers = await app.electron.evaluate(({ app: electronApp }) =>
        electronApp.getAppMetrics().filter((metric) => metric.type === "Tab").map((metric) => metric.pid)
      );
      expect(renderers.length).toBeGreaterThan(0);
      for (const pid of renderers) {
        const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
        // Seccomp: 2 = filter mode; the Chromium renderer sandbox installs one.
        expect(status, `renderer ${pid}`).toMatch(/^Seccomp:\s+2$/m);
        expect(status, `renderer ${pid}`).toMatch(/^NoNewPrivs:\s+1$/m);
      }
    } finally {
      await app.dispose();
    }
  });
});
