// Page test for the Overview route. `fetch` is routed by URL so the project
// context, the vault gameplan, the task list, and the run list all resolve;
// the mock `EventSource` drives the live-update assertion.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import OverviewPage from "@/app/page";
import { ProjectProvider } from "@/lib/project-context";
import { MockEventSource } from "../../vitest.setup";

const GAMEPLAN = ["---", "updated: 2026-05-10", "current-phase: web-dashboard", "---"].join("\n");

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

/** Route `fetch` by URL across the four endpoints the Overview page hits. */
function stubOverviewFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: string) => {
    if (input.startsWith("/api/projects/active")) {
      return ok({ activeProject: { name: "demo", path: "/p", lastSeen: "" } });
    }
    if (input.startsWith("/api/vault/gameplan")) {
      return ok({ section: "gameplan", content: GAMEPLAN });
    }
    if (input.startsWith("/api/tasks")) {
      return ok({ tasks: [{ id: "task-007", title: "Wire feed", status: "pending", priority: "high", branch: null, created: "2026-05-09T00:00:00.000Z", updated: "2026-05-09T00:00:00.000Z" }] });
    }
    if (input.startsWith("/api/workflow/runs")) {
      return ok({ runs: [{ id: "run-003", workflow: "dev", status: "paused", currentStep: null, startedAt: "2026-05-11T00:00:00.000Z", updatedAt: "2026-05-11T00:00:00.000Z" }] });
    }
    return ok({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Render the Overview page inside the project provider. */
function renderOverview(): void {
  render(<ProjectProvider><OverviewPage /></ProjectProvider> as ReactNode);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OverviewPage", () => {
  it("renders the header, KPI strip, and activity feed", async () => {
    stubOverviewFetch();
    renderOverview();
    expect(await screen.findByText("demo")).toBeInTheDocument();
    expect(screen.getByText("web-dashboard")).toBeInTheDocument();
    expect(screen.getByText("Paused runs")).toBeInTheDocument();
    expect(screen.getByText("Pending tasks")).toBeInTheDocument();
    expect(screen.getByText(/task-007 — Wire feed/)).toBeInTheDocument();
  });

  it("shows the error panel and retries when a feed fetch fails", async () => {
    let gameplanCalls = 0;
    const fetchMock = vi.fn((input: string) => {
      if (input.startsWith("/api/projects/active")) {
        return ok({ activeProject: { name: "demo", path: "/p", lastSeen: "" } });
      }
      if (input.startsWith("/api/vault/gameplan")) {
        gameplanCalls += 1;
        return gameplanCalls === 1 ? fail("vault unreachable") : ok({ section: "gameplan", content: GAMEPLAN });
      }
      if (input.startsWith("/api/tasks")) {
        return ok({ tasks: [] });
      }
      if (input.startsWith("/api/workflow/runs")) {
        return ok({ runs: [] });
      }
      return ok({});
    });
    vi.stubGlobal("fetch", fetchMock);
    renderOverview();
    await screen.findByText("vault unreachable");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("web-dashboard")).toBeInTheDocument();
    expect(screen.queryByText("vault unreachable")).not.toBeInTheDocument();
  });

  it("re-runs the feed fetch when a runs SSE event fires", async () => {
    const fetchMock = stubOverviewFetch();
    renderOverview();
    await screen.findByText("demo");
    const callsBefore = fetchMock.mock.calls.length;
    const runsStream = MockEventSource.instances.find((source) =>
      source.url.includes("/events/runs"),
    );
    runsStream?.emit("runs", "run-003");
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});
