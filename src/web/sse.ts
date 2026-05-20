// Server-Sent Events registry for the web dashboard (task-055).
//
// One SseRegistry instance is owned by the http server. It tracks every open
// event-stream response, fans out `broadcast` calls to the subscribers of a
// (topic, project) pair, and enforces a server-wide 50-connection cap.
//
// A subscriber carries a *set* of topics on one connection — the multiplexed
// `/events/stream` endpoint registers `vault` + `runs` + `projects` + `trace`
// together so a browser tab opens exactly one persistent HTTP/1.1 connection
// regardless of which page is rendering. `broadcast()` writes to a subscriber
// when the broadcast topic is in its set AND its project matches; the
// `projects` topic is global (the registry watcher broadcasts with the empty
// project name) and bypasses the project filter so it reaches every subscriber
// scoped to any concrete project.
//
// SSE wire format: `Content-Type: text/event-stream`, one record per change
// terminated by a blank line, plus a `ping` heartbeat every 30s so idle
// proxies do not drop the connection. The heartbeat is per-connection, not
// per-topic — one `setInterval` per subscriber regardless of topic-set size.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { SseTopic } from "./types.js";

/** Server-wide ceiling on concurrent SSE connections. 51st open → 503. */
export const MAX_SSE_CONNECTIONS = 50;
/** Heartbeat interval — a `ping` event keeps intermediaries from timing out. */
export const HEARTBEAT_MS = 30_000;

interface Subscriber {
  /** Topics this connection is multiplexing. */
  topics: Set<SseTopic>;
  /** Concrete project name — the `projects` topic broadcast skips this filter. */
  project: string;
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
   * Begin an SSE stream on `res` multiplexing every topic in `topics`. Returns
   * `false` (and sends a 503) when the server-wide connection cap is already
   * reached; returns `true` after the event-stream headers and heartbeat are
   * installed.
   */
  open(
    req: IncomingMessage,
    res: ServerResponse,
    topics: Set<SseTopic>,
    project: string,
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
    const subscriber: Subscriber = { topics, project, response: res, heartbeat };
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
   * whose topic set contains `topic` and whose project matches `project`. The
   * `projects` topic is global — the registry watcher broadcasts with the
   * empty project name, and the project filter is skipped so every project-
   * scoped subscriber still receives the event.
   */
  broadcast(topic: SseTopic, project: string, payload: unknown): void {
    const record = `event: ${topic}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const subscriber of this.subscribers) {
      if (!subscriber.topics.has(topic)) continue;
      if (topic !== "projects" && subscriber.project !== project) continue;
      subscriber.response.write(record);
    }
  }

  /** Count subscribers, optionally narrowed to those carrying `topic`. */
  subscriberCount(topic?: SseTopic): number {
    if (topic === undefined) return this.subscribers.size;
    let count = 0;
    for (const subscriber of this.subscribers) {
      if (subscriber.topics.has(topic)) count++;
    }
    return count;
  }

  /**
   * Whether any subscriber currently carries `topic` for `project`. Used by
   * the watcher pool's idle-TTL bookkeeping.
   */
  hasSubscribers(topic: SseTopic, project: string): boolean {
    for (const subscriber of this.subscribers) {
      if (subscriber.topics.has(topic) && subscriber.project === project) return true;
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
