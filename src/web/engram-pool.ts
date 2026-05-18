// Per-project engram socket-path pool for the web dashboard (task-055).
//
// What it caches: the RESOLVED socket PATH for a project, not a live socket.
// `src/lib/engram.ts` opens a fresh `node:net` connection per RPC call and
// closes it when the response arrives — there is no long-lived socket to
// pool. The value of this pool is therefore (a) deterministic per-project
// path resolution that does not depend on `process.cwd()`, and (b) idle-TTL
// bookkeeping so a project untouched for 10 minutes drops its entry.
//
// Resolution priority for the socket path:
//   1. process.env.ENGRAM_SOCKET_PATH — explicit override (trusted boundary).
//   2. <projectPath>/.engram/engram.sock — per-project daemon deploy.
// The cwd-marker / $HOME fallback that engram.ts uses is intentionally NOT
// reproduced here: a web request never runs in the project's cwd, so the
// per-project path must be derived from the registry-stored project path.

import { join } from "node:path";
import type { Project } from "./types.js";

/** Idle time after which an unused project entry is evicted. */
const IDLE_TTL_MS = 10 * 60 * 1000;

/** One pooled per-project engram connection descriptor. */
export interface EngramConnection {
  /** Resolved absolute path of the project's engram socket. */
  socketPath: string;
  /** Epoch millis of the last `getConnection` call for this project. */
  lastUsed: number;
}

interface PoolEntry {
  socketPath: string;
  lastUsed: number;
  idleTimer: ReturnType<typeof setTimeout>;
}

/**
 * Resolve the engram socket path for a project. Pure — exported for testing
 * and reused by callers that want the path without touching the pool.
 */
export function resolveProjectSocketPath(projectPath: string): string {
  const override = process.env["ENGRAM_SOCKET_PATH"];
  if (override !== undefined && override.length > 0) return override;
  return join(projectPath, ".engram", "engram.sock");
}

/**
 * Lazily-populated, idle-evicting map of project name → engram socket path.
 *
 * Concurrency: `getConnection` performs a synchronous read-modify-write of
 * the backing Map with no `await` in between, so concurrent web requests on
 * Node's single thread cannot observe a torn entry (ADR sync-I/O atomicity).
 */
export class EngramPool {
  private readonly entries = new Map<string, PoolEntry>();

  /**
   * Return the project's engram connection descriptor, creating the pool
   * entry on first use. Each call refreshes the idle timer.
   */
  getConnection(project: Project): EngramConnection {
    const existing = this.entries.get(project.name);
    if (existing !== undefined) {
      clearTimeout(existing.idleTimer);
      existing.lastUsed = Date.now();
      existing.idleTimer = this.armIdleTimer(project.name);
      return { socketPath: existing.socketPath, lastUsed: existing.lastUsed };
    }
    const socketPath = resolveProjectSocketPath(project.path);
    const entry: PoolEntry = {
      socketPath,
      lastUsed: Date.now(),
      idleTimer: this.armIdleTimer(project.name),
    };
    this.entries.set(project.name, entry);
    return { socketPath, lastUsed: entry.lastUsed };
  }

  /** Drop a project's pool entry immediately, cancelling its idle timer. */
  releaseConnection(project: Project): void {
    const entry = this.entries.get(project.name);
    if (entry === undefined) return;
    clearTimeout(entry.idleTimer);
    this.entries.delete(project.name);
  }

  /** Number of currently-pooled projects. Exposed for tests/diagnostics. */
  size(): number {
    return this.entries.size;
  }

  /** Cancel every idle timer and clear the pool. Idempotent. */
  shutdown(): void {
    for (const entry of this.entries.values()) {
      clearTimeout(entry.idleTimer);
    }
    this.entries.clear();
  }

  private armIdleTimer(projectName: string): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.entries.delete(projectName);
    }, IDLE_TTL_MS);
    timer.unref();
    return timer;
  }
}
