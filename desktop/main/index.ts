/**
 * Voltline desktop main process (tracks D1 + D2).
 *
 * Lifecycle:
 *   parse switches → fix the data directory → single-instance lock for that
 *   directory → register the privileged `voltline:` scheme → show the status
 *   window → start this launch's standalone server in an Electron utility
 *   process and wait for its identity handshake → open the workspace window
 *   on `voltline://app/` (proxied to the server) → on close, respect the
 *   page's unsaved-changes signal → stop only our own server child on quit.
 *
 * Storage in this build is the workspace's own IndexedDB (a limited preview).
 * The C1 bridge answers storage/AI/credential operations with explicit
 * `unavailable` errors until those backends are integrated.
 */

import fs from "node:fs";
import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  session,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { IPC_CHANNEL } from "../contracts";
import {
  APP_HOST,
  APP_ORIGIN,
  APP_SCHEME,
  SHELL_ACTIONS,
  SHELL_HOST,
  SHELL_IPC_CHANNEL,
  SHELL_ORIGIN,
  type ShellAction,
} from "../shared/constants";
import { CloseGuard, type CloseChoice } from "./close-guard";
import {
  APP_NAME,
  APP_USER_MODEL_ID,
  CLOSE_POLL_INTERVAL_MS,
  parseDesktopArgs,
  resolveServerDir,
} from "./config";
import { gateIpcMessage, type GateEvent } from "./ipc-gate";
import { dispatchIpc } from "./ipc-handlers";
import { createLogger, type Logger } from "./log";
import {
  isNavigationAllowed,
  isPermissionAllowed,
  isSubframeNavigationAllowed,
  urlOrigin,
  type WindowRole,
} from "./navigation";
import { proxyToServer, textResponse } from "./proxy";
import { launchServer, StartupError, type ServerExit, type ServerLaunch } from "./server-process";

// A packaged Windows GUI app may have no usable stdout; never crash on it.
for (const stream of [process.stdout, process.stderr]) stream?.on?.("error", () => undefined);

/* ------------------------------------------------------------ early setup */

const parsed = parseDesktopArgs(process.argv.slice(1));
if (!parsed.ok) {
  dialog.showErrorBox("Voltline could not start", parsed.message);
  app.exit(2);
}
const options = parsed.ok ? parsed.options : { dataDir: null, startupTimeoutMs: 0, serverPort: null, closeSettleMs: 0 };

app.setName(APP_NAME);
if (process.platform === "win32") app.setAppUserModelId(APP_USER_MODEL_ID);

// The data directory is chosen explicitly (never inferred from package.json or
// the working directory) and fixed before anything else touches the profile.
const dataDir = options.dataDir ?? path.join(app.getPath("appData"), APP_NAME);
let dataDirError: string | null = null;
try {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.accessSync(dataDir, fs.constants.W_OK);
} catch (error) {
  dataDirError = `The data folder ${dataDir} cannot be written: ${error instanceof Error ? error.message : String(error)}`;
}
app.setPath("userData", dataDir);

const log: Logger = createLogger(dataDirError ? null : dataDir);
const appDir = app.getAppPath();
const serverDir = resolveServerDir(appDir);

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      codeCache: true,
      corsEnabled: false,
      allowServiceWorkers: false,
      bypassCSP: false,
    },
  },
]);
app.enableSandbox();

/* ------------------------------------------------------------------ state */

type ServerState = "idle" | "starting" | "ready" | "failed" | "stopped-unexpectedly" | "stopping";

interface StatusView {
  readonly kind: "starting" | "failed" | "server-stopped" | "window-crashed";
  readonly title: string;
  readonly message: string;
  readonly detail?: string;
  readonly actions: readonly ShellAction[];
}

const state = {
  server: null as ServerLaunch | null,
  serverState: "idle" as ServerState,
  lastServerExit: null as { code: number; at: string } | null,
  startupError: null as { kind: string; message: string } | null,
  booting: false,
  serverStopRequested: false,
  workspace: null as BrowserWindow | null,
  closeGuard: null as CloseGuard | null,
  status: null as BrowserWindow | null,
  notice: null as BrowserWindow | null,
  secondInstanceCount: 0,
  blockedRequests: 0,
  refusedBridgeCalls: 0,
};

const roles = new Map<number, WindowRole>();
const workspaceSenders = new Set<number>();
const shellOffers = new Map<number, Set<ShellAction>>();

/** Read-only lifecycle snapshot for diagnostics and the desktop E2E suite.
 * Lives in the privileged process only; the launch token is never included. */
(globalThis as Record<string, unknown>).__voltlineDesktop = Object.freeze({
  snapshot: () => ({
    appOrigin: APP_ORIGIN,
    dataDir,
    serverDir,
    appDir,
    logFile: log.file,
    serverState: state.serverState,
    server: state.server
      ? { pid: state.server.pid, port: state.server.target.port, launchId: state.server.target.launchId }
      : null,
    lastServerExit: state.lastServerExit,
    startupError: state.startupError,
    closeGuard: state.closeGuard?.current ?? null,
    secondInstanceCount: state.secondInstanceCount,
    blockedRequests: state.blockedRequests,
    refusedBridgeCalls: state.refusedBridgeCalls,
    workspaceWebContentsId: state.workspace && !state.workspace.isDestroyed() ? state.workspace.webContents.id : null,
    statusWebContentsId: state.status && !state.status.isDestroyed() ? state.status.webContents.id : null,
    noticeWebContentsId: state.notice && !state.notice.isDestroyed() ? state.notice.webContents.id : null,
  }),
});

/* ------------------------------------------------------ single instance */

const hasLock = parsed.ok && app.requestSingleInstanceLock({ dataDir });
if (parsed.ok && !hasLock) {
  // Another Voltline already owns this data directory; it focuses itself.
  log.info(`another instance owns ${dataDir}; handing over`);
  app.quit();
}

app.on("second-instance", () => {
  state.secondInstanceCount += 1;
  log.info("second launch for this data directory; focusing the existing window");
  const target = [state.notice, state.workspace, state.status].find((win) => win && !win.isDestroyed());
  if (target) {
    if (target.isMinimized()) target.restore();
    target.show();
    target.focus();
  }
});

/* ------------------------------------------------------------ shell pages */

const SHELL_FILES: Record<string, { file: string; type: string }> = {
  "/status.html": { file: "status.html", type: "text/html; charset=utf-8" },
  "/status.css": { file: "status.css", type: "text/css; charset=utf-8" },
  "/status.js": { file: "status.js", type: "text/javascript; charset=utf-8" },
};

function serveShellFile(pathname: string): Response {
  const entry = SHELL_FILES[pathname];
  if (!entry) return textResponse(404, "Not found", "This Voltline page does not exist.");
  try {
    const body = fs.readFileSync(path.join(appDir, "shell", entry.file));
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": entry.type,
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'none'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    });
  } catch {
    return textResponse(500, "Voltline files are incomplete", "Reinstall Voltline.");
  }
}

function statusUrl(view: StatusView): string {
  const query = new URLSearchParams({
    kind: view.kind,
    title: view.title,
    message: view.message,
    detail: (view.detail ?? "").slice(-4_000),
    actions: view.actions.join(","),
  });
  return `${SHELL_ORIGIN}/status.html?${query.toString()}`;
}

function presentShell(slot: "status" | "notice", view: StatusView): void {
  let win = state[slot];
  if (!win || win.isDestroyed()) {
    const parent = slot === "notice" && state.workspace && !state.workspace.isDestroyed() ? state.workspace : undefined;
    win = new BrowserWindow({
      width: 600,
      height: slot === "status" ? 420 : 380,
      show: false,
      resizable: true,
      minimizable: slot === "status",
      title: APP_NAME,
      backgroundColor: "#f3f5f7",
      parent,
      webPreferences: {
        preload: path.join(appDir, "shell-preload.js"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
      },
    });
    const id = win.webContents.id;
    roles.set(id, "shell");
    win.on("closed", () => {
      roles.delete(id);
      shellOffers.delete(id);
      if (state[slot] === win) state[slot] = null;
    });
    win.once("ready-to-show", () => win?.show());
    state[slot] = win;
  }
  shellOffers.set(win.webContents.id, new Set(view.actions));
  void win.loadURL(statusUrl(view)).catch((error) => log.warn(`status page did not load: ${String(error)}`));
  if (win.isVisible()) win.focus();
}

function closeShell(slot: "status" | "notice"): void {
  const win = state[slot];
  if (win && !win.isDestroyed()) win.close();
  state[slot] = null;
}

function failureView(error: unknown): StatusView {
  const detail = error instanceof StartupError ? error.detail : error instanceof Error ? error.stack ?? error.message : String(error);
  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: "failed",
    title: "Voltline could not start",
    message,
    detail: [detail, log.file ? `Log file: ${log.file}` : ""].filter(Boolean).join("\n\n"),
    actions: ["retry", "quit"],
  };
}

/* ------------------------------------------------------------ the server */

async function startServerProcess(): Promise<void> {
  state.serverState = "starting";
  state.startupError = null;
  try {
    const launch = await launchServer({ serverDir, timeoutMs: options.startupTimeoutMs, port: options.serverPort, log });
    state.server = launch;
    state.serverState = "ready";
    launch.onExit((exit) => onServerExit(launch, exit));
  } catch (error) {
    state.serverState = "failed";
    state.startupError = {
      kind: error instanceof StartupError ? error.kind : "unknown",
      message: error instanceof Error ? error.message : String(error),
    };
    log.error(`server startup failed: ${state.startupError.message}`);
    throw error;
  }
}

function onServerExit(launch: ServerLaunch, exit: ServerExit): void {
  if (exit.expected || state.server !== launch) return;
  state.server = null;
  state.serverState = "stopped-unexpectedly";
  state.lastServerExit = { code: exit.code, at: new Date().toISOString() };
  log.error(`server stopped unexpectedly with exit code ${exit.code}`);
  const view: StatusView = {
    kind: "server-stopped",
    title: "Voltline's local server stopped",
    message:
      `It exited unexpectedly (exit code ${exit.code}). Changes that were already saved are stored on this computer. ` +
      "Restart the local server before opening another page or project.",
    detail: [exit.output.split("\n").slice(-12).join("\n"), log.file ? `Log file: ${log.file}` : ""].filter(Boolean).join("\n\n"),
    actions: ["restart-server", "quit"],
  };
  presentShell(state.workspace && !state.workspace.isDestroyed() ? "notice" : "status", view);
}

async function restartServer(): Promise<void> {
  if (state.serverState === "starting" || state.serverState === "ready") return;
  presentShell("notice", { kind: "starting", title: "Restarting Voltline's local server…", message: "", actions: [] });
  try {
    await startServerProcess();
    closeShell("notice");
  } catch (error) {
    presentShell("notice", { ...failureView(error), title: "The local server could not restart", actions: ["restart-server", "quit"] });
  }
}

async function stopServer(): Promise<void> {
  const launch = state.server;
  state.serverStopRequested = true;
  if (!launch) return;
  state.serverState = "stopping";
  await launch.stop();
  state.server = null;
  state.serverState = "idle";
}

/* --------------------------------------------------------- the workspace */

async function askAboutUnsavedChanges(win: BrowserWindow): Promise<CloseChoice> {
  const choices: CloseChoice[] = ["wait", "keep-editing", "discard"];
  const result = await dialog.showMessageBox(win, {
    type: "warning",
    title: "Unsaved changes",
    message: "Voltline has not confirmed that all changes are saved.",
    detail:
      "A save is still running or a save failed. If you close now, unsaved edits may be lost.\n\n" +
      "Choose Wait and Try Again to give the save more time, or Keep Editing to stay in the project " +
      "(for example, to export a backup first).",
    buttons: ["Wait and Try Again", "Keep Editing", "Close Without Saving"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  return choices[result.response] ?? "keep-editing";
}

function openWorkspace(): Promise<void> {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: APP_NAME,
    backgroundColor: "#f3f5f7",
    icon: process.platform === "linux" ? path.join(appDir, "icon.png") : undefined,
    webPreferences: {
      preload: path.join(appDir, "preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: true,
    },
  });
  const contents = win.webContents;
  const id = contents.id;
  roles.set(id, "workspace");
  workspaceSenders.add(id);
  state.workspace = win;

  const guard = new CloseGuard(
    {
      requestClose: () => {
        if (!win.isDestroyed()) win.close();
      },
      ask: () => askAboutUnsavedChanges(win),
      now: () => Date.now(),
      schedule: (callback, delay) => {
        const timer = setTimeout(callback, delay);
        return () => clearTimeout(timer);
      },
      log: (message) => log.info(message),
    },
    { settleWindowMs: options.closeSettleMs, pollIntervalMs: CLOSE_POLL_INTERVAL_MS }
  );
  state.closeGuard = guard;
  contents.on("will-prevent-unload", (event) => {
    if (guard.onUnloadBlocked()) event.preventDefault();
  });
  win.on("closed", () => {
    guard.dispose();
    roles.delete(id);
    workspaceSenders.delete(id);
    if (state.workspace === win) state.workspace = null;
    closeShell("notice");
  });
  contents.on("render-process-gone", (_event, details) => {
    log.error(`workspace renderer gone: ${details.reason} (exit code ${details.exitCode})`);
    if (details.reason === "clean-exit" || win.isDestroyed()) return;
    presentShell("notice", {
      kind: "window-crashed",
      title: "The Voltline window stopped unexpectedly",
      message: `Reason: ${details.reason}. Changes that were already saved are stored on this computer; edits that were still unsaved may be lost.`,
      actions: ["reload-window", "quit"],
    });
  });

  return new Promise<void>((resolve, reject) => {
    let shown = false;
    win.once("ready-to-show", () => {
      shown = true;
      win.show();
      closeShell("status");
      resolve();
    });
    contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3 /* ERR_ABORTED: superseded navigation */) return;
      log.error(`workspace failed to load ${urlOrigin(validatedURL) ?? "?"}: ${errorDescription} (${errorCode})`);
      if (!shown) {
        win.destroy();
        reject(new StartupError("handshake", "The Voltline workspace page could not be loaded.", `${errorDescription} (${errorCode})`));
      }
    });
    win.loadURL(`${APP_ORIGIN}/`).catch((error) => log.warn(`workspace load: ${String(error)}`));
  });
}

async function boot(): Promise<void> {
  if (state.booting) return;
  state.booting = true;
  presentShell("status", {
    kind: "starting",
    title: "Starting Voltline…",
    message: "Preparing your local workspace.",
    actions: [],
  });
  try {
    if (dataDirError) throw new StartupError("payload-missing", "Voltline cannot use its data folder.", dataDirError);
    await startServerProcess();
    await openWorkspace();
  } catch (error) {
    presentShell("status", failureView(error));
  } finally {
    state.booting = false;
  }
}

/* -------------------------------------------------------- session policy */

function installSessionPolicy(): void {
  const ses = session.defaultSession;

  ses.protocol.handle(APP_SCHEME, async (request) => {
    let host: string;
    let pathname: string;
    try {
      const url = new URL(request.url);
      host = url.host;
      pathname = url.pathname;
    } catch {
      return textResponse(400, "Bad request", "The address is not valid.");
    }
    if (host === SHELL_HOST) return serveShellFile(pathname);
    if (host !== APP_HOST) return textResponse(404, "Not found", "This Voltline address does not exist.");
    const launch = state.server;
    if (!launch) {
      return textResponse(
        503,
        "Voltline's local server is not running",
        "Changes that were already saved are stored on this computer. Restart the local server from the notice window, or quit and reopen Voltline."
      );
    }
    return proxyToServer(request, launch.target);
  });

  // Renderers talk only to the privileged scheme. A direct http(s) request —
  // to the internet or to the loopback server's port — is cancelled.
  ses.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*", "ftp://*/*"] },
    (details, callback) => {
      state.blockedRequests += 1;
      log.warn(`blocked renderer network request to ${urlOrigin(details.url) ?? "an invalid URL"}`);
      callback({ cancel: true });
    }
  );

  ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(isPermissionAllowed(permission, details.requestingUrl));
  });
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    isPermissionAllowed(permission, requestingOrigin)
  );
  ses.setDevicePermissionHandler(() => false);
}

app.on("web-contents-created", (_event, contents: WebContents) => {
  contents.setWindowOpenHandler(({ url }) => {
    log.warn(`refused to open a new window for ${urlOrigin(url) ?? "an invalid URL"}`);
    return { action: "deny" };
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("will-frame-navigate", (details) => {
    const role = roles.get(contents.id);
    const allowed = role
      ? details.isMainFrame
        ? isNavigationAllowed(role, details.url)
        : isSubframeNavigationAllowed(role, details.url)
      : false;
    if (!allowed) {
      log.warn(`blocked navigation to ${urlOrigin(details.url) ?? details.url.split(":")[0]}`);
      details.preventDefault();
    }
  });
  contents.on("will-redirect", (details) => {
    const role = roles.get(contents.id);
    if (details.isMainFrame && (!role || !isNavigationAllowed(role, details.url))) details.preventDefault();
  });
});

/* -------------------------------------------------------------------- IPC */

function gateEventFrom(event: IpcMainInvokeEvent): GateEvent {
  let senderFrame: GateEvent["senderFrame"] = null;
  try {
    const frame = event.senderFrame;
    senderFrame = frame ? { url: frame.url, parent: frame.parent } : null;
  } catch {
    senderFrame = null;
  }
  return { sender: { id: event.sender.id }, senderFrame };
}

function installIpc(): void {
  ipcMain.handle(IPC_CHANNEL, async (event, message: unknown) => {
    const decision = gateIpcMessage(gateEventFrom(event), message, workspaceSenders);
    if (!decision.ok) {
      state.refusedBridgeCalls += 1;
      log.warn(`bridge call refused: ${decision.response.error.code}`);
      return decision.response;
    }
    return dispatchIpc(decision.request, { appVersion: app.getVersion() });
  });

  ipcMain.handle(SHELL_IPC_CHANNEL, async (event, message: unknown) => {
    const gate = gateEventFrom(event);
    const offered = shellOffers.get(gate.sender.id);
    const action = (message as { action?: unknown } | null)?.action;
    if (
      roles.get(gate.sender.id) !== "shell" ||
      !gate.senderFrame ||
      gate.senderFrame.parent !== null ||
      urlOrigin(gate.senderFrame.url) !== SHELL_ORIGIN ||
      typeof action !== "string" ||
      !SHELL_ACTIONS.has(action as ShellAction) ||
      !offered?.has(action as ShellAction)
    ) {
      log.warn("status page action refused");
      return false;
    }
    log.info(`status page action: ${action}`);
    switch (action as ShellAction) {
      case "retry":
        void boot();
        return true;
      case "quit":
        app.quit();
        return true;
      case "restart-server":
        void restartServer();
        return true;
      case "reload-window":
        closeShell("notice");
        state.workspace?.webContents.reload();
        return true;
      case "dismiss":
        closeShell("notice");
        return true;
    }
    return false;
  });
}

/* ------------------------------------------------------------ app events */

app.on("window-all-closed", () => {
  app.quit();
});

app.on("will-quit", (event) => {
  if (state.server && !state.serverStopRequested) {
    event.preventDefault();
    void stopServer().finally(() => app.quit());
  }
});

if (parsed.ok && hasLock) {
  app
    .whenReady()
    .then(() => {
      log.info(
        `Voltline ${app.getVersion()} starting; Electron ${process.versions.electron}, Node ${process.versions.node}; ` +
          `data ${dataDir}; server payload ${serverDir}`
      );
      Menu.setApplicationMenu(null);
      installSessionPolicy();
      installIpc();
      return boot();
    })
    .catch((error) => {
      log.error(`fatal startup error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      dialog.showErrorBox("Voltline could not start", error instanceof Error ? error.message : String(error));
      app.exit(1);
    });
}
