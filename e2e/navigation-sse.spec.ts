import { test, expect } from "./fixtures/dashboard-server";
import { recordNetwork } from "./network";
import {
  PROJECT_SCOPED_SSE,
  ROUTES,
  anchorLocator,
  expectCleanTraffic,
  navLabel,
  openRoute,
  routeUrlPattern,
  SETTLE_MS,
} from "./smoke-helpers";
import type { RouteAnchor } from "./smoke-helpers";
import type { Page } from "@playwright/test";

// Navigation, SSE, hang, and cold-start checks for the `dev-workflow web`
// dashboard. The `dashboard` fixture boots the real CLI subprocess against a
// scaffolded project; the `emptyDashboard` fixture boots it against a non-
// project directory with an empty registry — the genuine v3.0.0 cold start.

/** The scaffolded fixture run id — see `scaffoldFixtureProject`. */
const FIXTURE_RUN_ID = "run-aaaaaaaaaaaa";

test("navbar navigation walks every route", async ({ page, dashboard }) => {
  const recorder = recordNetwork(page);
  await openRoute(page, dashboard.baseURL, "/");
  await expect(anchorLocator(page, "Project").first()).toBeVisible();

  const walk: ReadonlyArray<RouteAnchor> = ROUTES.slice(1);
  let previous = ROUTES[0];
  for (const route of walk) {
    const label = navLabel(route.path);
    await page.getByRole("link", { name: label, exact: true }).click();
    // Client-side routing may settle the URL with or without the export's
    // trailing slash; accept both rather than glob-matching one form.
    await page.waitForURL(routeUrlPattern(route.path));
    await page.waitForLoadState("load");
    await page.waitForTimeout(SETTLE_MS);

    await expect(anchorLocator(page, route.anchor).first()).toBeVisible();
    await expect(anchorLocator(page, previous.anchor)).toHaveCount(0);
    previous = route;
  }

  await expectCleanTraffic(recorder);
});

/** Select the scaffolded run in the Engram `TraceTailPanel` run picker. */
async function selectTraceRun(page: Page): Promise<void> {
  await page.getByRole("combobox", { name: "Select run" }).click();
  await page.getByRole("option", { name: FIXTURE_RUN_ID }).click();
  await page.waitForTimeout(SETTLE_MS);
}

test("the multiplexed SSE stream answers 200 with no 400 flood", async ({ page, dashboard }) => {
  const recorder = recordNetwork(page);
  const sseRoutes = ["/", "/workflow/", "/engram/"];
  for (const path of sseRoutes) {
    await openRoute(page, dashboard.baseURL, path);
  }
  // On `/engram/`, picking a run no longer triggers a new SSE connection —
  // the dashboard already holds the single multiplexed `/events/stream` that
  // carries every topic. Selecting a run exercises the client-side runId
  // filter inside `TraceTail` rather than opening a fresh EventSource.
  await selectTraceRun(page);

  expect(recorder.sseResponses.length).toBeGreaterThan(0);
  for (const sse of recorder.sseResponses) {
    expect(sse.status, `SSE ${sse.url}`).toBe(200);
  }

  const endpointHits = new Map<string, number>();
  for (const sse of recorder.sseResponses) {
    const url = new URL(sse.url);
    expect(url.pathname).toBe("/events/stream");
    expect(PROJECT_SCOPED_SSE.has(url.pathname)).toBe(true);
    expect(url.searchParams.get("project"), `SSE ${sse.url} project param`).toBe(
      dashboard.projectName,
    );
    endpointHits.set(url.pathname, (endpointHits.get(url.pathname) ?? 0) + 1);
  }

  // Exactly one connection per browser session under the multiplex contract.
  // One extra is tolerated for a legitimate reconnect window. The pre-
  // multiplex implementation opened ~4 separate EventSources here and would
  // blow well past `connectCeiling`.
  const connectCeiling = 2;
  for (const [endpoint, hits] of endpointHits) {
    expect(hits, `SSE endpoint ${endpoint} connect count`).toBeLessThanOrEqual(connectCeiling);
  }
});

test("no non-SSE request hangs across all routes", async ({ page, dashboard }) => {
  const recorder = recordNetwork(page);
  for (const route of ROUTES) {
    await openRoute(page, dashboard.baseURL, route.path);
  }
  expect(recorder.pendingNonSse()).toEqual([]);
});

test("cold-start auto-registers the launch project", async ({ page, dashboard }) => {
  // `bootProjects` is the `GET /api/projects` payload captured at server boot
  // — the genuine cold-start state, before any spec traffic. Asserting it here
  // (rather than issuing a late call) also dodges the server's 60-req/min rate
  // limiter, whose budget the rest of the suite has already largely spent.
  const { projects, activeProject } = dashboard.bootProjects;
  expect(projects.some((project) => project.name === dashboard.projectName)).toBe(true);
  expect(activeProject).not.toBeNull();

  await openRoute(page, dashboard.baseURL, "/");
  await expect(page.getByText("Loading project…")).toHaveCount(0);
  await expect(anchorLocator(page, "Project").first()).toBeVisible();
});

test("cold-start with an empty registry shows the no-project notice", async ({
  page,
  emptyDashboard,
}) => {
  // The genuine v3.0.0 hang: the CLI launched outside any project, the registry
  // empty, nothing to auto-register. The dashboard must settle on the
  // actionable `no-project` notice, never hang on "Loading project…".
  expect(emptyDashboard.bootProjects.projects).toEqual([]);
  expect(emptyDashboard.bootProjects.activeProject).toBeNull();

  await openRoute(page, emptyDashboard.baseURL, "/");
  await expect(page.getByText("Loading project…")).toHaveCount(0);
  await expect(
    page.getByText("No project registered.", { exact: false }),
  ).toBeVisible();
});
