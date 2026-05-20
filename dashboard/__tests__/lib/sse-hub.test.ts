// Lifecycle tests for the `sseHub` singleton. The mock `EventSource` from
// `vitest.setup.ts` records every construction on `MockEventSource.instances`
// and the hub is driven by `setProject` / `subscribe` / underlying onerror
// hooks. Every case calls `sseHub.setProject(null)` in `afterEach` to close
// the active connection and clear pending retry timers — the module-level
// singleton persists across `it()` invocations and a stray open EventSource
// would leak instance counts into the next test.

import { afterEach, describe, expect, it, vi } from "vitest";
import { sseHub } from "@/lib/sse-hub";
import { MockEventSource } from "../../vitest.setup";

afterEach(() => {
  vi.useRealTimers();
  sseHub.setProject(null);
});

describe("sseHub — connection lifecycle", () => {
  it("setProject opens a single multiplexed EventSource at /events/stream", () => {
    sseHub.setProject("demo");
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.last?.url).toBe("/events/stream?project=demo");
  });

  it("setProject(null) closes the active source and reports disconnected", () => {
    sseHub.setProject("demo");
    const source = MockEventSource.last;
    source?.onopen?.();
    expect(sseHub.isConnected()).toBe(true);
    sseHub.setProject(null);
    expect(source?.closed).toBe(true);
    expect(sseHub.isConnected()).toBe(false);
  });

  it("setProject(null) followed by setProject(name) opens a fresh source", () => {
    sseHub.setProject("demo");
    sseHub.setProject(null);
    sseHub.setProject("demo");
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[0]?.closed).toBe(true);
  });

  it("calling setProject with the same value twice is a no-op", () => {
    sseHub.setProject("demo");
    sseHub.setProject("demo");
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("switching projects closes the prior EventSource before opening the next", () => {
    sseHub.setProject("a");
    const first = MockEventSource.last;
    sseHub.setProject("b");
    expect(first?.closed).toBe(true);
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1]?.url).toBe("/events/stream?project=b");
  });

  it("percent-encodes a project name with reserved characters", () => {
    sseHub.setProject("my project");
    expect(MockEventSource.last?.url).toBe("/events/stream?project=my%20project");
  });
});

describe("sseHub — subscription fan-out", () => {
  it("delivers an event to every subscriber on a topic in subscription order", () => {
    const calls: string[] = [];
    sseHub.subscribe("vault", () => calls.push("first"));
    sseHub.subscribe("vault", () => calls.push("second"));
    sseHub.setProject("demo");
    MockEventSource.last?.emit("vault", "knowledge.md");
    expect(calls).toEqual(["first", "second"]);
  });

  it("unsubscribe removes ONLY the named callback; others keep receiving", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = sseHub.subscribe("vault", first);
    sseHub.subscribe("vault", second);
    sseHub.setProject("demo");
    unsubscribeFirst();
    MockEventSource.last?.emit("vault", "knowledge.md");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("knowledge.md");
  });

  it("does not deliver events of other topics to a subscribed topic", () => {
    const onEvent = vi.fn();
    sseHub.subscribe("vault", onEvent);
    sseHub.setProject("demo");
    MockEventSource.last?.emit("runs", "run-aaaaaaaaaaaa");
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("onStatusChange fires on connect and on a subsequent disconnect", () => {
    const listener = vi.fn();
    sseHub.onStatusChange(listener);
    sseHub.setProject("demo");
    MockEventSource.last?.onopen?.();
    expect(listener).toHaveBeenLastCalledWith(true);
    MockEventSource.last?.onerror?.();
    expect(listener).toHaveBeenLastCalledWith(false);
  });
});

describe("sseHub — reconnect backoff", () => {
  it("schedules reconnect at 1s, 2s, 4s, 8s, 16s, then caps at 30s", () => {
    vi.useFakeTimers();
    sseHub.setProject("demo");
    const delays = [1_000, 2_000, 4_000, 8_000, 16_000];
    let expectedInstances = 1;
    for (const delay of delays) {
      MockEventSource.last?.onerror?.();
      vi.advanceTimersByTime(delay);
      expectedInstances += 1;
      expect(MockEventSource.instances).toHaveLength(expectedInstances);
    }
    // Next failure would be 32s uncapped — capped to 30s.
    MockEventSource.last?.onerror?.();
    vi.advanceTimersByTime(29_999);
    expect(MockEventSource.instances).toHaveLength(expectedInstances);
    vi.advanceTimersByTime(1);
    expectedInstances += 1;
    expect(MockEventSource.instances).toHaveLength(expectedInstances);
    // Further failure stays pinned at the 30s cap.
    MockEventSource.last?.onerror?.();
    vi.advanceTimersByTime(30_000);
    expectedInstances += 1;
    expect(MockEventSource.instances).toHaveLength(expectedInstances);
  });

  it("resets backoff on a clean reopen", () => {
    vi.useFakeTimers();
    sseHub.setProject("demo");
    MockEventSource.last?.onerror?.();
    vi.advanceTimersByTime(1_000);
    MockEventSource.last?.onopen?.();
    // Backoff is now reset; the next error should reconnect at 1s, not 2s.
    MockEventSource.last?.onerror?.();
    vi.advanceTimersByTime(1_000);
    expect(MockEventSource.instances).toHaveLength(3);
  });

  it("setProject during a pending reconnect tears down the timer", () => {
    vi.useFakeTimers();
    sseHub.setProject("a");
    MockEventSource.last?.onerror?.();
    // A reconnect is scheduled for project A. Switching to B BEFORE the timer
    // fires must cancel the queued A-targeted reconnect and open B instead.
    const beforeSwitch = MockEventSource.instances.length;
    sseHub.setProject("b");
    expect(MockEventSource.instances).toHaveLength(beforeSwitch + 1);
    expect(MockEventSource.last?.url).toBe("/events/stream?project=b");
    vi.advanceTimersByTime(60_000);
    // Only the B EventSource exists after the timer would have fired —
    // no extra A-targeted construct.
    expect(MockEventSource.instances).toHaveLength(beforeSwitch + 1);
  });
});
