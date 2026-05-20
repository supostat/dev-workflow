"use client";

// React hook over the global `sseHub` — the dashboard's single multiplexed
// `EventSource` lives in `sse-hub.ts` and the hook merely registers/unregisters
// a topic callback. `eventSourceUrl` is gone: every consumer subscribes by
// topic name and the hub owns URL construction, the connection lifecycle, the
// reconnect backoff, and the `connected` status.

import { useEffect, useRef, useState } from "react";
import { sseHub, type Topic } from "./sse-hub";

/** SSE topics the dashboard subscribes to — mirrors the server's `SseTopic`. */
export type EventTopic = Topic;

/** What `useSseTopic` exposes to a component. */
export interface SseTopicState {
  /** True while the hub's underlying EventSource is open. */
  connected: boolean;
}

/**
 * Subscribe to `topic` on the global `sseHub`. The callback is held in a ref
 * so changing it does not tear down the subscription; the effect's dependency
 * array is `[topic]` so re-rendering the hook with a different topic
 * unsubscribes the old one and subscribes to the new.
 */
export function useSseTopic(
  topic: EventTopic,
  onEvent: (data: string) => void,
): SseTopicState {
  const [connected, setConnected] = useState(sseHub.isConnected());
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const deliver = (data: string): void => onEventRef.current(data);
    const unsubscribeTopic = sseHub.subscribe(topic, deliver);
    const unsubscribeStatus = sseHub.onStatusChange(setConnected);
    return () => {
      unsubscribeTopic();
      unsubscribeStatus();
    };
  }, [topic]);

  return { connected };
}
