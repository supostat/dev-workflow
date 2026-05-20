// Cross-page jsdom smoke test (no Playwright).
//
// Every dashboard page component is mounted in turn inside `<ProjectProvider>`
// behind a catch-all `fetch` mock that answers every `/api/*` route with a
// minimal valid body — each page must reach a rendered state without throwing.
//
// Three behavioural guards beyond the smoke nav:
//  - AC#8 viewport guard — a sub-1024px window shows the desktop-only CTA.
//  - AC#10 SSE reconnect — an `onerror` plus a fake-timer advance past the 1s
//    backoff constructs a fresh `MockEventSource`.
//  - AC#7 theme persistence — a toggled theme survives a `ThemeProvider` remount.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { createElement, type ComponentType } from "react";
import { MockEventSource } from "../../vitest.setup";

// `RunsTable` (inside the Workflow page) calls `useRouter().push`; jsdom has no
// App Router context, so `next/navigation` is mocked for every page mount.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  // jsdom ships no `matchMedia`; `next-themes` queries it on mount for the
  // system-theme listener. A minimal non-matching stub is enough for the test.
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }
});

/** JSON `fetch` response helper. */
function ok(body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

const ENGRAM_STATS = {
  scope: { runCount: 0, vaultPath: "/p", cutoffISO: null },
  byMethod: {},
  byMemoryType: {},
  byStep: {},
  recentRuns: [],
  warnings: [],
  live: { health: null, topMemories: [] },
  crossRunReuse: { total: 0, reused: 0, percent: 0 },
  perStepHitRate: {},
  missingStepComplete: { totalRuns: 0, affectedRuns: [], count: 0 },
};

/** Catch-all `fetch` mock answering every `/api/*` route with a minimal body. */
function stubAllRoutes(): void {
  const fetchMock = vi.fn((input: string) => {
    if (input.startsWith("/api/projects/active")) {
      return ok({ activeProject: { name: "demo", path: "/p", lastSeen: "" } });
    }
    if (input.startsWith("/api/projects")) return ok({ projects: [], activeProject: "demo" });
    if (input.startsWith("/api/vault")) return ok({ section: "stack", content: "" });
    if (input.startsWith("/api/tasks")) return ok({ tasks: [] });
    if (input.startsWith("/api/workflow/runs")) return ok({ runs: [] });
    if (input.startsWith("/api/engram/stats")) return ok(ENGRAM_STATS);
    if (input.startsWith("/api/engram/health")) return ok({ healthy: true, status: {} });
    if (input.startsWith("/api/settings")) {
      return ok({
        activeProfile: "default",
        availableProfiles: ["default"],
        defaultProfile: "default",
        lockFilePresent: false,
        lock: null,
      });
    }
    return ok({});
  });
  vi.stubGlobal("fetch", fetchMock);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

describe("cross-page navigation smoke", () => {
  it("mounts every dashboard page without throwing", async () => {
    stubAllRoutes();
    const [{ ProjectProvider }, pages] = await Promise.all([
      import("@/lib/project-context"),
      Promise.all([
        import("@/app/page"),
        import("@/app/vault/page"),
        import("@/app/tasks/page"),
        import("@/app/workflow/page"),
        import("@/app/engram/page"),
        import("@/app/settings/page"),
      ]),
    ]);
    for (const module of pages) {
      const Page = module.default as ComponentType;
      const view = render(
        createElement(ProjectProvider, null, createElement(Page)),
      );
      await waitFor(() => expect(view.container.firstChild).not.toBeNull());
      cleanup();
    }
  });
});

describe("ViewportGuard (AC#8)", () => {
  it("shows the desktop-only CTA below the 1024px breakpoint", async () => {
    const { ViewportGuard } = await import("@/components/layout/ViewportGuard");
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(800);
    render(createElement(ViewportGuard, null, createElement("p", null, "app body")));
    expect(await screen.findByText("Desktop browser required")).toBeInTheDocument();
    expect(screen.queryByText("app body")).not.toBeInTheDocument();
  });
});

describe("SSE reconnect (AC#10)", () => {
  it("constructs a fresh EventSource after an error past the 1s backoff", async () => {
    vi.useFakeTimers();
    const { sseHub } = await import("@/lib/sse-hub");
    sseHub.setProject("demo");
    expect(MockEventSource.instances).toHaveLength(1);

    const first = MockEventSource.last;
    first?.onerror?.();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(MockEventSource.instances.length).toBeGreaterThan(1);
    expect(MockEventSource.last).not.toBe(first);
    sseHub.setProject(null);
  });
});

describe("theme persistence (AC#7)", () => {
  it("keeps a toggled theme across a ThemeProvider remount", async () => {
    const { ThemeProvider } = await import("@/components/theme-provider");
    const child = createElement("span", null, "themed");

    const first = render(
      createElement(
        ThemeProvider,
        { attribute: "class", defaultTheme: "system", enableSystem: true, storageKey: "theme" },
        child,
      ),
    );
    await waitFor(() => expect(first.container.textContent).toContain("themed"));
    localStorage.setItem("theme", "dark");
    cleanup();

    const second = render(
      createElement(
        ThemeProvider,
        { attribute: "class", defaultTheme: "system", enableSystem: true, storageKey: "theme" },
        child,
      ),
    );
    await waitFor(() => expect(second.container.textContent).toContain("themed"));
    expect(localStorage.getItem("theme")).toBe("dark");
  });
});
