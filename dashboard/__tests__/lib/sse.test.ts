// Tests for `useEventSource` — driven through the mock `EventSource` installed
// globally by `vitest.setup.ts`. Covers connect, topic delivery, the
// `connected` flag, reconnect backoff with the cap, ping filtering, cleanup on
// unmount, and the disabled `null`-url path.

import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { eventSourceUrl, useEventSource } from "@/lib/sse";
import { MockEventSource } from "../../vitest.setup";

describe("useEventSource", () => {
  it("does not connect when the url is null", () => {
    const { result } = renderHook(() => useEventSource(null, "vault", () => {}));
    expect(MockEventSource.instances).toHaveLength(0);
    expect(result.current.connected).toBe(false);
  });

  it("opens a connection and flips connected on open", () => {
    const { result } = renderHook(() => useEventSource("/events/vault", "vault", () => {}));
    expect(MockEventSource.instances).toHaveLength(1);
    act(() => MockEventSource.last?.onopen?.());
    expect(result.current.connected).toBe(true);
  });

  it("delivers only the subscribed topic to onEvent", () => {
    const onEvent = vi.fn();
    renderHook(() => useEventSource("/events/vault", "vault", onEvent));
    act(() => MockEventSource.last?.emit("vault", "knowledge.md"));
    expect(onEvent).toHaveBeenCalledWith("knowledge.md");
  });

  it("does not surface the ping heartbeat to onEvent", () => {
    const onEvent = vi.fn();
    renderHook(() => useEventSource("/events/vault", "vault", onEvent));
    act(() => MockEventSource.last?.emit("ping", ""));
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("reconnects after an error with capped backoff", () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useEventSource("/events/vault", "vault", () => {}));
      act(() => MockEventSource.last?.onerror?.());
      expect(MockEventSource.instances).toHaveLength(1);
      act(() => vi.advanceTimersByTime(1_000));
      expect(MockEventSource.instances).toHaveLength(2);
      // Second failure → backoff doubled to 2s.
      act(() => MockEventSource.last?.onerror?.());
      act(() => vi.advanceTimersByTime(1_999));
      expect(MockEventSource.instances).toHaveLength(2);
      act(() => vi.advanceTimersByTime(1));
      expect(MockEventSource.instances).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("saturates the backoff at the 30s cap and never exceeds it", () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useEventSource("/events/vault", "vault", () => {}));
      // Backoff doubles each failure: 1s, 2s, 4s, 8s, 16s, then the 30s cap.
      const delays = [1_000, 2_000, 4_000, 8_000, 16_000];
      let expectedInstances = 1;
      for (const delay of delays) {
        act(() => MockEventSource.last?.onerror?.());
        act(() => vi.advanceTimersByTime(delay));
        expectedInstances += 1;
        expect(MockEventSource.instances).toHaveLength(expectedInstances);
      }
      // Next failure: backoff would be 32s uncapped — capped to 30s.
      act(() => MockEventSource.last?.onerror?.());
      act(() => vi.advanceTimersByTime(29_999));
      expect(MockEventSource.instances).toHaveLength(expectedInstances);
      act(() => vi.advanceTimersByTime(1));
      expectedInstances += 1;
      expect(MockEventSource.instances).toHaveLength(expectedInstances);
      // A further failure stays pinned at the 30s cap — it does not grow.
      act(() => MockEventSource.last?.onerror?.());
      act(() => vi.advanceTimersByTime(30_000));
      expectedInstances += 1;
      expect(MockEventSource.instances).toHaveLength(expectedInstances);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets backoff on a clean reopen", () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useEventSource("/events/vault", "vault", () => {}));
      act(() => MockEventSource.last?.onerror?.());
      act(() => vi.advanceTimersByTime(1_000));
      act(() => MockEventSource.last?.onopen?.());
      act(() => MockEventSource.last?.onerror?.());
      // Backoff was reset to 1s by onopen — a 1s wait reconnects again.
      act(() => vi.advanceTimersByTime(1_000));
      expect(MockEventSource.instances).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes the connection on unmount", () => {
    const { unmount } = renderHook(() => useEventSource("/events/vault", "vault", () => {}));
    const source = MockEventSource.last;
    unmount();
    expect(source?.closed).toBe(true);
  });
});

describe("eventSourceUrl", () => {
  it("returns null when no project is resolved", () => {
    expect(eventSourceUrl("runs", null)).toBeNull();
  });

  it("appends the project query parameter for a topic", () => {
    expect(eventSourceUrl("vault", "demo")).toBe("/events/vault?project=demo");
  });

  it("merges extra params after the project", () => {
    const url = eventSourceUrl("trace", "demo", { runId: "run-aaaaaaaaaaaa" });
    expect(url).not.toBeNull();
    expect(url).toContain("/events/trace?");
    expect(url).toContain("project=demo");
    expect(url).toContain("runId=run-aaaaaaaaaaaa");
  });

  it("returns null for the trace topic when no runId is supplied", () => {
    expect(eventSourceUrl("trace", "demo")).toBeNull();
    expect(eventSourceUrl("trace", "demo", {})).toBeNull();
    expect(eventSourceUrl("trace", "demo", { runId: "" })).toBeNull();
  });

  it("percent-encodes a project name with reserved characters", () => {
    const url = eventSourceUrl("vault", "my project");
    expect(url).not.toBeNull();
    expect(new URL(url ?? "", "http://localhost").searchParams.get("project")).toBe("my project");
  });

  it("drives the opened EventSource URL with the project query parameter", () => {
    renderHook(() => useEventSource(eventSourceUrl("vault", "demo"), "vault", () => {}));
    expect(MockEventSource.last?.url).toBe("/events/vault?project=demo");
  });

  it("opens a trace stream carrying both project and runId", () => {
    renderHook(() =>
      useEventSource(
        eventSourceUrl("trace", "demo", { runId: "run-aaaaaaaaaaaa" }),
        "trace",
        () => {},
      ),
    );
    const url = MockEventSource.last?.url ?? "";
    expect(url).toContain("/events/trace?");
    expect(url).toContain("project=demo");
    expect(url).toContain("runId=run-aaaaaaaaaaaa");
  });
});
