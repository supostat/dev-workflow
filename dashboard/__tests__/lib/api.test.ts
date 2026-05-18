// Contract tests for the REST wrappers in `lib/api.ts`. `fetch` is stubbed so
// each wrapper's path, method, query string, and body are asserted against
// the task-055 server contract — plus the happy / non-2xx-JSON /
// non-2xx-non-JSON response paths of the shared `request` core.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getProjects,
  createProject,
  getActiveProject,
  putActiveProject,
  getVaultSection,
  patchVaultSection,
  searchVault,
  getTasks,
  getTask,
  createTask,
  patchTask,
  getWorkflowRuns,
  getWorkflowRun,
  getEngramStats,
  getEngramHealth,
  getSettings,
  patchCommunication,
  putProfile,
} from "@/lib/api";

/** Install a `fetch` stub that resolves to the given status + JSON body. */
function stubFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "Stubbed",
    text: () => Promise.resolve(JSON.stringify(body)),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Install a `fetch` stub whose body is not valid JSON. */
function stubFetchRaw(raw: string, status: number): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: "Server Error",
    text: () => Promise.resolve(raw),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The path string passed to the most recent `fetch` call. */
function calledPath(fetchMock: ReturnType<typeof vi.fn>): string {
  return fetchMock.mock.calls[0]?.[0] as string;
}

/** The `RequestInit` passed to the most recent `fetch` call. */
function calledInit(fetchMock: ReturnType<typeof vi.fn>): RequestInit {
  return (fetchMock.mock.calls[0]?.[1] ?? {}) as RequestInit;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("projects wrappers (no project query)", () => {
  it("getProjects hits /api/projects with no query", async () => {
    const fetchMock = stubFetch({ projects: [], activeProject: null });
    await getProjects();
    expect(calledPath(fetchMock)).toBe("/api/projects");
  });

  it("createProject POSTs the path", async () => {
    const fetchMock = stubFetch({ name: "p", path: "/p", lastSeen: "" }, 201);
    await createProject("/abs/path");
    expect(calledPath(fetchMock)).toBe("/api/projects");
    expect(calledInit(fetchMock).method).toBe("POST");
    expect(calledInit(fetchMock).body).toBe(JSON.stringify({ path: "/abs/path" }));
  });

  it("getActiveProject hits /api/projects/active", async () => {
    const fetchMock = stubFetch({ activeProject: null });
    await getActiveProject();
    expect(calledPath(fetchMock)).toBe("/api/projects/active");
  });

  it("putActiveProject PUTs the name", async () => {
    const fetchMock = stubFetch({ activeProject: "demo" });
    const result = await putActiveProject("demo");
    expect(calledInit(fetchMock).method).toBe("PUT");
    expect(calledInit(fetchMock).body).toBe(JSON.stringify({ name: "demo" }));
    expect(result.activeProject).toBe("demo");
  });
});

describe("vault wrappers (project-scoped)", () => {
  it("getVaultSection injects ?project=", async () => {
    const fetchMock = stubFetch({ section: "stack", content: "x" });
    await getVaultSection("demo", "stack");
    expect(calledPath(fetchMock)).toBe("/api/vault/stack?project=demo");
  });

  it("patchVaultSection PATCHes the content", async () => {
    const fetchMock = stubFetch({ section: "stack", backupPath: "/b" });
    await patchVaultSection("demo", "stack", "new");
    expect(calledPath(fetchMock)).toBe("/api/vault/stack?project=demo");
    expect(calledInit(fetchMock).method).toBe("PATCH");
    expect(calledInit(fetchMock).body).toBe(JSON.stringify({ content: "new" }));
  });

  it("searchVault encodes project and q", async () => {
    const fetchMock = stubFetch({ matches: [] });
    await searchVault("demo", "foo bar");
    expect(calledPath(fetchMock)).toBe("/api/vault/search?project=demo&q=foo+bar");
  });
});

describe("task wrappers", () => {
  it("getTasks appends status and priority filters", async () => {
    const fetchMock = stubFetch({ tasks: [] });
    await getTasks("demo", { status: "done", priority: "high" });
    expect(calledPath(fetchMock)).toBe("/api/tasks?project=demo&status=done&priority=high");
  });

  it("getTasks omits undefined filters", async () => {
    const fetchMock = stubFetch({ tasks: [] });
    await getTasks("demo");
    expect(calledPath(fetchMock)).toBe("/api/tasks?project=demo");
  });

  it("getTask hits /api/tasks/:id", async () => {
    const fetchMock = stubFetch({ id: "task-001" });
    await getTask("demo", "task-001");
    expect(calledPath(fetchMock)).toBe("/api/tasks/task-001?project=demo");
  });

  it("createTask POSTs the title and description", async () => {
    const fetchMock = stubFetch({ id: "task-002" }, 201);
    await createTask("demo", { title: "t", description: "d" });
    expect(calledInit(fetchMock).method).toBe("POST");
    expect(calledInit(fetchMock).body).toBe(JSON.stringify({ title: "t", description: "d" }));
  });

  it("patchTask PATCHes the status", async () => {
    const fetchMock = stubFetch({ id: "task-003" });
    await patchTask("demo", "task-003", { status: "in-progress" });
    expect(calledInit(fetchMock).method).toBe("PATCH");
    expect(calledInit(fetchMock).body).toBe(JSON.stringify({ status: "in-progress" }));
  });
});

describe("workflow wrappers", () => {
  it("getWorkflowRuns appends the status filter", async () => {
    const fetchMock = stubFetch({ runs: [] });
    await getWorkflowRuns("demo", "running");
    expect(calledPath(fetchMock)).toBe("/api/workflow/runs?project=demo&status=running");
  });

  it("getWorkflowRun hits /api/workflow/runs/:id", async () => {
    const fetchMock = stubFetch({ id: "run-abc123abc123" });
    await getWorkflowRun("demo", "run-abc123abc123");
    expect(calledPath(fetchMock)).toBe("/api/workflow/runs/run-abc123abc123?project=demo");
  });
});

describe("engram wrappers", () => {
  it("getEngramStats appends the runs window", async () => {
    const fetchMock = stubFetch({ scope: {} });
    await getEngramStats("demo", 25);
    expect(calledPath(fetchMock)).toBe("/api/engram/stats?project=demo&runs=25");
  });

  it("getEngramHealth hits /api/engram/health", async () => {
    const fetchMock = stubFetch({ healthy: true, status: null });
    await getEngramHealth("demo");
    expect(calledPath(fetchMock)).toBe("/api/engram/health?project=demo");
  });
});

describe("settings wrappers", () => {
  it("getSettings injects ?project=", async () => {
    const fetchMock = stubFetch({ activeProfile: null });
    await getSettings("demo");
    expect(calledPath(fetchMock)).toBe("/api/settings?project=demo");
  });

  it("patchCommunication PATCHes the content", async () => {
    const fetchMock = stubFetch({ written: true });
    await patchCommunication("demo", "yaml:");
    expect(calledPath(fetchMock)).toBe("/api/settings/communication?project=demo");
    expect(calledInit(fetchMock).method).toBe("PATCH");
  });

  it("putProfile PUTs the profile", async () => {
    const fetchMock = stubFetch({ activeProfile: "senior_fast" });
    await putProfile("demo", "senior_fast");
    expect(calledInit(fetchMock).method).toBe("PUT");
    expect(calledInit(fetchMock).body).toBe(JSON.stringify({ profile: "senior_fast" }));
  });
});

describe("request error handling", () => {
  it("happy path parses the JSON body", async () => {
    stubFetch({ projects: [{ name: "p", path: "/p", lastSeen: "", active: true }], activeProject: "p" });
    const result = await getProjects();
    expect(result.activeProject).toBe("p");
  });

  it("non-2xx with {error} throws the server message", async () => {
    stubFetch({ error: "unknown project: ghost" }, 400);
    const error = await getProjects().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("unknown project: ghost");
  });

  it("non-2xx with non-JSON body throws the status line", async () => {
    stubFetchRaw("<html>500</html>", 500);
    const error = await getProjects().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("500 Server Error");
  });
});
