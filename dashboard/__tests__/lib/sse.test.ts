// Tests for `useSseTopic` — the thin React hook over the shared `sseHub`
// singleton. The hub is driven through the global mock `EventSource` from
// `vitest.setup.ts`. Covers subscription delivery, topic-change re-subscribe,
// shared-connection fan-out, ping filtering, the `connected` reflection, and
// teardown on unmount. Every case resets the singleton via
// `sseHub.setProject(null)` in `afterEach` so state does not leak.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSseTopic } from "@/lib/sse";
import { sseHub } from "@/lib/sse-hub";
import { MockEventSource } from "../../vitest.setup";

afterEach(() => {
  sseHub.setProject(null);
});

describe("useSseTopic", () => {
  it("does not open a connection on its own — the hub does", () => {
    const { result } = renderHook(() => useSseTopic("vault", () => {}));
    expect(MockEventSource.instances).toHaveLength(0);
    expect(result.current.connected).toBe(false);
  });

  it("flips connected once the hub's EventSource opens", () => {
    const { result } = renderHook(() => useSseTopic("vault", () => {}));
    sseHub.setProject("demo");
    expect(MockEventSource.instances).toHaveLength(1);
    act(() => MockEventSource.last?.onopen?.());
    expect(result.current.connected).toBe(true);
  });

  it("delivers only the subscribed topic to onEvent", () => {
    const onEvent = vi.fn();
    renderHook(() => useSseTopic("vault", onEvent));
    sseHub.setProject("demo");
    act(() => MockEventSource.last?.emit("vault", "knowledge.md"));
    expect(onEvent).toHaveBeenCalledWith("knowledge.md");
    onEvent.mockClear();
    act(() => MockEventSource.last?.emit("runs", "run-aaaaaaaaaaaa"));
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not surface the ping heartbeat to onEvent", () => {
    const onEvent = vi.fn();
    renderHook(() => useSseTopic("vault", onEvent));
    sseHub.setProject("demo");
    act(() => MockEventSource.last?.emit("ping", ""));
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("two hooks share one underlying EventSource (multiplex)", () => {
    renderHook(() => useSseTopic("vault", () => {}));
    renderHook(() => useSseTopic("runs", () => {}));
    sseHub.setProject("demo");
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("re-subscribes when the topic prop changes", () => {
    const onEvent = vi.fn();
    let topic: "vault" | "runs" = "vault";
    const { rerender } = renderHook(() => useSseTopic(topic, onEvent));
    sseHub.setProject("demo");
    act(() => MockEventSource.last?.emit("vault", "knowledge.md"));
    expect(onEvent).toHaveBeenCalledWith("knowledge.md");

    onEvent.mockClear();
    topic = "runs";
    rerender();
    // After the topic switch the old subscription must no longer fire.
    act(() => MockEventSource.last?.emit("vault", "stack.md"));
    expect(onEvent).not.toHaveBeenCalled();
    // And the new one must.
    act(() => MockEventSource.last?.emit("runs", "run-aaaaaaaaaaaa"));
    expect(onEvent).toHaveBeenCalledWith("run-aaaaaaaaaaaa");
  });

  it("stops delivering after unmount", () => {
    const onEvent = vi.fn();
    const { unmount } = renderHook(() => useSseTopic("vault", onEvent));
    sseHub.setProject("demo");
    unmount();
    act(() => MockEventSource.last?.emit("vault", "knowledge.md"));
    expect(onEvent).not.toHaveBeenCalled();
  });
});
