// Page test for the Workflow runs route — table render with colour-coded
// status badges, the CLI-hint banner, row-click navigation into the detail
// route, the live `runs` SSE re-fetch, and the error panel + Retry.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import WorkflowPage from "@/app/workflow/page";
import { ProjectProvider } from "@/lib/project-context";
import { MockEventSource } from "../../vitest.setup";
import type { ApiWorkflowRun } from "@/lib/types";

// `RunsTable` calls `useRouter().push` — jsdom has no App Router context, so
// `next/navigation` is mocked. `push` is captured for the navigation assertion.
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const RUNS: ApiWorkflowRun[] = [
  {
    id: "run-aaaaaaaaaaaa",
    workflow: "dev",
    status: "running",
    currentStep: "code",
    startedAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T01:00:00.000Z",
  },
  {
    id: "run-bbbbbbbbbbbb",
    workflow: "review",
    status: "completed",
    currentStep: null,
    startedAt: "2026-05-02T00:00:00.000Z",
    updatedAt: "2026-05-02T01:00:00.000Z",
  },
];

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

/** Route `fetch` for the Workflow page; `runsFetch` overrides the run-list result. */
function stubWorkflowFetch(runsFetch?: () => Promise<Response>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: string) => {
    if (input.startsWith("/api/projects/active")) {
      return ok({ activeProject: { name: "demo", path: "/p", lastSeen: "" } });
    }
    if (input.startsWith("/api/workflow/runs")) {
      return runsFetch ? runsFetch() : ok({ runs: RUNS });
    }
    return ok({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Render the Workflow page inside the project provider. */
function renderWorkflow(): void {
  render(<ProjectProvider><WorkflowPage /></ProjectProvider> as ReactNode);
}

afterEach(() => {
  vi.unstubAllGlobals();
  pushMock.mockReset();
});

describe("WorkflowPage", () => {
  it("renders every run row with a colour-coded status badge", async () => {
    stubWorkflowFetch();
    renderWorkflow();
    expect(await screen.findByText("run-aaaaaaaaaaaa")).toBeInTheDocument();
    expect(screen.getByText("run-bbbbbbbbbbbb")).toBeInTheDocument();
    expect(screen.getByText("running")).toHaveClass("bg-status-running");
    expect(screen.getByText("completed")).toHaveClass("bg-status-done");
  });

  it("shows the CLI-hint banner", async () => {
    stubWorkflowFetch();
    renderWorkflow();
    await screen.findByText("run-aaaaaaaaaaaa");
    expect(screen.getByText("dev-workflow workflow run")).toBeInTheDocument();
  });

  it("navigates to the detail route on a row click", async () => {
    stubWorkflowFetch();
    renderWorkflow();
    await userEvent.click(await screen.findByText("run-aaaaaaaaaaaa"));
    expect(pushMock).toHaveBeenCalledWith("/workflow/run/?id=run-aaaaaaaaaaaa");
  });

  it("re-fetches the run list on a live `runs` SSE event", async () => {
    let runsFetches = 0;
    const fetchMock = vi.fn((input: string) => {
      if (input.startsWith("/api/projects/active")) {
        return ok({ activeProject: { name: "demo", path: "/p", lastSeen: "" } });
      }
      if (input.startsWith("/api/workflow/runs")) {
        runsFetches += 1;
        const visible = runsFetches === 1 ? [RUNS[0]] : RUNS;
        return ok({ runs: visible });
      }
      return ok({});
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWorkflow();
    await screen.findByText("run-aaaaaaaaaaaa");
    expect(screen.queryByText("run-bbbbbbbbbbbb")).not.toBeInTheDocument();

    const runsStream = MockEventSource.instances.find((source) =>
      source.url.includes("/events/runs"),
    );
    runsStream?.emit("runs", JSON.stringify({ runId: "run-bbbbbbbbbbbb" }));

    expect(await screen.findByText("run-bbbbbbbbbbbb")).toBeInTheDocument();
    expect(runsFetches).toBeGreaterThanOrEqual(2);
  });

  it("shows an error panel with Retry when the run-list fetch fails", async () => {
    let attempt = 0;
    stubWorkflowFetch(() => {
      attempt += 1;
      return attempt === 1 ? fail("runs unavailable") : ok({ runs: RUNS });
    });
    renderWorkflow();
    expect(await screen.findByText("runs unavailable")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("run-aaaaaaaaaaaa")).toBeInTheDocument();
  });
});
