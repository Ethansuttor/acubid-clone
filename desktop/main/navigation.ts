/**
 * URL policy for every webContents the shell creates. Pure functions so the
 * rules are unit tested; index.ts attaches them to Electron events.
 */

import { APP_ORIGIN, SHELL_ORIGIN } from "../shared/constants";

export type WindowRole = "workspace" | "shell";

/**
 * `scheme://host[:port]` for URLs that have an authority, else null.
 *
 * Node's WHATWG URL treats `voltline:` as a non-special scheme and reports
 * its `origin` as "null"; Chromium, where the scheme is registered as
 * standard, reports "voltline://app". Comparing protocol + host gives the
 * same answer in both places.
 */
export function urlOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.host) return null;
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return null;
  }
}

/** Top-level navigation: the workspace stays on the app origin, status pages
 * stay on the shell origin. Everything else — http(s) to the loopback port,
 * file:, data:, javascript:, other schemes — is refused. */
export function isNavigationAllowed(role: WindowRole, url: string): boolean {
  return urlOrigin(url) === (role === "workspace" ? APP_ORIGIN : SHELL_ORIGIN);
}

/** Subframes may additionally be blank (used by print and some libraries). */
export function isSubframeNavigationAllowed(role: WindowRole, url: string): boolean {
  return url === "about:blank" || url === "about:srcdoc" || isNavigationAllowed(role, url);
}

/**
 * Network requests leaving a renderer. Only the privileged scheme and local
 * in-memory schemes are allowed; http(s)/ws(s)/ftp — including a direct
 * request to the loopback server, which would bypass the proxy — are
 * cancelled. Optional AI traffic is designed to leave from the privileged
 * process (D3), not from a renderer.
 */
const BLOCKED_REQUEST_SCHEMES = new Set(["http:", "https:", "ws:", "wss:", "ftp:"]);

export function isRendererRequestBlocked(url: string): boolean {
  try {
    return BLOCKED_REQUEST_SCHEMES.has(new URL(url).protocol);
  } catch {
    return true;
  }
}

/** Permissions the workspace page can use. Everything else is denied, and no
 * permission is granted to any other origin. */
const WORKSPACE_PERMISSIONS = new Set([
  // Keep the IndexedDB preview out of Chromium's best-effort eviction.
  "persistent-storage",
  // Optional recovery-folder mirroring uses the File System Access API; the
  // estimator still picks the folder in a native dialog.
  "fileSystem",
  "clipboard-sanitized-write",
  "fullscreen",
]);

export function isPermissionAllowed(permission: string, requestingUrl: string | null | undefined): boolean {
  if (!requestingUrl || urlOrigin(requestingUrl) !== APP_ORIGIN) return false;
  return WORKSPACE_PERMISSIONS.has(permission);
}
