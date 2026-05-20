// Page test for the Tasks route — table render, search filter, row click into
// the detail Sheet, the new-task create flow, and optimistic-status rollback.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import TasksPage from "@/app/tasks/page";
import { ProjectProvider } from "@/lib/project-context";
import { MockEventSource } from "../../vitest.setup";
import type { ApiTask } from "@/lib/types";

const TASKS: ApiTask[] = [
  { id: "task-010", title: "Build table", status: "pending", priority: "high", branch: "feat/ui", created: "2026-05-01T00:00:00.000Z", updated: "2026-05-05T00:00:00.000Z" },
  { id: "task-011", title: "Wire filters", status: "review", priority: "low", branch: null, created: "2026-05-02T00:00:00.000Z", updated: "2026-05-06T00:00:00.000Z" },
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

/** Route `fetch` for the Tasks page; `onMutate` customises the PATCH/POST result. */
function stubTasksFetch(
  onMutate?: (init: RequestInit) => Promise<Response>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input.startsWith("/api/projects/active")) {
      return ok({ activeProject: { name: "demo", path: "/p", lastSeen: "" } });
    }
    if (init?.method === "POST" || init?.method === "PATCH") {
      return onMutate ? onMutate(init) : ok(TASKS[0]);
    }
    return ok({ tasks: TASKS });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Render the Tasks page inside the project provider. */
function renderTasks(): void {
  render(<ProjectProvider><TasksPage /></ProjectProvider> as ReactNode);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TasksPage", () => {
  it("renders every task row", async () => {
    stubTasksFetch();
    renderTasks();
    expect(await screen.findByText("Build table")).toBeInTheDocument();
    expect(screen.getByText("Wire filters")).toBeInTheDocument();
  });

  it("narrows the table with the search filter", async () => {
    stubTasksFetch();
    renderTasks();
    await screen.findByText("Build table");
    await userEvent.type(screen.getByLabelText("Search tasks"), "filters");
    await waitFor(() => expect(screen.queryByText("Build table")).not.toBeInTheDocument());
    expect(screen.getByText("Wire filters")).toBeInTheDocument();
  });

  it("opens the detail Sheet on a row click", async () => {
    stubTasksFetch();
    renderTasks();
    await userEvent.click(await screen.findByText("Build table"));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("task-010")).toBeInTheDocument();
  });

  it("creates a task and re-fetches the list", async () => {
    const fetchMock = stubTasksFetch();
    renderTasks();
    await screen.findByText("Build table");
    await userEvent.click(screen.getByRole("button", { name: "New task" }));
    await userEvent.type(await screen.findByLabelText("Title"), "Fresh task");
    await userEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) => (call[1] as RequestInit)?.method === "POST"),
      ).toBe(true),
    );
  });

  it("shows the optimistic status then rolls back when the PATCH rejects", async () => {
    // The PATCH rejection is held open so the optimistic intermediate row
    // state is observable before the rollback runs.
    let rejectPatch: (() => void) | undefined;
    stubTasksFetch(
      () =>
        new Promise<Response>((_resolve, reject) => {
          rejectPatch = () => reject(new Error("write denied"));
        }),
    );
    renderTasks();
    await screen.findByText("Build table");
    await userEvent.click(screen.getByLabelText("Status for task-010"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "done" }));

    // Optimistic intermediate state — applied before the PATCH settles.
    expect(screen.getByLabelText("Status for task-010")).toHaveTextContent("done");

    rejectPatch?.();
    await waitFor(() =>
      expect(screen.getByLabelText("Status for task-010")).toHaveTextContent("pending"),
    );
  });

  it("persists the status and re-fetches when the PATCH resolves", async () => {
    // After the PATCH the row status is "done" server-side; the reconcile
    // re-fetch must reflect it, so the list response tracks the patched value.
    let task010Status = "pending";
    let resolvePatch: (() => void) | undefined;
    let listFetches = 0;
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      if (input.startsWith("/api/projects/active")) {
        return ok({ activeProject: { name: "demo", path: "/p", lastSeen: "" } });
      }
      if (init?.method === "PATCH") {
        task010Status = JSON.parse(init.body as string).status;
        return new Promise<Response>((resolve) => {
          resolvePatch = () =>
            resolve({
              ok: true,
              status: 200,
              statusText: "OK",
              text: () => Promise.resolve(JSON.stringify({ ...TASKS[0], status: task010Status })),
            } as Response);
        });
      }
      listFetches += 1;
      return ok({ tasks: [{ ...TASKS[0], status: task010Status }, TASKS[1]] });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderTasks();
    await screen.findByText("Build table");
    const listFetchesBefore = listFetches;
    await userEvent.click(screen.getByLabelText("Status for task-010"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "done" }));

    // Optimistic state applied immediately, before the PATCH resolves.
    expect(screen.getByLabelText("Status for task-010")).toHaveTextContent("done");

    resolvePatch?.();
    // A post-mutation re-fetch reconciles the list with the server.
    await waitFor(() => expect(listFetches).toBeGreaterThan(listFetchesBefore));
    expect(screen.getByLabelText("Status for task-010")).toHaveTextContent("done");
  });

  it("discards a stale task list when the project switched mid-fetch", async () => {
    let activeName = "first";
    let getTasksCalls = 0;
    let releaseFirstList: (() => void) | undefined;
    const fetchMock = vi.fn((input: string) => {
      if (input.startsWith("/api/projects/active")) {
        return ok({ activeProject: { name: activeName, path: "/p", lastSeen: "" } });
      }
      if (input === "/api/projects") {
        return ok({
          projects: [{ name: activeName, path: "/p", lastSeen: "", active: true }],
          activeProject: activeName,
        });
      }
      getTasksCalls += 1;
      if (getTasksCalls === 1) {
        // The first project's list — held open until after the switch.
        return new Promise<Response>((resolve) => {
          releaseFirstList = () =>
            resolve({
              ok: true,
              status: 200,
              statusText: "OK",
              text: () => Promise.resolve(JSON.stringify({ tasks: TASKS })),
            } as Response);
        });
      }
      return ok({
        tasks: [
          { id: "task-099", title: "Other project task", status: "pending", priority: "high", branch: null, created: "2026-05-10T00:00:00.000Z", updated: "2026-05-10T00:00:00.000Z" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProjectProvider><TasksPage /></ProjectProvider> as ReactNode);
    await waitFor(() => expect(getTasksCalls).toBe(1));

    // Switch the active project via the multiplexed `projects` topic — the
    // provider re-fetches the active project and the tasks page bumps its
    // generation counter, then re-fetches the new project's list.
    activeName = "second";
    const stream = MockEventSource.instances.find((source) =>
      source.url.includes("/events/stream"),
    );
    stream?.emit("projects", JSON.stringify({ action: "registry-changed" }));
    await screen.findByText("Other project task");

    // The slow first-project list resolves only now — it must be discarded.
    releaseFirstList?.();
    await waitFor(() => expect(getTasksCalls).toBeGreaterThanOrEqual(2));
    expect(screen.queryByText("Build table")).not.toBeInTheDocument();
    expect(screen.getByText("Other project task")).toBeInTheDocument();
  });
});
