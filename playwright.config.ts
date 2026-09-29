import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const knownChromiumPaths = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  "/opt/pw-browsers/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter((path): path is string => !!path);

const executablePath = knownChromiumPaths.find(existsSync);

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
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
    command: "npx next dev -p 3000",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
