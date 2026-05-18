// Tests for the active-project context. `fetch` is stubbed; the mock
// `EventSource` from `vitest.setup.ts` covers the `/events/projects` stream.
// Covers: the active project loads on mount, `setActiveProject` PUTs and
// updates, `useApi()` flips its `{ ready }` discriminant, an SSE event
// triggers a re-fetch, and `useActiveProject` throws outside the provider.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ProjectProvider, useActiveProject, useApi } from "@/lib/project-context";
import { MockEventSource } from "../../vitest.setup";

/** Stub `fetch` so `/api/projects/active` and the PUT both resolve. */
function stubProjectFetch(activeName: string | null): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const body =
      init?.method === "PUT"
        ? { activeProject: "switched" }
        : { activeProject: activeName === null ? null : { name: activeName, path: "/p", lastSeen: "" } };
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: "OK",
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Wrap a hook under test in `ProjectProvider`. */
function wrapper({ children }: { children: ReactNode }) {
  return <ProjectProvider>{children}</ProjectProvider>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProjectProvider", () => {
  it("loads the active project on mount", async () => {
    stubProjectFetch("demo");
    const { result } = renderHook(() => useActiveProject(), { wrapper });
    await waitFor(() => expect(result.current.activeProject).toBe("demo"));
    expect(result.current.loading).toBe(false);
  });

  it("setActiveProject PUTs and updates the active project", async () => {
    const fetchMock = stubProjectFetch("demo");
    const { result } = renderHook(() => useActiveProject(), { wrapper });
    await waitFor(() => expect(result.current.activeProject).toBe("demo"));
    await act(() => result.current.setActiveProject("other"));
    expect(result.current.activeProject).toBe("other");
    const putCall = fetchMock.mock.calls.find((call) => (call[1] as RequestInit)?.method === "PUT");
    expect(putCall?.[0]).toBe("/api/projects/active");
  });

  it("re-fetches when the projects SSE topic fires", async () => {
    const fetchMock = stubProjectFetch("demo");
    renderHook(() => useActiveProject(), { wrapper });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const callsBefore = fetchMock.mock.calls.length;
    act(() => MockEventSource.last?.emit("projects", "switched"));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("settles loading and surfaces the error when the mount fetch rejects", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useActiveProject(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.activeProject).toBeNull();
    expect(result.current.error).toBe("network down");
  });
});

describe("useApi", () => {
  it("is not ready before the active project resolves, ready after", async () => {
    stubProjectFetch("demo");
    const { result } = renderHook(() => useApi(), { wrapper });
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    if (result.current.ready) {
      expect(typeof result.current.api.getTasks).toBe("function");
    }
  });

  it("stays not-ready when no project is active", async () => {
    stubProjectFetch(null);
    const { result } = renderHook(() => useApi(), { wrapper });
    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0));
    expect(result.current.ready).toBe(false);
  });
});

describe("useActiveProject outside a provider", () => {
  it("throws a descriptive error", () => {
    expect(() => renderHook(() => useActiveProject())).toThrow(
      "useActiveProject must be used within a ProjectProvider",
    );
  });
});
