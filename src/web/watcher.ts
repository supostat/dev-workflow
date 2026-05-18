// chokidar-backed file-watcher pool for the web dashboard (task-055).
//
// Each project gets its own watcher set (vault md files, run JSON files, and
// optionally a trace JSONL tail). A separate process-wide watcher observes
// the multi-project registry file. File events are translated into SSE
// broadcasts on the matching topic.
//
// Idle-TTL: a project with no SSE subscribers for 5 minutes has its watchers
// closed to free file descriptors; a fresh subscription re-opens them. The
// registry watcher is exempt — it lives for the whole server lifetime.

import { statSync, openSync, readSync, closeSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { watch, type FSWatcher } from "chokidar";
import type { SseRegistry } from "./sse.js";
import type { Project } from "./types.js";
import { registryFilePath } from "./projects.js";

/** Project watchers idle for this long (no subscribers) are evicted. */
const IDLE_TTL_MS = 5 * 60 * 1000;

/** Shared chokidar options — suppress mid-rename noise from atomic writes. */
const CHOKIDAR_OPTIONS = {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 },
} as const;

interface ProjectWatchers {
  vault: FSWatcher | null;
  runs: FSWatcher | null;
  trace: Map<string, { watcher: FSWatcher; offset: number }>;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Per-project chokidar watcher pool.
 *
 * Concurrency: lazy watcher creation mutates the backing Map synchronously
 * before any `await`, so concurrent `startVaultWatch` calls cannot create
 * duplicate watchers for one project.
 */
export class WatcherPool {
  private readonly perProject = new Map<string, ProjectWatchers>();
  private registryWatcher: FSWatcher | null = null;
  private readonly sse: SseRegistry;

  constructor(sse: SseRegistry) {
    this.sse = sse;
  }

  /**
   * Watch `<project>/.dev-vault` for top-level `*.md` changes → `vault` topic.
   * chokidar v4 dropped glob support, so a directory is watched with
   * `depth: 0` and the `.md` filter is applied per event.
   */
  startVaultWatch(project: Project): void {
    const state = this.ensureProject(project.name);
    if (state.vault !== null) return;
    const dir = join(project.path, ".dev-vault");
    const watcher = watch(dir, { ...CHOKIDAR_OPTIONS, depth: 0 });
    watcher.on("all", (event, changedPath) => {
      if (event !== "add" && event !== "change" && event !== "unlink") return;
      if (!changedPath.endsWith(".md")) return;
      this.sse.broadcast("vault", project.name, {
        file: changedPath.slice(changedPath.lastIndexOf("/") + 1),
        mtime: this.mtimeOrNull(changedPath),
        action: event,
      });
    });
    watcher.on("error", (error) => this.logError(error));
    state.vault = watcher;
  }

  /**
   * Watch `<project>/.dev-vault/workflow-state/runs` for `*.json` changes →
   * `runs` topic. Directory-watched (no glob in chokidar v4); the `.json`
   * filter excludes the sibling `.engram-trace.jsonl` files.
   */
  startRunsWatch(project: Project): void {
    const state = this.ensureProject(project.name);
    if (state.runs !== null) return;
    const dir = join(project.path, ".dev-vault", "workflow-state", "runs");
    const watcher = watch(dir, { ...CHOKIDAR_OPTIONS, depth: 0 });
    watcher.on("all", (event, changedPath) => {
      if (event !== "add" && event !== "change") return;
      if (!changedPath.endsWith(".json")) return;
      const file = changedPath.slice(changedPath.lastIndexOf("/") + 1);
      this.sse.broadcast("runs", project.name, {
        runId: file.replace(/\.json$/, ""),
        action: event,
      });
    });
    watcher.on("error", (error) => this.logError(error));
    state.runs = watcher;
  }

  /**
   * Tail `<run>.engram-trace.jsonl`, emitting each appended line as one
   * `trace` event scoped to `runId`. Re-subscribing the same runId is a no-op.
   */
  startTraceWatch(project: Project, runId: string): void {
    const state = this.ensureProject(project.name);
    if (state.trace.has(runId)) return;
    const tracePath = join(
      project.path, ".dev-vault", "workflow-state", "runs", `${runId}.engram-trace.jsonl`,
    );
    const slot = { watcher: watch(tracePath, CHOKIDAR_OPTIONS), offset: this.fileSize(tracePath) };
    slot.watcher.on("all", (event) => {
      if (event !== "add" && event !== "change") return;
      slot.offset = this.emitNewLines(tracePath, slot.offset, project.name, runId);
    });
    slot.watcher.on("error", (error) => this.logError(error));
    state.trace.set(runId, slot);
  }

  /**
   * Open the process-wide registry watcher (idempotent). A change to
   * `projects.json` emits `{action:"registry-changed"}` on the `projects`
   * topic. Not subject to idle-TTL — closed only by {@link shutdown}.
   *
   * The registry's parent directory is watched (with `depth: 0`), not the
   * file itself: chokidar v4 cannot pick up the creation of a watched path
   * that does not yet exist, and the registry file is created lazily on the
   * first `saveRegistry`. The directory is ensured before watching.
   */
  startProjectsWatch(): void {
    if (this.registryWatcher !== null) return;
    const registryFile = registryFilePath();
    const registryDir = dirname(registryFile);
    mkdirSync(registryDir, { recursive: true });
    const watcher = watch(registryDir, { ...CHOKIDAR_OPTIONS, depth: 0 });
    watcher.on("all", (event, changedPath) => {
      if (event !== "add" && event !== "change" && event !== "unlink") return;
      if (changedPath !== registryFile) return;
      this.sse.broadcast("projects", "", { action: "registry-changed" });
    });
    watcher.on("error", (error) => this.logError(error));
    this.registryWatcher = watcher;
  }

  /** Close every watcher for one project and forget it. */
  stopAll(project: Project): void {
    const state = this.perProject.get(project.name);
    if (state === undefined) return;
    if (state.idleTimer !== null) clearTimeout(state.idleTimer);
    void state.vault?.close();
    void state.runs?.close();
    for (const slot of state.trace.values()) void slot.watcher.close();
    this.perProject.delete(project.name);
  }

  /**
   * Re-evaluate the idle timer for a project after its SSE subscriber count
   * changed. With zero subscribers an eviction timer is armed; with one or
   * more, any pending timer is cancelled.
   */
  noteSubscriberChange(project: Project): void {
    const state = this.perProject.get(project.name);
    if (state === undefined) return;
    const active =
      this.sse.hasSubscribers("vault", project.name) ||
      this.sse.hasSubscribers("runs", project.name) ||
      this.sse.hasSubscribers("trace", project.name);
    if (active) {
      if (state.idleTimer !== null) {
        clearTimeout(state.idleTimer);
        state.idleTimer = null;
      }
      return;
    }
    if (state.idleTimer !== null) return;
    const timer = setTimeout(() => this.stopAll(project), IDLE_TTL_MS);
    timer.unref();
    state.idleTimer = timer;
  }

  /** Close every watcher across every project plus the registry watcher. */
  shutdown(): void {
    for (const state of this.perProject.values()) {
      if (state.idleTimer !== null) clearTimeout(state.idleTimer);
      void state.vault?.close();
      void state.runs?.close();
      for (const slot of state.trace.values()) void slot.watcher.close();
    }
    this.perProject.clear();
    void this.registryWatcher?.close();
    this.registryWatcher = null;
  }

  private ensureProject(name: string): ProjectWatchers {
    const existing = this.perProject.get(name);
    if (existing !== undefined) return existing;
    const state: ProjectWatchers = { vault: null, runs: null, trace: new Map(), idleTimer: null };
    this.perProject.set(name, state);
    return state;
  }

  private emitNewLines(path: string, fromOffset: number, project: string, runId: string): number {
    const size = this.fileSize(path);
    if (size <= fromOffset) return size;
    const length = size - fromOffset;
    const buffer = Buffer.alloc(length);
    const fd = openSync(path, "r");
    try {
      readSync(fd, buffer, 0, length, fromOffset);
    } finally {
      closeSync(fd);
    }
    for (const line of buffer.toString("utf-8").split("\n")) {
      if (line.trim() === "") continue;
      this.sse.broadcast("trace", project, { line }, runId);
    }
    return size;
  }

  private fileSize(path: string): number {
    try {
      return statSync(path).size;
    } catch {
      return 0;
    }
  }

  private mtimeOrNull(path: string): string | null {
    try {
      return statSync(path).mtime.toISOString();
    } catch {
      return null;
    }
  }

  private logError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`watcher error: ${message}\n`);
  }
}
