// Global test setup for the dashboard vitest workspace.
//
// 1. jest-dom matchers (`toBeInTheDocument`, …).
// 2. `afterEach(cleanup)` unmounts RTL trees between tests.
// 3. A controllable mock `EventSource` — jsdom ships none, yet both `sse.ts`
//    and `project-context.tsx` open one on mount. The mock records every
//    instance on `MockEventSource.instances`, lets a test fire `onopen` /
//    `onerror` and dispatch named messages, and resets between tests.

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

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

afterEach(() => {
  cleanup();
  MockEventSource.reset();
});
