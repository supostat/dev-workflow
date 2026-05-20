// Component test for `TraceTail`'s defensive trace-line parsing. The viewer
// runs two independent `JSON.parse` calls — the SSE `data` string into a
// `{runId, line}` envelope, then `line` into an `EngramTraceEvent` — each
// wrapped in try/catch so a malformed payload skips that line rather than
// crashing. The viewer also filters by `runId` client-side: a payload from a
// different run is dropped. A `MAX_LINES` (200) cap drops the oldest rows
// once the buffer overflows. Lines are driven through the mock `EventSource`'s
// `emit` helper via the shared `sseHub`.

import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TraceTail } from "@/components/workflow/TraceTail";
import { sseHub } from "@/lib/sse-hub";
import { MockEventSource } from "../../../vitest.setup";
import type { EngramTraceEvent } from "@/lib/api";

const RUN_ID = "run-aaaaaaaaaaaa";

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

/** Wrap one event in the `{runId, line}` SSE envelope the server emits. */
function envelope(runId: string, event: EngramTraceEvent): string {
  return JSON.stringify({ runId, line: JSON.stringify(event) });
}

/**
 * Render `TraceTail`, open the hub's underlying EventSource, and return it.
 * The hub is the source of truth — the rendered hook subscribes through it
 * and the test emits records on the same mock instance.
 */
function renderTraceTail(runId: string | null = RUN_ID): MockEventSource {
  render(<TraceTail runId={runId} /> as ReactNode);
  sseHub.setProject("demo");
  const source = MockEventSource.last;
  if (source === null) throw new Error("TraceTail opened no EventSource");
  return source;
}

/** Deliver one `trace` SSE payload, flushing the resulting React update. */
function emitTrace(source: MockEventSource, data: string): void {
  act(() => source.emit("trace", data));
}

afterEach(() => {
  sseHub.setProject(null);
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
    emitTrace(source, JSON.stringify({ runId: RUN_ID, line: "{ broken json" }));
    expect(screen.getByText("Waiting for trace events…")).toBeInTheDocument();
  });

  it("renders a trace row for a valid event matching the selected runId", () => {
    const source = renderTraceTail();
    emitTrace(source, envelope(RUN_ID, buildEvent("2026-05-18T00:00:00.000Z")));
    expect(screen.getByText("summary-2026-05-18T00:00:00.000Z")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for trace events…")).not.toBeInTheDocument();
  });

  it("drops a payload whose runId does not match the selected one", () => {
    const source = renderTraceTail();
    emitTrace(source, envelope("run-bbbbbbbbbbbb", buildEvent("2026-05-18T00:00:00.000Z")));
    expect(screen.getByText("Waiting for trace events…")).toBeInTheDocument();
  });

  it("renders nothing when runId is null even for a well-formed payload", () => {
    const source = renderTraceTail(null);
    emitTrace(source, envelope(RUN_ID, buildEvent("2026-05-18T00:00:00.000Z")));
    expect(screen.getByText("Waiting for trace events…")).toBeInTheDocument();
  });

  it("caps the buffer at 200 lines, dropping the oldest", () => {
    const source = renderTraceTail();
    for (let index = 0; index < 250; index += 1) {
      emitTrace(source, envelope(RUN_ID, buildEvent(`event-${index}`)));
    }
    // The first 50 events (0..49) were evicted; 50..249 remain.
    expect(screen.queryByText("summary-event-0")).not.toBeInTheDocument();
    expect(screen.queryByText("summary-event-49")).not.toBeInTheDocument();
    expect(screen.getByText("summary-event-50")).toBeInTheDocument();
    expect(screen.getByText("summary-event-249")).toBeInTheDocument();
  });
});
