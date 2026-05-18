"use client";

// Reusable terminal-style live JSONL viewer for a workflow run's engram trace.
//
// Subscribes to the `trace` SSE topic at `url`; `url` stays `null` until the
// run id is known (the server 400s on a missing runId, so a subscription is
// never opened before the id resolves). Each SSE message carries a
// `{ line: string }` envelope and `line` itself is one `EngramTraceEvent` —
// the two JSON.parse calls are independently wrapped in try/catch so a
// malformed payload skips that line rather than crashing the viewer. The
// rendered buffer is capped at `MAX_LINES` so a long-running stream cannot
// grow the DOM without bound.

import { useCallback, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEventSource } from "@/lib/sse";
import type { EngramTraceEvent } from "@/lib/api";

/** Hard cap on retained trace lines — oldest lines drop off the top. */
const MAX_LINES = 200;

/** One rendered trace row. */
interface TraceLine {
  /** Monotonic key — SSE delivers no stable per-line id. */
  key: number;
  event: EngramTraceEvent;
}

interface TraceTailProps {
  /** `trace` SSE endpoint, or `null` until the run id resolves. */
  url: string | null;
}

/** Live terminal-style viewer of a run's engram trace JSONL. */
export function TraceTail({ url }: TraceTailProps) {
  const [lines, setLines] = useState<TraceLine[]>([]);
  const nextKey = useRef(0);

  const append = useCallback((data: string): void => {
    const event = parseTraceLine(data);
    if (event === null) return;
    setLines((current) => {
      const next = [...current, { key: nextKey.current++, event }];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  const { connected } = useEventSource(url, "trace", append);

  return (
    <div className="rounded-md border border-border bg-[hsl(var(--background))]">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span
          className={`size-2 rounded-full ${connected ? "bg-status-running" : "bg-status-aborted"}`}
          aria-label={connected ? "trace connected" : "trace disconnected"}
        />
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Engram trace
        </span>
      </div>
      <ScrollArea className="h-72">
        <div className="flex flex-col gap-0.5 p-3 font-mono text-xs">
          {lines.length === 0 ? (
            <p className="text-muted-foreground">Waiting for trace events…</p>
          ) : (
            lines.map((line) => <TraceRow key={line.key} event={line.event} />)
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

/** One trace event row — timestamp, method, status, summary. */
function TraceRow({ event }: { event: EngramTraceEvent }) {
  return (
    <p className={event.ok ? "" : "text-status-failed"}>
      <span className="text-muted-foreground">{event.ts}</span>{" "}
      <span className="font-semibold">{event.method}</span>{" "}
      {event.response_summary}
      {event.error !== undefined ? ` — ${event.error}` : ""}
    </p>
  );
}

/**
 * Parse one SSE `trace` payload into an `EngramTraceEvent`. Two independent
 * defensive parses: the SSE `data` string → `{ line }` envelope, then the
 * `line` string → the event. A failure in either is swallowed (returns null).
 */
function parseTraceLine(data: string): EngramTraceEvent | null {
  let line: string;
  try {
    const envelope: unknown = JSON.parse(data);
    if (!isLineEnvelope(envelope)) return null;
    line = envelope.line;
  } catch {
    return null;
  }
  try {
    const event: unknown = JSON.parse(line);
    return isTraceEvent(event) ? event : null;
  } catch {
    return null;
  }
}

/** True when `value` is a `{ line: string }` SSE envelope. */
function isLineEnvelope(value: unknown): value is { line: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { line?: unknown }).line === "string"
  );
}

/** Structural guard for an `EngramTraceEvent` parsed off the wire. */
function isTraceEvent(value: unknown): value is EngramTraceEvent {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["ts"] === "string" &&
    typeof candidate["method"] === "string" &&
    typeof candidate["ok"] === "boolean" &&
    typeof candidate["response_summary"] === "string"
  );
}
