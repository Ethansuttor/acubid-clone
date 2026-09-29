import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const knownChromiumPaths = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  "/opt/pw-browsers/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter((path): path is string => !!path);

const executablePath = knownChromiumPaths.find(existsSync);

// Parallel checkouts each need their own dev server. E2E_PORT selects it; with
// an explicit port an already-running server is NOT reused (it may belong to
// another checkout) unless E2E_REUSE_SERVER=1. Without E2E_PORT the historical
// behaviour stands: port 3000, reusing a server you started yourself.
const port = Number(process.env.E2E_PORT ?? 3000);
const reuseExistingServer = process.env.E2E_REUSE_SERVER
  ? process.env.E2E_REUSE_SERVER === "1"
  : process.env.E2E_PORT === undefined;

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
    // Some CI environments route optional external services through an HTTPS
    // proxy. Local app traffic bypasses it.
    proxy: process.env.HTTPS_PROXY
      ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" }
      : undefined,
    ignoreHTTPSErrors: true,
    launchOptions: {
      // Prefer an explicitly configured or already installed browser, then
      // let Playwright fall back to its managed Chromium build.
      executablePath,
    },
  },
  webServer: {
    command: `npx next dev -p ${port}`,
    url: `http://localhost:${port}/login`,
    reuseExistingServer,
    timeout: 120_000,
  },
});
