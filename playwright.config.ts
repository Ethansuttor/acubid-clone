import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://localhost:3100",
    viewport: { width: 1440, height: 900 },
    // The remote environment routes outbound HTTPS through a local proxy
    // with its own CA; the browser must use it to reach Supabase.
    proxy: process.env.HTTPS_PROXY
      ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" }
      : undefined,
    ignoreHTTPSErrors: true,
    launchOptions: {
      // Use the environment's pre-installed Chromium build.
      executablePath: "/opt/pw-browsers/chromium",
    },
  },
  webServer: {
    // Local mode: supabase.co egress is blocked in the CI sandbox, so E2E
    // runs against the localStorage-backed data layer (same app code paths).
    command: "NEXT_PUBLIC_LOCAL_MODE=1 npx next dev -p 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
