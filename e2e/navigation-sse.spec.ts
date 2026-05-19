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

test("SSE streams answer 200 with no 400 flood", async ({ page, dashboard }) => {
  const recorder = recordNetwork(page);
  const sseRoutes = ["/", "/workflow/", "/engram/"];
  for (const path of sseRoutes) {
    await openRoute(page, dashboard.baseURL, path);
  }
  // On `/engram/`, `TraceTailPanel` mounts with no run selected, so the trace
  // URL stays null and `/events/trace` never opens. Pick the scaffolded run so
  // the project-scoped trace subscription is actually exercised.
  await selectTraceRun(page);

  expect(recorder.sseResponses.length).toBeGreaterThan(0);
  for (const sse of recorder.sseResponses) {
    expect(sse.status, `SSE ${sse.url}`).toBe(200);
  }

  const topicHits = new Map<string, number>();
  for (const sse of recorder.sseResponses) {
    const url = new URL(sse.url);
    // `vault`/`runs`/`trace` are project-scoped and 400 without `?project=`;
    // `/events/projects` is the global registry topic and carries no project.
    if (PROJECT_SCOPED_SSE.has(url.pathname)) {
      expect(url.searchParams.get("project"), `SSE ${sse.url} project param`).toBe(
        dashboard.projectName,
      );
    }
    // The trace topic additionally carries the picked run id.
    if (url.pathname === "/events/trace") {
      expect(url.searchParams.get("runId"), `SSE ${sse.url} runId param`).toBe(
        FIXTURE_RUN_ID,
      );
    }
    topicHits.set(url.pathname, (topicHits.get(url.pathname) ?? 0) + 1);
  }

  // A regression dropping a subscription entirely would still pass a bare
  // length check — assert the expected topic SET is present. `/events/projects`
  // is opened by `ProjectProvider` on every route; `vault`/`runs` by Overview;
  // `trace` once a run is picked on `/engram/`.
  const observedTopics = new Set(topicHits.keys());
  for (const topic of ["/events/vault", "/events/runs", "/events/trace", "/events/projects"]) {
    expect(observedTopics.has(topic), `SSE topic ${topic} never opened`).toBe(true);
  }

  // Each full navigation re-mounts the topic's owner and legitimately
  // re-connects once; one extra reconnect is tolerated. A 400 loop reconnects
  // many times per page load and blows well past this ceiling.
  const connectCeiling = sseRoutes.length + 1;
  for (const [topic, hits] of topicHits) {
    expect(hits, `SSE topic ${topic} connect count`).toBeLessThanOrEqual(connectCeiling);
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
