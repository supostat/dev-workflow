import { expect } from "./fixtures/dashboard-server";
import type { NetworkRecorder } from "./network";
import type { Page } from "@playwright/test";

// Shared route table + page-interaction helpers for the dashboard smoke specs.
//
// NEVER `waitForLoadState("networkidle")` — the dashboard holds open SSE
// EventSource streams (`/events/*`), so the network never goes idle. Routes
// settle with `waitForLoadState("load")` + a fixed pause; the hang gate reads
// the recorder's `pendingNonSse()` instead.

/** Fixed pause after `load` letting client fetches + SSE connects settle. */
export const SETTLE_MS = 2000;

/** Upper bound on `expect.poll` waits for non-SSE traffic to go quiescent. */
export const QUIESCENCE_TIMEOUT_MS = 5000;

/**
 * The single project-scoped SSE endpoint the dashboard opens — the
 * multiplexed `/events/stream` carries every topic on one connection per
 * browser tab. It 400s without a `?project=` query parameter.
 */
export const PROJECT_SCOPED_SSE: ReadonlySet<string> = new Set([
  "/events/stream",
]);

/** A navbar route: its URL path and exact text unique to its loaded content. */
export interface RouteAnchor {
  /** Path component (with the `trailingSlash` the static export emits). */
  path: string;
  /** Exact visible text present only on this route's loaded view. */
  anchor: string;
}

/** The six navbar routes with a distinctive text anchor for each. */
export const ROUTES: ReadonlyArray<RouteAnchor> = [
  { path: "/", anchor: "Project" },
  { path: "/vault/", anchor: "Stack" },
  { path: "/tasks/", anchor: "New task" },
  { path: "/workflow/", anchor: "Workflow runs" },
  { path: "/engram/", anchor: "Recent memories" },
  { path: "/settings/", anchor: "Migration lock" },
];

/** Loading notices a route shows before its data resolves — never a pass state. */
export const LOADING_NOTICES: ReadonlyArray<string> = [
  "Loading overview…",
  "Loading engram stats…",
  "Loading settings…",
  "Loading project…",
];

/** Open `path` on the dashboard, wait for `load`, and let fetches settle. */
export async function openRoute(page: Page, baseURL: string, path: string): Promise<void> {
  await page.goto(`${baseURL}${path}`);
  await page.waitForLoadState("load");
  await page.waitForTimeout(SETTLE_MS);
}

/**
 * Locate a route anchor by its exact visible text. Exact matching is required:
 * the Overview anchor "Project" is a substring of the Settings "Projects"
 * panel, and "Workflow" appears in the navbar — substring matching would let
 * those collide and defeat the cross-route distinctness assertion.
 */
export function anchorLocator(page: Page, anchor: string) {
  return page.getByText(anchor, { exact: true });
}

/** Assert the page is not stuck on any pre-data loading notice. */
export async function expectNotLoadingStuck(page: Page): Promise<void> {
  for (const notice of LOADING_NOTICES) {
    await expect(page.getByText(notice)).toHaveCount(0);
  }
}

/**
 * Quiescence-aware bad-response gate. A bare `toEqual([])` is a point-in-time
 * snapshot — a 4xx still in flight when the assertion runs escapes it. This
 * polls until non-SSE traffic settles, THEN asserts no 4xx/5xx and no
 * network-layer failures were observed across the whole session.
 */
export async function expectCleanTraffic(recorder: NetworkRecorder): Promise<void> {
  await expect
    .poll(() => recorder.pendingNonSse().length, { timeout: QUIESCENCE_TIMEOUT_MS })
    .toBe(0);
  expect(recorder.badResponses).toEqual([]);
  expect(recorder.failedNonSse).toEqual([]);
}

/** Build a URL matcher accepting `path` with or without its trailing slash. */
export function routeUrlPattern(path: string): RegExp {
  const withoutSlash = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
  return new RegExp(`${withoutSlash.replace(/\//g, "\\/")}\\/?$`);
}

/** Map a route path to its navbar link label. */
export function navLabel(path: string): string {
  const labels: Record<string, string> = {
    "/vault/": "Vault",
    "/tasks/": "Tasks",
    "/workflow/": "Workflow",
    "/engram/": "Engram",
    "/settings/": "Settings",
  };
  const label = labels[path];
  if (label === undefined) throw new Error(`no navbar label for ${path}`);
  return label;
}
