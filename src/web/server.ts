// HTTP server for the dev-workflow web dashboard (task-055).
//
// A vanilla `node:http` server bound HARD to 127.0.0.1 — there is no host
// override path, by design (single-user local tool, AC#12). It dispatches
// three prefixes: `/api/*` → REST, `/events/*` → SSE, everything else →
// static dashboard assets. Long-lived shared state (SSE registry, watcher
// pool, engram pool, rate buckets) is constructed here and injected.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { handleApi } from "./api-router.js";
import { SseRegistry } from "./sse.js";
import { WatcherPool } from "./watcher.js";
import { EngramPool } from "./engram-pool.js";
import { serveStatic } from "./static.js";
import { loadRegistry, validateProjectName } from "./projects.js";
import type { SseTopic } from "./types.js";

/** Loopback bind address — hardcoded, never overridable. */
const HOST = "127.0.0.1";
/** Default listen port for the dashboard. */
export const DEFAULT_PORT = 3737;
/** Largest request body accepted for PATCH/POST — bigger → 413. */
const MAX_BODY_BYTES = 1024 * 1024;
/** Per-client request budget per rolling minute — over → 429. SSE is exempt. */
const RATE_LIMIT_PER_MIN = 60;
/** Rolling window the rate limiter refills over. */
const RATE_WINDOW_MS = 60_000;
/** Every topic the multiplexed `/events/stream` connection carries. */
const MULTIPLEXED_TOPICS: ReadonlyArray<SseTopic> = ["vault", "runs", "projects", "trace"];

/**
 * Per-client token-bucket rate limiter.
 *
 * Concurrency: `consume` reads and writes the bucket in one synchronous block
 * with no `await`, so concurrent requests on Node's single thread cannot both
 * spend the same token.
 */
class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; refillAt: number }>();

  /** Spend one token for `clientKey`; `false` when the bucket is empty. */
  consume(clientKey: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(clientKey);
    if (bucket === undefined || now >= bucket.refillAt) {
      this.buckets.set(clientKey, { tokens: RATE_LIMIT_PER_MIN - 1, refillAt: now + RATE_WINDOW_MS });
      return true;
    }
    if (bucket.tokens <= 0) return false;
    bucket.tokens -= 1;
    return true;
  }
}

/** A running web server with an explicit async shutdown. */
export interface WebServerHandle {
  /** The underlying Node http server — `address()` exposes the bound port. */
  server: Server;
  /** Bind on `port` (0 = ephemeral) and resolve once listening. */
  listen(port: number): Promise<void>;
  /** Stop accepting requests and tear down every shared resource. */
  close(): Promise<void>;
}

/**
 * Construct the web server and its shared singletons. The server is not
 * listening until {@link WebServerHandle.listen} is called.
 */
export function createWebServer(): WebServerHandle {
  const sse = new SseRegistry();
  const watchers = new WatcherPool(sse);
  const engramPool = new EngramPool();
  const rateLimiter = new RateLimiter();
  watchers.startProjectsWatch();

  const server = createServer((req, res) => {
    void dispatch(req, res, { sse, watchers, engramPool, rateLimiter });
  });

  return {
    server,
    listen: (port: number) =>
      new Promise<void>((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen(port, HOST, () => {
          server.removeListener("error", reject);
          resolvePromise();
        });
      }),
    close: () =>
      new Promise<void>((resolvePromise) => {
        sse.closeAll();
        watchers.shutdown();
        engramPool.shutdown();
        server.close(() => resolvePromise());
      }),
  };
}

interface ServerState {
  sse: SseRegistry;
  watchers: WatcherPool;
  engramPool: EngramPool;
  rateLimiter: RateLimiter;
}

/** Top-level request dispatch with the 500 error boundary. */
async function dispatch(req: IncomingMessage, res: ServerResponse, state: ServerState): Promise<void> {
  try {
    await route(req, res, state);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "internal error" }));
  }
}

/** Prefix dispatch: CORS preflight, `/api/*`, `/events/*`, or static. */
async function route(req: IncomingMessage, res: ServerResponse, state: ServerState): Promise<void> {
  const port = portOf(req);
  applyCors(res, port);

  let url: URL;
  try {
    url = new URL(req.url ?? "/", `http://${HOST}:${port}`);
  } catch {
    sendError(res, 400, "malformed request URL");
    return;
  }

  const method = req.method ?? "GET";
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname.startsWith("/events/")) {
    handleEventStream(req, res, url, state);
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    await handleApiPrefix(req, res, url, method, state);
    return;
  }

  if (method !== "GET") {
    sendError(res, 405, `method not allowed: ${method}`);
    return;
  }
  serveStatic(res, url.pathname);
}

/** Rate-limit, read the body, and dispatch a `/api/*` request. */
async function handleApiPrefix(
  req: IncomingMessage, res: ServerResponse, url: URL, method: string, state: ServerState,
): Promise<void> {
  if (!state.rateLimiter.consume(clientKey(req))) {
    sendError(res, 429, "rate limit exceeded");
    return;
  }
  const body = await readBody(req, res);
  if (body === null) return;
  await handleApi(res, method, url, body, state.engramPool);
}

/**
 * Open the single multiplexed `/events/stream` connection. One browser tab
 * opens one EventSource carrying every topic — the client demuxes by event
 * name. Ordering invariant: `sse.open` runs FIRST and the function short-
 * circuits on the 503 cap path, so a rejected connection never starts
 * filesystem watchers it cannot consume.
 */
function handleEventStream(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  state: ServerState,
): void {
  if (url.pathname !== "/events/stream") {
    sendError(res, 404, `unknown SSE endpoint: ${url.pathname}`);
    return;
  }
  const projectName = url.searchParams.get("project");
  if (projectName === null || !validateProjectName(projectName)) {
    sendError(res, 400, "missing or invalid project query parameter");
    return;
  }
  const project = loadRegistry().projects[projectName];
  if (project === undefined) {
    sendError(res, 400, `unknown project: ${projectName}`);
    return;
  }
  const topics = new Set<SseTopic>(MULTIPLEXED_TOPICS);
  if (!state.sse.open(req, res, topics, project.name)) return;
  state.watchers.startVaultWatch(project);
  state.watchers.startRunsWatch(project);
  state.watchers.startTraceWatch(project);
  state.watchers.noteSubscriberChange(project);
  req.on("close", () => state.watchers.noteSubscriberChange(project));
}

/**
 * Accumulate the request body, enforcing the 1MB cap. Sends a 413 and returns
 * `null` when the cap is exceeded, a 400 on non-object JSON, and the parsed
 * JSON object on success.
 */
function readBody(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | null> {
  return new Promise((resolvePromise) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        aborted = true;
        sendError(res, 413, "request body exceeds 1MB limit");
        req.destroy();
        resolvePromise(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) return;
      resolvePromise(finalizeBody(Buffer.concat(chunks).toString("utf-8"), res));
    });
    req.on("error", () => {
      if (!aborted) resolvePromise(null);
    });
  });
}

/** Parse an accumulated request body; sends the 400 itself on bad JSON. */
function finalizeBody(raw: string, res: ServerResponse): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (trimmed === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    sendError(res, 400, "request body is not valid JSON");
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    sendError(res, 400, "request body must be a JSON object");
    return null;
  }
  return parsed as Record<string, unknown>;
}

/** Narrow same-origin CORS — only the dashboard's own loopback origin. */
function applyCors(res: ServerResponse, port: number): void {
  res.setHeader("Access-Control-Allow-Origin", `http://${HOST}:${port}`);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function portOf(req: IncomingMessage): number {
  const address = req.socket.localPort;
  return typeof address === "number" ? address : DEFAULT_PORT;
}

function clientKey(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? "unknown";
}

function sendError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: message }));
}
