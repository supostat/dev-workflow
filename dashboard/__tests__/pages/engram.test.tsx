// Page test for the Engram route — KPI cards and the four charts render from
// a mock `EngramStatsResponse`, an empty `perStepHitRate` shows the "No data"
// fallback, the run picker resolves a trace URL so `TraceTail` mounts an
// EventSource, a rejected `getEngramStats` shows the error panel, and the 30s
// health interval issues a second `getEngramHealth` fetch under fake timers.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import EngramPage from "@/app/engram/page";
import { ProjectProvider } from "@/lib/project-context";
import { MockEventSource } from "../../vitest.setup";
import type { EngramStatsResponse } from "@/lib/api";

// Radix `Select` queries pointer-capture and scrolls items into view — jsdom
// ships neither, so both are stubbed before any test opens the run picker.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

const STATS: EngramStatsResponse = {
  scope: { runCount: 4, vaultPath: "/p", cutoffISO: null },
  byMethod: {
    memory_search: { count: 7, errors: 0, avgDurationMs: 12 },
    memory_store: { count: 3, errors: 1, avgDurationMs: 9 },
  },
  byMemoryType: { pattern: 4, antipattern: 1 },
  byStep: { code: { search: 2, store: 3, judge: 1 } },
  recentRuns: [
    {
      id: "run-aaaaaaaaaaaa",
      workflowName: "dev",
      status: "completed",
      startedAt: "2026-05-01T00:00:00.000Z",
      completedAt: "2026-05-01T01:00:00.000Z",
      durationMs: 3600000,
      stepCount: 6,
      completedSteps: 6,
      telemetry: null,
      hasTrace: true,
    },
  ],
  warnings: [],
  live: {
    health: null,
    topMemories: [
      {
        id: "mem-1",
        memory_type: "pattern",
        context: "Reuse the generation guard",
        action: "applied",
        result: "ok",
        score: 0.9,
        tags: "code",
        project: "demo",
      },
    ],
  },
  crossRunReuse: { total: 10, reused: 6, percent: 60 },
  perStepHitRate: { code: { searches: 10, nonEmpty: 7, percent: 70 } },
  missingStepComplete: { totalRuns: 4, affectedRuns: [], count: 2 },
};

/** JSON `fetch` response helper. */
function ok(body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

/** Error `fetch` response helper. */
function fail(message: string): Promise<Response> {
  return Promise.resolve({
    ok: false,
    status: 500,
    statusText: "Error",
    text: () => Promise.resolve(JSON.stringify({ error: message })),
  } as Response);
}

/** Route `fetch` for the Engram page; overrides customise stats/health. */
function stubEngramFetch(overrides?: {
  stats?: () => Promise<Response>;
  health?: () => Promise<Response>;
}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: string) => {
    if (input.startsWith("/api/projects/active")) {
      return ok({ activeProject: { name: "demo", path: "/p", lastSeen: "" } });
    }
    if (input.startsWith("/api/engram/stats")) {
      return overrides?.stats ? overrides.stats() : ok(STATS);
    }
    if (input.startsWith("/api/engram/health")) {
      return overrides?.health ? overrides.health() : ok({ healthy: true, status: {} });
    }
    return ok({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Render the Engram page inside the project provider. */
function renderEngram(): void {
  render(<ProjectProvider><EngramPage /></ProjectProvider> as ReactNode);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("EngramPage", () => {
  it("renders the KPI cards from the stats payload", async () => {
    stubEngramFetch();
    renderEngram();
    expect(await screen.findByText("Runs analysed")).toBeInTheDocument();
    expect(screen.getByText("Stored memories")).toBeInTheDocument();
    // Stored memories = sum of byMemoryType (4 + 1).
    expect(screen.getByText("5")).toBeInTheDocument();
    // Pending judgments = missingStepComplete.count.
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders the four charts and the recent memory", async () => {
    stubEngramFetch();
    renderEngram();
    expect(await screen.findByText("Calls by method")).toBeInTheDocument();
    expect(screen.getByText("Memories by type")).toBeInTheDocument();
    expect(screen.getByText("Hit rate by step")).toBeInTheDocument();
    expect(screen.getByText("Activity by step")).toBeInTheDocument();
    expect(screen.getByText("Reuse the generation guard")).toBeInTheDocument();
  });

  it("shows the No-data fallback when perStepHitRate is empty", async () => {
    stubEngramFetch({ stats: () => ok({ ...STATS, perStepHitRate: {} }) });
    renderEngram();
    await screen.findByText("Hit rate by step");
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("mounts a trace EventSource when a run is picked", async () => {
    stubEngramFetch();
    renderEngram();
    await screen.findByText("Live trace");
    await userEvent.click(screen.getByRole("combobox", { name: "Select run" }));
    await userEvent.click(await screen.findByRole("option", { name: "run-aaaaaaaaaaaa" }));
    await waitFor(() =>
      expect(
        MockEventSource.instances.some(
          (source) =>
            source.url.includes("/events/trace?") &&
            source.url.includes("runId=run-aaaaaaaaaaaa"),
        ),
      ).toBe(true),
    );
  });

  it("shows the error panel with Retry when the stats fetch fails", async () => {
    let attempt = 0;
    stubEngramFetch({
      stats: () => {
        attempt += 1;
        return attempt === 1 ? fail("engram offline") : ok(STATS);
      },
    });
    renderEngram();
    expect(await screen.findByText("engram offline")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Calls by method")).toBeInTheDocument();
  });

  it("re-fetches engram health on the 30s interval", async () => {
    vi.useFakeTimers();
    let healthFetches = 0;
    const fetchMock = vi.fn((input: string) => {
      if (input.startsWith("/api/projects/active")) {
        return ok({ activeProject: { name: "demo", path: "/p", lastSeen: "" } });
      }
      if (input.startsWith("/api/engram/health")) {
        healthFetches += 1;
        return ok({ healthy: true, status: {} });
      }
      return ok(STATS);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderEngram();
    await vi.waitFor(() => expect(healthFetches).toBe(1));

    await vi.advanceTimersByTimeAsync(30_000);
    expect(healthFetches).toBe(2);
  });
});
