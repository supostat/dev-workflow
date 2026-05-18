// Component test for `TraceTail`'s defensive trace-line parsing. The viewer
// runs two independent `JSON.parse` calls — the SSE `data` string into a
// `{ line }` envelope, then `line` into an `EngramTraceEvent` — each wrapped
// in try/catch so a malformed payload skips that line rather than crashing.
// A `MAX_LINES` (200) cap drops the oldest rows once the buffer overflows.
// Lines are driven through the mock `EventSource`'s `emit` helper.

import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TraceTail } from "@/components/workflow/TraceTail";
import { MockEventSource } from "../../../vitest.setup";
import type { EngramTraceEvent } from "@/lib/api";

/** A trace event distinguished by its `ts`, for row-identity assertions. */
function buildEvent(ts: string): EngramTraceEvent {
  return {
    ts,
    method: "memory_search",
    params: {},
    ok: true,
    response_summary: `summary-${ts}`,
    duration_ms: 5,
  };
}

/** Wrap one event in the `{ line }` SSE envelope the server emits. */
function envelope(event: EngramTraceEvent): string {
  return JSON.stringify({ line: JSON.stringify(event) });
}

/** Render `TraceTail` and return its single mock `EventSource`. */
function renderTraceTail(): MockEventSource {
  render(<TraceTail url="/events/trace?runId=run-aaaaaaaaaaaa" /> as ReactNode);
  const source = MockEventSource.instances.find((instance) =>
    instance.url.includes("/events/trace"),
  );
  if (source === undefined) throw new Error("TraceTail opened no EventSource");
  return source;
}

/** Deliver one `trace` SSE payload, flushing the resulting React update. */
function emitTrace(source: MockEventSource, data: string): void {
  act(() => source.emit("trace", data));
}

afterEach(() => {
  MockEventSource.reset();
});

describe("TraceTail defensive parser", () => {
  it("skips a payload whose `data` is not JSON", () => {
    const source = renderTraceTail();
    emitTrace(source, "not-json-at-all");
    expect(screen.getByText("Waiting for trace events…")).toBeInTheDocument();
  });

  it("skips a valid envelope whose inner `line` is not JSON", () => {
    const source = renderTraceTail();
    emitTrace(source, JSON.stringify({ line: "{ broken json" }));
    expect(screen.getByText("Waiting for trace events…")).toBeInTheDocument();
  });

  it("renders a trace row for a valid event", () => {
    const source = renderTraceTail();
    emitTrace(source, envelope(buildEvent("2026-05-18T00:00:00.000Z")));
    expect(screen.getByText("summary-2026-05-18T00:00:00.000Z")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for trace events…")).not.toBeInTheDocument();
  });

  it("caps the buffer at 200 lines, dropping the oldest", () => {
    const source = renderTraceTail();
    for (let index = 0; index < 250; index += 1) {
      emitTrace(source, envelope(buildEvent(`event-${index}`)));
    }
    // The first 50 events (0..49) were evicted; 50..249 remain.
    expect(screen.queryByText("summary-event-0")).not.toBeInTheDocument();
    expect(screen.queryByText("summary-event-49")).not.toBeInTheDocument();
    expect(screen.getByText("summary-event-50")).toBeInTheDocument();
    expect(screen.getByText("summary-event-249")).toBeInTheDocument();
  });
});
