// Playwright configuration for the packaged-desktop suite (track D2).
//
//   npm run desktop:build          stage out/desktop/Voltline (needed once)
//   npm run test:desktop           run e2e-desktop/**
//
// Distinct from playwright.config.ts on purpose: this suite launches the
// staged Electron app through Playwright's `_electron`, never a dev server or
// port 3000, and every launch gets its own scratch data directory.
//
// Chromium refuses to run as root without --no-sandbox. Run the suite as an
// ordinary user so the real sandbox is exercised (see e2e-desktop/README notes
// in .ai/handoffs/D1-D2.md). Only when that is impossible, set
// VOLTLINE_E2E_NO_SANDBOX=1: the launcher then adds --no-sandbox, and the
// OS-sandbox assertion is skipped and reported as not verified.

import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";

export default defineConfig({
  testDir: "e2e-desktop",
  testMatch: /.*\.spec\.ts$/,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  // Not ./test-results: the suite may run as a different user than the one
  // that owns the checkout.
  outputDir: path.join(os.tmpdir(), `voltline-desktop-e2e-${process.getuid?.() ?? "user"}`, "results"),
});
