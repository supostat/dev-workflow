// chokidar-backed file-watcher pool for the web dashboard (task-055).
//
// Each project gets its own watcher set (vault md files, run JSON files, and
// a trace JSONL directory watcher). A separate process-wide watcher observes
// the multi-project registry file. File events are translated into SSE
// broadcasts on the matching topic.
//
// Trace watcher: a single directory watcher (no glob — chokidar v4 dropped
// glob support) for `<project>/.dev-vault/workflow-state/runs/` tagging every
// emitted line with the originating runId. Clients filter by runId; one
// watcher serves every run of the project.
//
// Idle-TTL: a project with no SSE subscribers for 5 minutes has its watchers
// closed to free file descriptors; a fresh subscription re-opens them. The
// registry watcher is exempt — it lives for the whole server lifetime.

import { statSync, openSync, readSync, closeSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { watch, type FSWatcher } from "chokidar";
import type { SseRegistry } from "./sse.js";
import type { Project, TraceEventPayload } from "./types.js";
import { registryFilePath } from "./projects.js";

/** Project watchers idle for this long (no subscribers) are evicted. */
const IDLE_TTL_MS = 5 * 60 * 1000;

/** Shared chokidar options — suppress mid-rename noise from atomic writes. */
const CHOKIDAR_OPTIONS = {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 },
} as const;

/** Suffix marking an engram-trace JSONL — used by the trace directory watcher. */
const TRACE_FILE_SUFFIX = ".engram-trace.jsonl";

interface TraceWatcherState {
  watcher: FSWatcher | null;
  /** Byte offset already emitted, keyed by absolute path. */
  offsets: Map<string, number>;
}

interface ProjectWatchers {
  vault: FSWatcher | null;
  runs: FSWatcher | null;
  trace: TraceWatcherState;
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
   * Watch `<project>/.dev-vault/workflow-state/runs` for `*.engram-trace.jsonl`
   * appends, emitting each new line as one `trace` SSE record tagged with the
   * source runId. One watcher serves every run of the project — clients filter
   * by runId.
   *
   * Offset-seeding under `ignoreInitial: true`:
   *  - `add` fires for files created after the watcher mounted; the entire
   *    file is new content, so `fromOffset` starts at 0.
   *  - `change` on a pre-existing file means historical bytes already on disk
   *    when the watcher mounted must NOT be replayed — seed `fromOffset` to
   *    the current file size so only newly appended bytes broadcast.
   *  - `unlink` drops the offset entry so the Map does not leak as completed
   *    runs are pruned by the workflow run GC.
   */
  startTraceWatch(project: Project): void {
    const state = this.ensureProject(project.name);
    if (state.trace.watcher !== null) return;
    const dir = join(project.path, ".dev-vault", "workflow-state", "runs");
    const watcher = watch(dir, { ...CHOKIDAR_OPTIONS, depth: 0 });
    watcher.on("all", (event, changedPath) => {
      if (!changedPath.endsWith(TRACE_FILE_SUFFIX)) return;
      if (event === "unlink") {
        state.trace.offsets.delete(changedPath);
        return;
      }
      if (event !== "add" && event !== "change") return;
      const file = changedPath.slice(changedPath.lastIndexOf("/") + 1);
      const runId = file.slice(0, -TRACE_FILE_SUFFIX.length);
      const fromOffset =
        state.trace.offsets.get(changedPath) ??
        (event === "add" ? 0 : this.fileSize(changedPath));
      const nextOffset = this.emitNewLines(changedPath, fromOffset, project.name, runId);
      state.trace.offsets.set(changedPath, nextOffset);
    });
    watcher.on("error", (error) => this.logError(error));
    state.trace.watcher = watcher;
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
    void state.trace.watcher?.close();
    this.perProject.delete(project.name);
  }

  /**
   * Re-evaluate the idle timer for a project after its SSE subscriber count
   * changed. With zero subscribers an eviction timer is armed; with one or
   * more, any pending timer is cancelled.
   *
   * With multiplexed subscribers every open connection carries vault + runs +
   * trace + projects, so the three-way hasSubscribers check is now equivalent
   * to a single "any project-scoped subscriber" probe. Left as a three-way OR
   * to avoid an unrelated refactor inside this change.
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
      void state.trace.watcher?.close();
    }
    this.perProject.clear();
    void this.registryWatcher?.close();
    this.registryWatcher = null;
  }

  private ensureProject(name: string): ProjectWatchers {
    const existing = this.perProject.get(name);
    if (existing !== undefined) return existing;
    const state: ProjectWatchers = {
      vault: null,
      runs: null,
      trace: { watcher: null, offsets: new Map() },
      idleTimer: null,
    };
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
      this.sse.broadcast("trace", project, { runId, line } satisfies TraceEventPayload);
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
