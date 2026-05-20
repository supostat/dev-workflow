"use client";

// Reusable terminal-style live JSONL viewer for a workflow run's engram trace.
//
// Subscribes to the `trace` topic on the shared `sseHub` — the multiplexed
// connection carries lines for EVERY run of the active project, so each
// payload names its source runId and the viewer filters by it client-side.
// `runId === null` disables the viewer (no lines retained). Each SSE message
// carries a `{runId, line}` envelope and `line` itself is one
// `EngramTraceEvent` — the two `JSON.parse` calls are independently wrapped
// in try/catch so a malformed payload skips that line rather than crashing
// the viewer. The rendered buffer is capped at `MAX_LINES` so a long-running
// stream cannot grow the DOM without bound. Changing `runId` resets the
// buffer so a stale run's lines never leak into a freshly picked one.

import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSseTopic } from "@/lib/sse";
import type { EngramTraceEvent, TraceEventPayload } from "@/lib/api";

/** Hard cap on retained trace lines — oldest lines drop off the top. */
const MAX_LINES = 200;

/** One rendered trace row. */
interface TraceLine {
  /** Monotonic key — SSE delivers no stable per-line id. */
  key: number;
  event: EngramTraceEvent;
}

interface TraceTailProps {
  /** Source run to display; `null` keeps the viewer empty. */
  runId: string | null;
}

/** Parsed trace payload — the source runId plus the inner event. */
interface ParsedTrace {
  runId: string;
  event: EngramTraceEvent;
}

/** Live terminal-style viewer of a run's engram trace JSONL. */
export function TraceTail({ runId }: TraceTailProps) {
  const [lines, setLines] = useState<TraceLine[]>([]);
  const nextKey = useRef(0);

  const append = useCallback((data: string): void => {
    const parsed = parseTraceLine(data);
    if (parsed === null) return;
    if (runId === null || parsed.runId !== runId) return;
    setLines((current) => {
      const next = [...current, { key: nextKey.current++, event: parsed.event }];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, [runId]);

  useEffect(() => {
    setLines([]);
  }, [runId]);

  const { connected } = useSseTopic("trace", append);

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
 * Parse one SSE `trace` payload into a `ParsedTrace`. Two independent
 * defensive parses: the SSE `data` string → `{runId, line}` envelope, then
 * the `line` string → the event. A failure in either is swallowed (returns
 * null).
 */
function parseTraceLine(data: string): ParsedTrace | null {
  let envelope: TraceEventPayload;
  try {
    const parsed: unknown = JSON.parse(data);
    if (!isTraceEnvelope(parsed)) return null;
    envelope = parsed;
  } catch {
    return null;
  }
  try {
    const event: unknown = JSON.parse(envelope.line);
    return isTraceEvent(event) ? { runId: envelope.runId, event } : null;
  } catch {
    return null;
  }
}

/** True when `value` is a `{runId, line}` SSE envelope. */
function isTraceEnvelope(value: unknown): value is TraceEventPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate["runId"] === "string" && typeof candidate["line"] === "string";
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
