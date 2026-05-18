// Server-Sent Events registry for the web dashboard (task-055).
//
// One SseRegistry instance is owned by the http server. It tracks every open
// event-stream response, fans out `broadcast` calls to the subscribers of a
// (topic, project) pair, and enforces a server-wide 50-connection cap.
//
// SSE wire format: `Content-Type: text/event-stream`, one record per change
// terminated by a blank line, plus a `ping` heartbeat every 30s so idle
// proxies do not drop the connection.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { SseTopic } from "./types.js";

/** Server-wide ceiling on concurrent SSE connections. 51st open → 503. */
export const MAX_SSE_CONNECTIONS = 50;
/** Heartbeat interval — a `ping` event keeps intermediaries from timing out. */
export const HEARTBEAT_MS = 30_000;

interface Subscriber {
  topic: SseTopic;
  project: string;
  /** Set for the `trace` topic only — narrows delivery to one workflow run. */
  runId: string | null;
  response: ServerResponse;
  heartbeat: ReturnType<typeof setInterval>;
}

/**
 * Tracks open SSE connections and routes broadcasts.
 *
 * Concurrency: `open` performs the cap check and the `add` in a single
 * synchronous block (no `await` between `size` read and `add`), so two
 * simultaneous requests on Node's single thread cannot both slip past a
 * full registry.
 */
export class SseRegistry {
  private readonly subscribers = new Set<Subscriber>();

  /**
   * Begin an SSE stream on `res`. Returns `false` (and sends a 503) when the
   * server-wide connection cap is already reached; returns `true` after the
   * event-stream headers and heartbeat are installed.
   */
  open(
    req: IncomingMessage,
    res: ServerResponse,
    topic: SseTopic,
    project: string,
    runId: string | null,
  ): boolean {
    if (this.subscribers.size >= MAX_SSE_CONNECTIONS) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "SSE connection limit reached" }));
      return false;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(":ok\n\n");
    const heartbeat = setInterval(() => {
      res.write("event: ping\ndata: \n\n");
    }, HEARTBEAT_MS);
    heartbeat.unref();
    const subscriber: Subscriber = { topic, project, runId, response: res, heartbeat };
    this.subscribers.add(subscriber);
    const cleanup = (): void => {
      clearInterval(heartbeat);
      this.subscribers.delete(subscriber);
    };
    req.on("close", cleanup);
    res.on("close", cleanup);
    return true;
  }

  /**
   * Push `payload` (serialised to JSON) as one SSE record to every subscriber
   * of `(topic, project)`. For the `trace` topic, `runId` must also match.
   */
  broadcast(topic: SseTopic, project: string, payload: unknown, runId?: string): void {
    const data = JSON.stringify(payload);
    const record = `event: ${topic}\ndata: ${data}\n\n`;
    for (const subscriber of this.subscribers) {
      if (subscriber.topic !== topic || subscriber.project !== project) continue;
      if (topic === "trace" && subscriber.runId !== (runId ?? null)) continue;
      subscriber.response.write(record);
    }
  }

  /** Count subscribers, optionally narrowed to a single topic. */
  subscriberCount(topic?: SseTopic): number {
    if (topic === undefined) return this.subscribers.size;
    let count = 0;
    for (const subscriber of this.subscribers) {
      if (subscriber.topic === topic) count++;
    }
    return count;
  }

  /**
   * Whether any subscriber currently watches `(topic, project)`. Used by the
   * watcher pool's idle-TTL bookkeeping.
   */
  hasSubscribers(topic: SseTopic, project: string): boolean {
    for (const subscriber of this.subscribers) {
      if (subscriber.topic === topic && subscriber.project === project) return true;
    }
    return false;
  }

  /** Close every connection and clear the registry. Idempotent. */
  closeAll(): void {
    for (const subscriber of this.subscribers) {
      clearInterval(subscriber.heartbeat);
      subscriber.response.end();
    }
    this.subscribers.clear();
  }
}
