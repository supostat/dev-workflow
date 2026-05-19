"use client";

// React hook over the browser `EventSource` — used by the dashboard to follow
// the server's SSE topics (vault / runs / trace / projects, see src/web/sse.ts).
//
// The server emits `:ok\n\n` on open and an `event: ping` heartbeat every 30s.
// `useEventSource` listens with a NAMED listener for `topic` only, so the
// `ping` heartbeat is never delivered to `onEvent` — intended: ping is liveness
// signalling, not topic data. On a connection error the hook reconnects with
// an exponentially capped backoff (1s → 30s); a clean `onopen` resets the
// backoff so a healthy long-lived stream never accumulates delay.

import { useEffect, useRef, useState } from "react";

/** SSE topics the dashboard subscribes to — mirrors the server's `SseTopic`. */
export type EventTopic = "vault" | "runs" | "trace" | "projects";

/**
 * Build a project-scoped SSE endpoint URL for `topic`. The server requires a
 * `?project=` query parameter on the `vault`/`runs`/`trace` topics and 400s
 * without it; the `trace` topic additionally requires a `runId` and 400s
 * without that. Returns `null` when no project is resolved, or — for `trace` —
 * when no `runId` is supplied (the hook is then disabled). `extra` carries
 * topic-specific params such as the trace `runId`.
 */
export function eventSourceUrl(
  topic: EventTopic,
  project: string | null,
  extra?: Record<string, string>,
): string | null {
  if (project === null) return null;
  if (topic === "trace" && (extra?.runId ?? "") === "") return null;
  const params = new URLSearchParams({ project });
  for (const [key, value] of Object.entries(extra ?? {})) {
    params.set(key, value);
  }
  return `/events/${topic}?${params.toString()}`;
}

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

/** What `useEventSource` exposes to a component. */
export interface EventSourceState {
  /** True between `onopen` and the next error/unmount. */
  connected: boolean;
}

/**
 * Subscribe to the SSE `topic` at `url`. A `null` url disables the hook (no
 * connection, `connected: false`) — pass `null` until the URL is known.
 * `onEvent` receives the `data` string of every `topic` message; it is held
 * in a ref so changing the callback does not tear down the connection.
 */
export function useEventSource(
  url: string | null,
  topic: EventTopic,
  onEvent: (data: string) => void,
): EventSourceState {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (url === null) {
      setConnected(false);
      return;
    }
    const connection = openConnection(url, topic, onEventRef, setConnected);
    return connection.close;
  }, [url, topic]);

  return { connected };
}

/** A live connection plus its teardown function. */
interface ManagedConnection {
  close: () => void;
}

/**
 * Open one self-healing SSE connection. Reconnection is scheduled internally
 * with a capped backoff; `close` cancels any pending retry and the socket.
 */
function openConnection(
  url: string,
  topic: EventTopic,
  onEventRef: { current: (data: string) => void },
  setConnected: (value: boolean) => void,
): ManagedConnection {
  let source: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let backoff = INITIAL_BACKOFF_MS;
  let closed = false;

  const connect = (): void => {
    if (closed) return;
    source = new EventSource(url);
    source.onopen = (): void => {
      backoff = INITIAL_BACKOFF_MS;
      setConnected(true);
    };
    source.addEventListener(topic, (event): void => {
      onEventRef.current((event as MessageEvent<string>).data);
    });
    source.onerror = (): void => {
      setConnected(false);
      source?.close();
      scheduleReconnect();
    };
  };

  const scheduleReconnect = (): void => {
    if (closed) return;
    retryTimer = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  };

  connect();

  return {
    close: (): void => {
      closed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      source?.close();
    },
  };
}
