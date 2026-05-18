import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { createServer, type Server } from "node:http";
import { watch, type FSWatcher } from "chokidar";
import type { AddressInfo, Socket } from "node:net";
import { SseRegistry } from "../src/web/sse.js";
import { WatcherPool } from "../src/web/watcher.js";
import type { Project } from "../src/web/types.js";

/**
 * A throwaway http server that pipes one SSE subscriber into the registry,
 * letting the watcher test observe real broadcasts as parsed events.
 */
function makeSseSink(sse: SseRegistry): {
  server: Server;
  listen: () => Promise<number>;
  subscribe: (port: number, path: string) => Promise<{ records: string[]; close: () => void }>;
  close: () => Promise<void>;
} {
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const topic = url.searchParams.get("topic");
    const project = url.searchParams.get("project") ?? "";
    const runId = url.searchParams.get("runId");
    if (topic === "vault" || topic === "runs" || topic === "trace" || topic === "projects") {
      sse.open(req, res, topic, project, runId);
      return;
    }
    res.writeHead(404).end();
  });
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  return {
    server,
    listen: () =>
      new Promise<number>((resolvePromise) =>
        server.listen(0, "127.0.0.1", () =>
          resolvePromise((server.address() as AddressInfo).port),
        ),
      ),
    subscribe: (port, path) =>
      new Promise((resolvePromise, reject) => {
        const records: string[] = [];
        let buffer = "";
        const req = request({ host: "127.0.0.1", port, path }, (res) => {
          res.setEncoding("utf-8");
          res.on("data", (chunk: string) => {
            buffer += chunk;
            let sep = buffer.indexOf("\n\n");
            while (sep !== -1) {
              const block = buffer.slice(0, sep);
              buffer = buffer.slice(sep + 2);
              for (const line of block.split("\n")) {
                if (line.startsWith("data:")) records.push(line.slice(5).trim());
              }
              sep = buffer.indexOf("\n\n");
            }
          });
          resolvePromise({ records, close: () => req.destroy() });
        });
        req.on("error", reject);
        req.end();
      }),
    close: () =>
      new Promise<void>((resolvePromise) => {
        for (const socket of sockets) socket.destroy();
        sockets.clear();
        server.close(() => resolvePromise());
      }),
  };
}

async function waitForRecord(records: string[], timeoutMs = 3000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (records.length > 0) return records[0]!;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("no SSE record within timeout");
}

describe("web watcher — chokidar pool", () => {
  let projectRoot: string;
  let vaultPath: string;
  let project: Project;
  let sse: SseRegistry;
  let watchers: WatcherPool;
  let sink: ReturnType<typeof makeSseSink>;
  let port: number;

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), "web-watcher-proj-"));
    vaultPath = join(projectRoot, ".dev-vault");
    mkdirSync(join(vaultPath, "workflow-state", "runs"), { recursive: true });
    writeFileSync(join(vaultPath, "knowledge.md"), "# Knowledge\n", "utf-8");
    project = { name: "watch-target", path: projectRoot, lastSeen: "" };
    sse = new SseRegistry();
    watchers = new WatcherPool(sse);
    sink = makeSseSink(sse);
    port = await sink.listen();
  });

  afterEach(async () => {
    watchers.shutdown();
    await sink.close();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("delivers a vault event after a file change (liveness)", async () => {
    const { records } = await sink.subscribe(port, "/?topic=vault&project=watch-target");
    watchers.startVaultWatch(project);
    await new Promise((r) => setTimeout(r, 150));
    writeFileSync(join(vaultPath, "knowledge.md"), "# Knowledge\nedited\n", "utf-8");
    const record = await waitForRecord(records);
    expect(JSON.parse(record).file).toBe("knowledge.md");
  });

  it("broadcasts within 100ms of detecting a change (AC#4)", async () => {
    // AC#4 honest metric: chokidar's awaitWriteFinish.stabilityThreshold (100ms)
    // makes write→detection inherently ≥100ms, so the AC measures the part the
    // server controls — detection→broadcast. An independent watcher with the
    // same config fires at ~the same time as the pool's internal watcher;
    // `broadcast` is spied to capture when the SSE record is emitted. The pool
    // calls broadcast synchronously from its chokidar callback, so the delta is
    // the synchronous detection→broadcast latency.
    let broadcastAt = 0;
    const broadcastSpy = vi
      .spyOn(sse, "broadcast")
      .mockImplementation(function (this: SseRegistry, ...args: Parameters<SseRegistry["broadcast"]>) {
        broadcastAt = performance.now();
        return SseRegistry.prototype.broadcast.apply(this, args);
      });
    let detectedAt = 0;
    const probe: FSWatcher = watch(join(vaultPath, "knowledge.md"), {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 },
    });
    probe.on("change", () => {
      if (detectedAt === 0) detectedAt = performance.now();
    });
    await new Promise((r) => probe.once("ready", r));
    watchers.startVaultWatch(project);
    await new Promise((r) => setTimeout(r, 150));
    writeFileSync(join(vaultPath, "knowledge.md"), "# Knowledge\nedited\n", "utf-8");
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && (broadcastAt === 0 || detectedAt === 0)) {
      await new Promise((r) => setTimeout(r, 10));
    }
    await probe.close();
    broadcastSpy.mockRestore();
    expect(detectedAt).toBeGreaterThan(0);
    expect(broadcastAt).toBeGreaterThan(0);
    expect(broadcastAt - detectedAt).toBeLessThan(100);
  });

  it("evicts a project's watchers after the idle TTL with no subscribers (AC#5)", async () => {
    // No SSE subscriber for the project — noteSubscriberChange arms the 5-min
    // eviction timer. Fake timers advance past the TTL so the timer callback
    // (stopAll) closes the watchers without waiting five real minutes.
    const closeSpy = vi.fn();
    const localSse = new SseRegistry();
    const localWatchers = new WatcherPool(localSse);
    localWatchers.startVaultWatch(project);
    localWatchers.startRunsWatch(project);
    // Intercept the chokidar close calls so eviction is observable.
    type WithWatchers = { perProject: Map<string, { vault: FSWatcher | null; runs: FSWatcher | null }> };
    const state = (localWatchers as unknown as WithWatchers).perProject.get(project.name)!;
    const originalVaultClose = state.vault!.close.bind(state.vault);
    const originalRunsClose = state.runs!.close.bind(state.runs);
    state.vault!.close = vi.fn(() => {
      closeSpy();
      return originalVaultClose();
    }) as FSWatcher["close"];
    state.runs!.close = vi.fn(() => {
      closeSpy();
      return originalRunsClose();
    }) as FSWatcher["close"];

    vi.useFakeTimers();
    try {
      localWatchers.noteSubscriberChange(project);
      // Before the TTL elapses the watchers are still open.
      vi.advanceTimersByTime(5 * 60 * 1000 - 1000);
      expect(closeSpy).not.toHaveBeenCalled();
      // Crossing the 5-minute boundary fires the eviction timer.
      vi.advanceTimersByTime(2000);
      expect(closeSpy).toHaveBeenCalledTimes(2);
      // The project entry is gone — a re-arm is a no-op.
      expect((localWatchers as unknown as WithWatchers).perProject.has(project.name)).toBe(false);
    } finally {
      vi.useRealTimers();
      localWatchers.shutdown();
    }
  });

  it("cancels the idle timer when a subscriber re-appears (AC#5)", async () => {
    const localSse = new SseRegistry();
    const localWatchers = new WatcherPool(localSse);
    localWatchers.startVaultWatch(project);
    const closeSpy = vi.fn();
    type WithWatchers = { perProject: Map<string, { vault: FSWatcher | null }> };
    const state = (localWatchers as unknown as WithWatchers).perProject.get(project.name)!;
    const originalClose = state.vault!.close.bind(state.vault);
    state.vault!.close = vi.fn(() => {
      closeSpy();
      return originalClose();
    }) as FSWatcher["close"];

    vi.useFakeTimers();
    try {
      // No subscribers → timer armed.
      localWatchers.noteSubscriberChange(project);
      // A subscriber appears before the TTL elapses → timer cancelled.
      const localSink = makeSseSink(localSse);
      const localPort = await localSink.listen();
      await localSink.subscribe(localPort, "/?topic=vault&project=watch-target");
      localWatchers.noteSubscriberChange(project);
      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(closeSpy).not.toHaveBeenCalled();
      vi.useRealTimers();
      await localSink.close();
    } finally {
      vi.useRealTimers();
      localWatchers.shutdown();
    }
  });

  it("logs a chokidar error to stderr without crashing", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    watchers.startVaultWatch(project);
    type WithWatchers = { perProject: Map<string, { vault: FSWatcher | null }> };
    const state = (watchers as unknown as WithWatchers).perProject.get(project.name)!;
    expect(() => state.vault!.emit("error", new Error("synthetic watcher fault"))).not.toThrow();
    expect(stderrSpy).toHaveBeenCalled();
    const written = stderrSpy.mock.calls.map((call) => String(call[0])).join("");
    expect(written).toContain("synthetic watcher fault");
    stderrSpy.mockRestore();
  });

  it("emits a runs event on a run JSON change", async () => {
    const { records } = await sink.subscribe(port, "/?topic=runs&project=watch-target");
    watchers.startRunsWatch(project);
    await new Promise((r) => setTimeout(r, 150));
    writeFileSync(
      join(vaultPath, "workflow-state", "runs", "run-bbbbbbbbbbbb.json"),
      JSON.stringify({ id: "run-bbbbbbbbbbbb" }),
      "utf-8",
    );
    const record = await waitForRecord(records);
    expect(JSON.parse(record).runId).toBe("run-bbbbbbbbbbbb");
  });

  it("emits one trace event per appended JSONL line (offset tail)", async () => {
    const tracePath = join(
      vaultPath, "workflow-state", "runs", "run-cccccccccccc.engram-trace.jsonl",
    );
    writeFileSync(tracePath, "", "utf-8");
    const { records } = await sink.subscribe(
      port, "/?topic=trace&project=watch-target&runId=run-cccccccccccc",
    );
    watchers.startTraceWatch(project, "run-cccccccccccc");
    await new Promise((r) => setTimeout(r, 150));
    appendFileSync(tracePath, '{"line":1}\n{"line":2}\n', "utf-8");
    await new Promise((r) => setTimeout(r, 400));
    expect(records.length).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(records[0]!).line).toBe('{"line":1}');
  });

  it("emits a projects event when the registry file changes", async () => {
    const configHome = mkdtempSync(join(tmpdir(), "web-watcher-cfg-"));
    const originalConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = configHome;
    try {
      const localWatchers = new WatcherPool(sse);
      const { records } = await sink.subscribe(port, "/?topic=projects&project=");
      localWatchers.startProjectsWatch();
      await new Promise((r) => setTimeout(r, 150));
      const registryFile = join(configHome, "dev-workflow", "projects.json");
      mkdirSync(join(configHome, "dev-workflow"), { recursive: true });
      writeFileSync(registryFile, '{"projects":{},"activeProject":null}', "utf-8");
      const record = await waitForRecord(records);
      expect(JSON.parse(record).action).toBe("registry-changed");
      localWatchers.shutdown();
    } finally {
      if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = originalConfigHome;
      rmSync(configHome, { recursive: true, force: true });
    }
  });

  it("stopAll closes a project's watchers without throwing", () => {
    watchers.startVaultWatch(project);
    watchers.startRunsWatch(project);
    expect(() => watchers.stopAll(project)).not.toThrow();
  });

  it("shutdown closes every watcher idempotently", () => {
    watchers.startVaultWatch(project);
    watchers.startProjectsWatch();
    watchers.shutdown();
    expect(() => watchers.shutdown()).not.toThrow();
  });

  it("startVaultWatch is idempotent for one project", () => {
    watchers.startVaultWatch(project);
    expect(() => watchers.startVaultWatch(project)).not.toThrow();
  });
});
