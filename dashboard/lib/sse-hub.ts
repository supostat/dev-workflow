"use client";

// Browser-side SSE multiplexer — owns the single `EventSource` per tab and
// fans incoming records out to topic-keyed subscribers. The dashboard now
// opens ONE `/events/stream?project=<name>` connection regardless of which
// page is rendering; pages register a `useSseTopic("vault", …)` (etc.) hook
// and the hub demuxes by SSE `event:` name.
//
// Ordering invariant in `setProject`: a rapid `setProject("a") → setProject(
// "b")` must tear down any pending `setTimeout(connect, backoff)` BEFORE
// opening B — otherwise the queued A-targeted reconnect would race the new
// B connection. The reconnect sequence is therefore:
//   (1) clear retryTimer, (2) close prior EventSource, (3) flip connected
//   flag to false, (4) reset backoff to its initial value, (5) open the new
//   connection (or stay closed when project === null).
//
// The hub registers exactly one native `addEventListener(topic, …)` per
// topic on the underlying `EventSource` (four total); per-subscriber fan-out
// lives in the JS-side `Map<Topic, Set<Callback>>`. The module-level export
// is the singleton — every consumer (React hook, project context) goes
// through the same instance.

/** SSE topics the dashboard subscribes to — mirrors the server's `SseTopic`. */
export type Topic = "vault" | "runs" | "trace" | "projects";

/** Initial reconnect delay; doubles per failure up to `MAX_BACKOFF_MS`. */
const INITIAL_BACKOFF_MS = 1_000;
/** Capped reconnect delay — backoff saturates at this value. */
const MAX_BACKOFF_MS = 30_000;

const TOPICS: ReadonlyArray<Topic> = ["vault", "runs", "trace", "projects"];

type Callback = (data: string) => void;
type StatusListener = (connected: boolean) => void;

/**
 * Singleton SSE multiplexer. Construction does not open a connection;
 * `setProject(name)` opens the first one, and a subsequent `setProject(name)`
 * with the same value is a no-op — every other path tears down the prior
 * EventSource before constructing the next.
 */
class SseHub {
  private source: EventSource | null = null;
  private project: string | null = null;
  private readonly topics = new Map<Topic, Set<Callback>>();
  private readonly statusListeners = new Set<StatusListener>();
  private connected = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = INITIAL_BACKOFF_MS;

  /**
   * Bind the hub to `project`. Passing `null` closes the active stream and
   * leaves the hub idle; passing the same project as the current one is a
   * no-op (the EventSource is not torn down and re-opened).
   */
  setProject(project: string | null): void {
    if (project === this.project) return;
    this.project = project;
    this.reconnect();
  }

  /** True between the underlying EventSource's `onopen` and the next error. */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Register `callback` for `topic`. Returns the unsubscribe function — only
   * the named callback is removed; other subscribers on the same topic keep
   * receiving events.
   */
  subscribe(topic: Topic, callback: Callback): () => void {
    let set = this.topics.get(topic);
    if (set === undefined) {
      set = new Set();
      this.topics.set(topic, set);
    }
    set.add(callback);
    return () => {
      set!.delete(callback);
    };
  }

  /** Register a listener fired whenever the connected flag flips. */
  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private reconnect(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.source?.close();
    this.source = null;
    this.setConnected(false);
    this.backoff = INITIAL_BACKOFF_MS;
    if (this.project === null) return;
    this.connect();
  }

  private connect(): void {
    if (this.project === null) return;
    const url = `/events/stream?project=${encodeURIComponent(this.project)}`;
    const source = new EventSource(url);
    this.source = source;
    source.onopen = (): void => {
      this.backoff = INITIAL_BACKOFF_MS;
      this.setConnected(true);
    };
    // Anonymous listener identity is intentionally throwaway. Each reconnect()
    // closes the EventSource entirely (see reconnect()), which drops every
    // listener with it. Do not refactor toward selective `removeEventListener`
    // without making listener identity stable first.
    for (const topic of TOPICS) {
      source.addEventListener(topic, (event): void => {
        const data = (event as MessageEvent<string>).data;
        const callbacks = this.topics.get(topic);
        if (callbacks === undefined) return;
        for (const callback of callbacks) callback(data);
      });
    }
    source.onerror = (): void => {
      this.setConnected(false);
      source.close();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.project === null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
  }

  private setConnected(value: boolean): void {
    if (this.connected === value) return;
    this.connected = value;
    for (const listener of this.statusListeners) listener(value);
  }
}

/** The single module-level instance every consumer subscribes through. */
export const sseHub = new SseHub();
