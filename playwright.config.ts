import { defineConfig } from "@playwright/test";

// End-to-end smoke harness for the `dev-workflow web` dashboard.
//
// No `webServer` block: each test boots its OWN real `dev-workflow web` CLI
// subprocess via the test-scoped `dashboard` fixture
// (e2e/fixtures/dashboard-server.ts), against a hermetic temp project with an
// isolated registry. A fresh subprocess per test is deliberate — the web
// server rate-limits `/api/*` to 60 requests/minute per client IP, and the
// full suite issues well past 60 from one `127.0.0.1` browser; a per-test
// subprocess gives each test its own rate-limit bucket.
//
// Serial execution (`fullyParallel: false`, `workers: 1`): the per-test
// subprocesses must run one at a time so the rate-limit serialisation holds —
// parallel workers would still issue overlapping `/api/*` traffic from the
// same client IP and exhaust a shared budget across concurrently booted
// servers.
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    headless: true,
    browserName: "chromium",
  },
});
