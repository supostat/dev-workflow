// Global test setup for the dashboard vitest workspace.
//
// 1. jest-dom matchers (`toBeInTheDocument`, …).
// 2. `afterEach(cleanup)` unmounts RTL trees between tests.
// 3. A controllable mock `EventSource` — jsdom ships none, yet both `sse.ts`
//    and `project-context.tsx` open one on mount. The mock records every
//    instance on `MockEventSource.instances`, lets a test fire `onopen` /
//    `onerror` and dispatch named messages, and resets between tests.
// 4. A no-op `ResizeObserver` — jsdom ships none, yet the radix `Switch`
//    primitive (`react-use-size`) constructs one on mount.

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { sseHub } from "@/lib/sse-hub";

/** A single SSE message delivered to a named-event listener. */
interface MockEvent {
  data: string;
}

type MockEventListener = (event: MockEvent) => void;

/**
 * Stand-in for the browser `EventSource`. Construction registers the instance
 * so tests can drive its lifecycle; `close()` flips `closed` for assertions.
 */
export class MockEventSource {
  static instances: MockEventSource[] = [];

  static reset(): void {
    MockEventSource.instances = [];
  }

  /** The most recently constructed, still-open instance, or null. */
  static get last(): MockEventSource | null {
    return MockEventSource.instances.at(-1) ?? null;
  }

  readonly url: string;
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly listeners = new Map<string, MockEventListener>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: MockEventListener): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string): void {
    this.listeners.delete(type);
  }

  close(): void {
    this.closed = true;
  }

  /** Test helper — deliver a named-topic message to the registered listener. */
  emit(type: string, data: string): void {
    this.listeners.get(type)?.({ data });
  }
}

(globalThis as { EventSource: unknown }).EventSource = MockEventSource;

/** No-op `ResizeObserver` — jsdom ships none; the radix `Switch` needs one. */
class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

(globalThis as { ResizeObserver: unknown }).ResizeObserver = MockResizeObserver;

afterEach(() => {
  cleanup();
  // Close any active multiplexed EventSource and cancel pending retry timers
  // — the `sseHub` singleton persists across cases, so without this teardown
  // a stray open connection leaks `MockEventSource.instances` counts into
  // the next test and makes them non-deterministic.
  sseHub.setProject(null);
  MockEventSource.reset();
});
