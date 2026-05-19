// Component test for the run-detail view (`/workflow/run/?id=run-XXX`). Mounts
// `RunDetail` through its route page (so the real `ProjectProvider`/`useApi`
// resolve against a stubbed `fetch`) and asserts the four id-dependent render
// states: no `?id=`, a malformed-id rejection, a generic rejection with Retry,
// and the loaded tabbed detail whose Trace tab opens the trace SSE stream.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import RunDetailPage from "@/app/workflow/run/page";
import { ProjectProvider } from "@/lib/project-context";
import { MockEventSource } from "../../../vitest.setup";
import type { ApiWorkflowRunDetail } from "@/lib/api";

// Radix `Tabs` queries pointer-capture in jsdom — stub it before any test
// opens a tab; `scrollIntoView` is stubbed for the same jsdom gap.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

// `RunDetail` reads `?id=` via `useSearchParams()`; jsdom has no App Router
// context, so `next/navigation` is mocked. `searchParamsMock` is reassigned
// per test to drive the four states.
let searchParamsMock = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock,
  useRouter: () => ({ push: vi.fn() }),
}));

const RUN: ApiWorkflowRunDetail = {
  id: "run-aaaaaaaaaaaa",
  workflowName: "dev",
  taskId: "task-061",
  taskDescription: "Dashboard pages",
  phase: null,
  currentStep: "code",
  startedAt: "2026-05-01T00:00:00.000Z",
  completedAt: null,
  status: "running",
  steps: {
    code: {
      status: "running",
      output: null,
      startedAt: "2026-05-01T00:00:00.000Z",
      completedAt: null,
      durationMs: null,
      attempt: 1,
      engramMemoryId: null,
      error: null,
    },
  },
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

/** Error `fetch` response helper carrying the server `{ error }` body. */
function fail(message: string): Promise<Response> {
  return Promise.resolve({
    ok: false,
    status: 400,
    statusText: "Bad Request",
    text: () => Promise.resolve(JSON.stringify({ error: message })),
  } as Response);
}

/** Route `fetch` for the run-detail page; `runFetch` overrides the run load. */
function stubRunFetch(runFetch?: () => Promise<Response>): void {
  const fetchMock = vi.fn((input: string) => {
    if (input.startsWith("/api/projects/active")) {
      return ok({ activeProject: { name: "demo", path: "/p", lastSeen: "" } });
    }
    if (input.startsWith("/api/workflow/runs/")) {
      return runFetch ? runFetch() : ok(RUN);
    }
    return ok({});
  });
  vi.stubGlobal("fetch", fetchMock);
}

/** Render the run-detail route inside the project provider. */
function renderRunDetail(): void {
  render(<ProjectProvider><RunDetailPage /></ProjectProvider> as ReactNode);
}

afterEach(() => {
  vi.unstubAllGlobals();
  searchParamsMock = new URLSearchParams();
});

describe("RunDetail", () => {
  it("shows the empty state when the route carries no `?id=`", async () => {
    stubRunFetch();
    renderRunDetail();
    expect(await screen.findByText(/No run selected/)).toBeInTheDocument();
  });

  it("shows a distinct malformed-id panel with no Retry button", async () => {
    searchParamsMock = new URLSearchParams("id=not-a-run");
    stubRunFetch(() => fail("invalid run id: not-a-run"));
    renderRunDetail();
    expect(await screen.findByText(/That run id is not valid/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("shows a generic error panel with a working Retry button", async () => {
    searchParamsMock = new URLSearchParams("id=run-aaaaaaaaaaaa");
    let attempt = 0;
    stubRunFetch(() => {
      attempt += 1;
      return attempt === 1 ? fail("trace store unavailable") : ok(RUN);
    });
    renderRunDetail();
    expect(await screen.findByText("trace store unavailable")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Run run-aaaaaaaaaaaa")).toBeInTheDocument();
  });

  it("renders the four tabs and opens the trace SSE stream on the happy path", async () => {
    searchParamsMock = new URLSearchParams("id=run-aaaaaaaaaaaa");
    stubRunFetch();
    renderRunDetail();
    expect(await screen.findByText("Run run-aaaaaaaaaaaa")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Steps" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "JSON" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Trace" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Trace" }));
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
});
