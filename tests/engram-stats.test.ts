import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectEngramStats } from "../src/lib/engram-stats.js";
import type { WorkflowRun } from "../src/workflow/types.js";

describe("collectEngramStats", () => {
  let vaultPath: string;
  let originalEngramSocket: string | undefined;

  beforeEach(() => {
    originalEngramSocket = process.env["ENGRAM_SOCKET_PATH"];
    process.env["ENGRAM_SOCKET_PATH"] = "/tmp/no-such-engram-socket-isolated-test";
    vaultPath = mkdtempSync(join(tmpdir(), "engram-stats-test-"));
    mkdirSync(join(vaultPath, "workflow-state", "runs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    if (originalEngramSocket === undefined) {
      delete process.env["ENGRAM_SOCKET_PATH"];
    } else {
      process.env["ENGRAM_SOCKET_PATH"] = originalEngramSocket;
    }
  });

  function makeRun(id: string, overrides: Partial<WorkflowRun> = {}): WorkflowRun {
    const baseRun: WorkflowRun = {
      id,
      workflowName: "dev",
      taskId: null,
      taskDescription: "test",
      currentStep: "code",
      startedAt: "2026-05-11T10:00:00Z",
      completedAt: "2026-05-11T11:00:00Z",
      status: "completed",
      steps: {
        read: { status: "completed", output: "x", startedAt: null, completedAt: null, durationMs: 100, attempt: 1, engramMemoryId: null, error: null },
        code: { status: "completed", output: "x", startedAt: null, completedAt: null, durationMs: 200, attempt: 1, engramMemoryId: null, error: null },
      },
      telemetry: { search: 5, store: 3, judge: 5, vaultRecord: 1, skipped: 0 },
    };
    return { ...baseRun, ...overrides };
  }

  function writeRun(run: WorkflowRun): void {
    writeFileSync(
      join(vaultPath, "workflow-state", "runs", `${run.id}.json`),
      JSON.stringify(run),
      "utf-8",
    );
  }

  function writeTrace(runId: string, events: object[]): void {
    const content = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    writeFileSync(
      join(vaultPath, "workflow-state", "runs", `${runId}.engram-trace.jsonl`),
      content,
      "utf-8",
    );
  }

  it("empty vault: zero runs, zero events, live.health=null (skipLive)", async () => {
    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.scope.runCount).toBe(0);
    expect(stats.scope.cutoffISO).toBeNull();
    expect(stats.recentRuns).toEqual([]);
    expect(stats.byMethod).toEqual({});
    expect(stats.byMemoryType).toEqual({});
    expect(stats.byStep).toEqual({});
    expect(stats.warnings).toEqual([]);
    expect(stats.live.health).toBeNull();
    expect(stats.live.topMemories).toEqual([]);
  });

  it("limits to runCount most-recent runs (newest first by startedAt)", async () => {
    writeRun(makeRun("run-001", { startedAt: "2026-05-09T10:00:00Z" }));
    writeRun(makeRun("run-002", { startedAt: "2026-05-10T10:00:00Z" }));
    writeRun(makeRun("run-003", { startedAt: "2026-05-11T10:00:00Z" }));

    const stats = await collectEngramStats(vaultPath, { runCount: 2, skipLive: true });
    expect(stats.scope.runCount).toBe(2);
    expect(stats.recentRuns[0]!.id).toBe("run-003");
    expect(stats.recentRuns[1]!.id).toBe("run-002");
    expect(stats.scope.cutoffISO).toBe("2026-05-10T10:00:00Z");
  });

  it("aggregates trace events by method", async () => {
    writeRun(makeRun("run-A"));
    writeTrace("run-A", [
      { ts: "x", method: "memory_search", params: {}, ok: true, response_summary: "", duration_ms: 1200 },
      { ts: "x", method: "memory_search", params: {}, ok: false, response_summary: "", duration_ms: 5000, error: "timeout" },
      { ts: "x", method: "memory_store", params: { memory_type: "pattern" }, ok: true, response_summary: "", duration_ms: 800 },
      { ts: "x", method: "memory_judge", params: {}, ok: true, response_summary: "", duration_ms: 300 },
    ]);

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.byMethod["memory_search"]).toEqual({ count: 2, errors: 1, avgDurationMs: 3100 });
    expect(stats.byMethod["memory_store"]).toEqual({ count: 1, errors: 0, avgDurationMs: 800 });
    expect(stats.byMethod["memory_judge"]).toEqual({ count: 1, errors: 0, avgDurationMs: 300 });
  });

  it("aggregates byMemoryType only from successful memory_store events", async () => {
    writeRun(makeRun("run-B"));
    writeTrace("run-B", [
      { ts: "x", method: "memory_store", params: { memory_type: "pattern" }, ok: true, response_summary: "", duration_ms: 100 },
      { ts: "x", method: "memory_store", params: { memory_type: "pattern" }, ok: true, response_summary: "", duration_ms: 100 },
      { ts: "x", method: "memory_store", params: { memory_type: "antipattern" }, ok: true, response_summary: "", duration_ms: 100 },
      { ts: "x", method: "memory_store", params: { memory_type: "decision" }, ok: false, response_summary: "", duration_ms: 100 }, // failed — excluded
      { ts: "x", method: "memory_search", params: { memory_type: "pattern" }, ok: true, response_summary: "", duration_ms: 100 }, // not store — excluded
    ]);

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.byMemoryType).toEqual({ pattern: 2, antipattern: 1 });
  });

  it("aggregates byStep using step:<name> tag", async () => {
    writeRun(makeRun("run-C"));
    writeTrace("run-C", [
      { ts: "x", method: "memory_search", params: { tags: ["step:read", "branch:main"] }, ok: true, response_summary: "", duration_ms: 100 },
      { ts: "x", method: "memory_search", params: { tags: ["step:read"] }, ok: true, response_summary: "", duration_ms: 100 },
      { ts: "x", method: "memory_store", params: { tags: ["step:code", "memory_type:pattern"] }, ok: true, response_summary: "", duration_ms: 100 },
      { ts: "x", method: "memory_judge", params: { tags: ["step:code"] }, ok: true, response_summary: "", duration_ms: 100 },
      { ts: "x", method: "memory_search", params: { tags: ["no-step-tag"] }, ok: true, response_summary: "", duration_ms: 100 }, // no step tag — skipped
    ]);

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.byStep["read"]).toEqual({ search: 2, store: 0, judge: 0 });
    expect(stats.byStep["code"]).toEqual({ search: 0, store: 1, judge: 1 });
  });

  it("warning: store > 0 but judge == 0 ('missed agent feedback')", async () => {
    writeRun(makeRun("run-D", {
      telemetry: { search: 0, store: 12, judge: 0, vaultRecord: 0, skipped: 0 },
    }));

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.warnings.length).toBe(1);
    expect(stats.warnings[0]!.runId).toBe("run-D");
    expect(stats.warnings[0]!.issue).toContain("missed agent feedback");
  });

  it("warning: vaultRecord > 0 but store == 0 ('daemon may have been down')", async () => {
    writeRun(makeRun("run-E", {
      telemetry: { search: 0, store: 0, judge: 0, vaultRecord: 3, skipped: 0 },
    }));

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.warnings.length).toBe(1);
    expect(stats.warnings[0]!.issue).toContain("daemon may have been down");
  });

  it("recentRuns: stepCount, completedSteps, durationMs computed from steps map", async () => {
    writeRun(makeRun("run-F", {
      startedAt: "2026-05-11T10:00:00Z",
      completedAt: "2026-05-11T10:05:00Z",
      steps: {
        read: { status: "completed", output: null, startedAt: null, completedAt: null, durationMs: null, attempt: 1, engramMemoryId: null, error: null },
        code: { status: "completed", output: null, startedAt: null, completedAt: null, durationMs: null, attempt: 1, engramMemoryId: null, error: null },
        review: { status: "failed", output: null, startedAt: null, completedAt: null, durationMs: null, attempt: 1, engramMemoryId: null, error: null },
      },
    }));

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.recentRuns[0]!.stepCount).toBe(3);
    expect(stats.recentRuns[0]!.completedSteps).toBe(2);
    expect(stats.recentRuns[0]!.durationMs).toBe(5 * 60 * 1000);
  });

  it("hasTrace flag reflects existence of engram-trace.jsonl file", async () => {
    writeRun(makeRun("run-with-trace"));
    writeTrace("run-with-trace", [
      { ts: "x", method: "memory_search", params: {}, ok: true, response_summary: "", duration_ms: 100 },
    ]);
    writeRun(makeRun("run-without-trace", { startedAt: "2026-05-10T10:00:00Z" }));

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    const withTrace = stats.recentRuns.find((r) => r.id === "run-with-trace")!;
    const withoutTrace = stats.recentRuns.find((r) => r.id === "run-without-trace")!;
    expect(withTrace.hasTrace).toBe(true);
    expect(withoutTrace.hasTrace).toBe(false);
  });

  it("corrupt run JSON is silently skipped", async () => {
    writeFileSync(
      join(vaultPath, "workflow-state", "runs", "run-bad.json"),
      "not json {{{",
      "utf-8",
    );
    writeRun(makeRun("run-good"));
    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.scope.runCount).toBe(1);
    expect(stats.recentRuns[0]!.id).toBe("run-good");
  });

  it("malformed trace lines are skipped (partial trace > no trace)", async () => {
    writeRun(makeRun("run-mixed"));
    const tracePath = join(vaultPath, "workflow-state", "runs", "run-mixed.engram-trace.jsonl");
    writeFileSync(tracePath,
      'broken line\n{"ts":"x","method":"memory_search","params":{},"ok":true,"response_summary":"","duration_ms":100}\nanother broken\n',
      "utf-8");

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.byMethod["memory_search"]?.count).toBe(1);
  });

  it("skipLive bypasses engramHealth and engramSearch (test determinism)", async () => {
    writeRun(makeRun("run-G"));
    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.live.health).toBeNull();
    expect(stats.live.topMemories).toEqual([]);
  });

  it("live mode with engram down: live.health=null, topMemories empty, local data still computed", async () => {
    writeRun(makeRun("run-H"));
    writeTrace("run-H", [
      { ts: "x", method: "memory_search", params: {}, ok: true, response_summary: "", duration_ms: 100 },
    ]);
    // ENGRAM_SOCKET_PATH points to a non-existent socket — engramHealth returns null
    const stats = await collectEngramStats(vaultPath, {
      projectName: "test",
      branch: "main",
      // skipLive not set: real engramHealth + engramSearch fire, both fail-safe
    });
    expect(stats.live.health).toBeNull();
    expect(stats.live.topMemories).toEqual([]);
    expect(stats.byMethod["memory_search"]?.count).toBe(1);
    expect(stats.recentRuns.length).toBe(1);
  });
});
