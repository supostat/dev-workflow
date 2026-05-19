import { test, expect } from "./fixtures/dashboard-server";
import { recordNetwork } from "./network";
import {
  ROUTES,
  anchorLocator,
  expectNotLoadingStuck,
  expectCleanTraffic,
  openRoute,
} from "./smoke-helpers";
import type { Page } from "@playwright/test";

// Per-route smoke checks for the `dev-workflow web` dashboard.
//
// Drives headless Chromium across the six navbar routes against the real CLI
// subprocess booted by the `dashboard` fixture. Each route must render its own
// distinct content (no foreign anchors), surface real scaffolded data — not
// just a Panel title a crashed content area could leave standing — and produce
// zero 4xx/5xx, no console errors, and no network-layer request failures.

/** The scaffolded fixture run id — see `scaffoldFixtureProject`. */
const FIXTURE_RUN_ID = "run-aaaaaaaaaaaa";

/**
 * Assert a route renders real data content, not only its Panel title — a
 * render crash inside the content area can be swallowed by a Next error
 * boundary while the parent Panel title stays visible.
 */
async function expectRouteContent(page: Page, path: string): Promise<void> {
  if (path === "/") {
    // Overview KPI strip — a labelled metric card, not just the "Project" title.
    await expect(page.getByText("Pending tasks", { exact: true })).toBeVisible();
    return;
  }
  if (path === "/workflow/") {
    // The scaffolded run row must be present in the runs table.
    await expect(page.getByText(FIXTURE_RUN_ID, { exact: true })).toBeVisible();
    return;
  }
  if (path === "/tasks/") {
    // The scaffolded task must be present in the tasks table.
    await expect(page.getByText("First task", { exact: true })).toBeVisible();
  }
}

test.describe("dashboard route smoke", () => {
  for (const route of ROUTES) {
    test(`route ${route.path} renders its distinct content`, async ({ page, dashboard }) => {
      const recorder = recordNetwork(page);
      await openRoute(page, dashboard.baseURL, route.path);

      await expect(anchorLocator(page, route.anchor).first()).toBeVisible();
      await expectNotLoadingStuck(page);
      await expectRouteContent(page, route.path);

      // Cross-route distinctness — EVERY other route's anchor must be absent,
      // catching any single-page-fallback regression symmetrically.
      for (const foreign of ROUTES) {
        if (foreign.path === route.path) continue;
        await expect(
          anchorLocator(page, foreign.anchor),
          `foreign anchor "${foreign.anchor}" leaked onto ${route.path}`,
        ).toHaveCount(0);
      }

      await expectCleanTraffic(recorder);
      expect(recorder.consoleErrors).toEqual([]);
    });
  }
});
