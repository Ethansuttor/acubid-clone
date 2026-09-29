/**
 * Desktop identity constants shared by the main process, both preloads and
 * the status pages. Dependency-free on purpose: sandboxed preloads cannot
 * load Node modules, so anything they import must be plain values.
 */

/**
 * The renderer never sees the loopback server's port. It loads
 * `voltline://app/…`, a privileged standard scheme that the main process
 * proxies to whichever port this launch's server bound. IndexedDB, Web Locks
 * and localStorage are keyed by this origin, so it must never change between
 * releases: changing it makes every existing workspace look empty.
 */
export const APP_SCHEME = "voltline";
export const APP_HOST = "app";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** Local status pages (startup, failure, server stopped). A separate origin,
 * so they share no storage with the workspace. */
export const SHELL_HOST = "shell";
export const SHELL_ORIGIN = `${APP_SCHEME}://${SHELL_HOST}`;

/** Separate from the C1 bridge channel; only shell status pages may use it. */
export const SHELL_IPC_CHANNEL = "voltline.shell.v1";
export const SHELL_GLOBAL = "voltlineShell";

/** Actions a status page may request. The main process also checks that the
 * action is offered by the page that asked. */
export type ShellAction = "retry" | "quit" | "restart-server" | "reload-window" | "dismiss";
export const SHELL_ACTIONS: ReadonlySet<ShellAction> = new Set<ShellAction>([
  "retry",
  "quit",
  "restart-server",
  "reload-window",
  "dismiss",
]);
