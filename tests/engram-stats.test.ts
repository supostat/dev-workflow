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
      phase: null,
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

  // -------------------------------------------------------------------------
  // crossRunReuse
  // -------------------------------------------------------------------------

  it("crossRunReuse: empty events → zero", async () => {
    writeRun(makeRun("run-cr-empty"));
    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.crossRunReuse).toEqual({ total: 0, reused: 0, percent: 0 });
  });

  it("crossRunReuse: pattern retrieved in run-A, judged in run-B → counts as reused", async () => {
    writeRun(makeRun("run-cr-A", { startedAt: "2026-05-11T10:00:00Z" }));
    writeRun(makeRun("run-cr-B", { startedAt: "2026-05-11T11:00:00Z" }));
    const mem = JSON.stringify([{ id: "mem-1", memory_type: "pattern", context: "x" }]);
    writeTrace("run-cr-A", [
      { ts: "x", method: "memory_search", params: {}, ok: true, response_summary: mem, duration_ms: 100 },
    ]);
    writeTrace("run-cr-B", [
      { ts: "x", method: "memory_judge", params: { memory_id: "mem-1", score: 0.9 }, ok: true, response_summary: "", duration_ms: 50 },
    ]);

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.crossRunReuse.total).toBe(1);
    expect(stats.crossRunReuse.reused).toBe(1);
    expect(stats.crossRunReuse.percent).toBe(100);
  });

  it("crossRunReuse: same-run retrieve + judge does NOT count", async () => {
    writeRun(makeRun("run-cr-same"));
    const mem = JSON.stringify([{ id: "mem-1", memory_type: "pattern" }]);
    writeTrace("run-cr-same", [
      { ts: "x", method: "memory_search", params: {}, ok: true, response_summary: mem, duration_ms: 100 },
      { ts: "x", method: "memory_judge", params: { memory_id: "mem-1", score: 0.9 }, ok: true, response_summary: "", duration_ms: 50 },
    ]);

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.crossRunReuse.total).toBe(1);
    expect(stats.crossRunReuse.reused).toBe(0);
    expect(stats.crossRunReuse.percent).toBe(0);
  });

  it("crossRunReuse: antipattern type counted; non-pattern types (decision/bugfix) excluded", async () => {
    writeRun(makeRun("run-cr-types-A", { startedAt: "2026-05-11T10:00:00Z" }));
    writeRun(makeRun("run-cr-types-B", { startedAt: "2026-05-11T11:00:00Z" }));
    const mem = JSON.stringify([
      { id: "mem-anti", memory_type: "antipattern" },
      { id: "mem-dec", memory_type: "decision" },
      { id: "mem-bug", memory_type: "bugfix" },
    ]);
    writeTrace("run-cr-types-A", [
      { ts: "x", method: "memory_search", params: {}, ok: true, response_summary: mem, duration_ms: 100 },
    ]);
    writeTrace("run-cr-types-B", [
      { ts: "x", method: "memory_judge", params: { memory_id: "mem-anti" }, ok: true, response_summary: "", duration_ms: 50 },
      { ts: "x", method: "memory_judge", params: { memory_id: "mem-dec" }, ok: true, response_summary: "", duration_ms: 50 },
      { ts: "x", method: "memory_judge", params: { memory_id: "mem-bug" }, ok: true, response_summary: "", duration_ms: 50 },
    ]);

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    // only mem-anti is in retrieved set (decision/bugfix filtered out)
    expect(stats.crossRunReuse.total).toBe(1);
    expect(stats.crossRunReuse.reused).toBe(1);
  });

  it("crossRunReuse: unparseable response_summary (truncated/null) → zero retrieved", async () => {
    writeRun(makeRun("run-cr-broken"));
    writeTrace("run-cr-broken", [
      { ts: "x", method: "memory_search", params: {}, ok: true, response_summary: '[{"id":"mem-1","memory_typ', duration_ms: 100 }, // truncated
      { ts: "x", method: "memory_search", params: {}, ok: true, response_summary: "null", duration_ms: 100 }, // valid JSON but not array
      { ts: "x", method: "memory_search", params: {}, ok: true, response_summary: "", duration_ms: 100 }, // empty
    ]);

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.crossRunReuse.total).toBe(0);
    expect(stats.crossRunReuse.reused).toBe(0);
  });

  it("crossRunReuse: partial — 2 retrieved, 1 judged cross-run → 1/2 (50%)", async () => {
    writeRun(makeRun("run-cr-part-A", { startedAt: "2026-05-11T10:00:00Z" }));
    writeRun(makeRun("run-cr-part-B", { startedAt: "2026-05-11T11:00:00Z" }));
    const mem = JSON.stringify([
      { id: "mem-1", memory_type: "pattern" },
      { id: "mem-2", memory_type: "pattern" },
    ]);
    writeTrace("run-cr-part-A", [
      { ts: "x", method: "memory_search", params: {}, ok: true, response_summary: mem, duration_ms: 100 },
    ]);
    writeTrace("run-cr-part-B", [
      { ts: "x", method: "memory_judge", params: { memory_id: "mem-1" }, ok: true, response_summary: "", duration_ms: 50 },
      // mem-2 never judged
    ]);

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.crossRunReuse.total).toBe(2);
    expect(stats.crossRunReuse.reused).toBe(1);
    expect(stats.crossRunReuse.percent).toBe(50);
  });

  // -------------------------------------------------------------------------
  // perStepHitRate
  // -------------------------------------------------------------------------

  it("perStepHitRate: per-step counting with JSON.parse non-empty detection", async () => {
    writeRun(makeRun("run-hr-1"));
    const nonEmpty = JSON.stringify([{ id: "m1", memory_type: "pattern" }]);
    const empty = "[]";
    writeTrace("run-hr-1", [
      { ts: "x", method: "memory_search", params: { tags: ["step:read"] }, ok: true, response_summary: nonEmpty, duration_ms: 100 },
      { ts: "x", method: "memory_search", params: { tags: ["step:read"] }, ok: true, response_summary: empty, duration_ms: 100 },
      { ts: "x", method: "memory_search", params: { tags: ["step:read"] }, ok: true, response_summary: nonEmpty, duration_ms: 100 },
    ]);

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.perStepHitRate["read"]).toEqual({ searches: 3, nonEmpty: 2, percent: 67 });
  });

  it("perStepHitRate: 'null' (4 chars, unparseable as array) treated as empty", async () => {
    writeRun(makeRun("run-hr-null"));
    writeTrace("run-hr-null", [
      { ts: "x", method: "memory_search", params: { tags: ["step:plan"] }, ok: true, response_summary: "null", duration_ms: 100 },
      { ts: "x", method: "memory_search", params: { tags: ["step:plan"] }, ok: true, response_summary: '[{"id":"x"}]', duration_ms: 100 },
    ]);

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.perStepHitRate["plan"]).toEqual({ searches: 2, nonEmpty: 1, percent: 50 });
  });

  it("perStepHitRate: multi-step distribution — each step independently bucketed", async () => {
    writeRun(makeRun("run-hr-multi"));
    const nonEmpty = '[{"id":"m"}]';
    writeTrace("run-hr-multi", [
      { ts: "x", method: "memory_search", params: { tags: ["step:read"] }, ok: true, response_summary: nonEmpty, duration_ms: 100 },
      { ts: "x", method: "memory_search", params: { tags: ["step:plan"] }, ok: true, response_summary: "[]", duration_ms: 100 },
      { ts: "x", method: "memory_search", params: { tags: ["step:plan"] }, ok: true, response_summary: nonEmpty, duration_ms: 100 },
      { ts: "x", method: "memory_search", params: { tags: ["step:coder"] }, ok: true, response_summary: "[]", duration_ms: 100 },
      { ts: "x", method: "memory_search", params: { tags: ["step:coder"] }, ok: true, response_summary: "[]", duration_ms: 100 },
    ]);

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.perStepHitRate["read"]).toEqual({ searches: 1, nonEmpty: 1, percent: 100 });
    expect(stats.perStepHitRate["plan"]).toEqual({ searches: 2, nonEmpty: 1, percent: 50 });
    expect(stats.perStepHitRate["coder"]).toEqual({ searches: 2, nonEmpty: 0, percent: 0 });
  });

  it("perStepHitRate: reads top-level event.step (Option B fix 2026-05-14)", async () => {
    writeRun(makeRun("run-step-field"));
    const nonEmpty = '[{"id":"m"}]';
    writeTrace("run-step-field", [
      { ts: "x", method: "memory_search", params: { tags: ["branch:main"] }, ok: true, response_summary: nonEmpty, duration_ms: 100, step: "read" },
      { ts: "x", method: "memory_search", params: { tags: ["branch:main"] }, ok: true, response_summary: "[]", duration_ms: 100, step: "read" },
      { ts: "x", method: "memory_search", params: { tags: ["branch:main"] }, ok: true, response_summary: nonEmpty, duration_ms: 100, step: "plan" },
    ]);

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.perStepHitRate["read"]).toEqual({ searches: 2, nonEmpty: 1, percent: 50 });
    expect(stats.perStepHitRate["plan"]).toEqual({ searches: 1, nonEmpty: 1, percent: 100 });
  });

  it("perStepHitRate: top-level step wins over legacy step:<name> tag", async () => {
    writeRun(makeRun("run-step-precedence"));
    writeTrace("run-step-precedence", [
      // event.step=read but tag says step:plan — top-level field wins
      { ts: "x", method: "memory_search", params: { tags: ["step:plan", "branch:main"] }, ok: true, response_summary: '[{"id":"m"}]', duration_ms: 100, step: "read" },
    ]);

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.perStepHitRate["read"]).toEqual({ searches: 1, nonEmpty: 1, percent: 100 });
    expect(stats.perStepHitRate["plan"]).toBeUndefined();
  });

  it("perStepHitRate: empty-string event.step falls back to legacy tag", async () => {
    writeRun(makeRun("run-step-empty"));
    writeTrace("run-step-empty", [
      { ts: "x", method: "memory_search", params: { tags: ["step:plan", "branch:main"] }, ok: true, response_summary: '[{"id":"m"}]', duration_ms: 100, step: "" },
    ]);

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.perStepHitRate["plan"]).toEqual({ searches: 1, nonEmpty: 1, percent: 100 });
  });

  it("perStepHitRate: searches without step tag are skipped, non-search methods ignored", async () => {
    writeRun(makeRun("run-hr-skip"));
    writeTrace("run-hr-skip", [
      { ts: "x", method: "memory_search", params: { tags: [] }, ok: true, response_summary: '[{"id":"x"}]', duration_ms: 100 },
      { ts: "x", method: "memory_search", params: {}, ok: true, response_summary: '[{"id":"x"}]', duration_ms: 100 },
      { ts: "x", method: "memory_store", params: { tags: ["step:code"] }, ok: true, response_summary: "{}", duration_ms: 100 },
      { ts: "x", method: "memory_judge", params: { tags: ["step:code"] }, ok: true, response_summary: "{}", duration_ms: 100 },
    ]);

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.perStepHitRate).toEqual({});
  });

  // -------------------------------------------------------------------------
  // missingStepComplete
  // -------------------------------------------------------------------------

  it("missingStepComplete: search > 0 + judge == 0 → affected", async () => {
    writeRun(makeRun("run-msc-1"));
    writeTrace("run-msc-1", [
      { ts: "x", method: "memory_search", params: { tags: ["step:read"] }, ok: true, response_summary: '[{"id":"x"}]', duration_ms: 100 },
      { ts: "x", method: "memory_search", params: { tags: ["step:read"] }, ok: true, response_summary: '[{"id":"y"}]', duration_ms: 100 },
    ]);

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.missingStepComplete.count).toBe(1);
    expect(stats.missingStepComplete.affectedRuns[0]).toEqual({
      runId: "run-msc-1",
      step: "read",
      searches: 2,
      judges: 0,
    });
    expect(stats.missingStepComplete.totalRuns).toBe(1);
  });

  it("missingStepComplete: search > 0 + judge > 0 → NOT affected", async () => {
    writeRun(makeRun("run-msc-ok"));
    writeTrace("run-msc-ok", [
      { ts: "x", method: "memory_search", params: { tags: ["step:read"] }, ok: true, response_summary: '[{"id":"x"}]', duration_ms: 100 },
      { ts: "x", method: "memory_judge", params: { tags: ["step:read"], memory_id: "x" }, ok: true, response_summary: "", duration_ms: 50 },
    ]);

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.missingStepComplete.count).toBe(0);
    expect(stats.missingStepComplete.affectedRuns).toEqual([]);
  });

  it("missingStepComplete: search returned zero results → NOT affected (no feedback expected)", async () => {
    writeRun(makeRun("run-msc-empty"));
    writeTrace("run-msc-empty", [
      { ts: "x", method: "memory_search", params: { tags: ["step:read"] }, ok: true, response_summary: "[]", duration_ms: 100 },
      { ts: "x", method: "memory_search", params: { tags: ["step:read"] }, ok: true, response_summary: "null", duration_ms: 100 },
    ]);

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.missingStepComplete.count).toBe(0);
  });

  it("missingStepComplete: multi-run aggregation + sort by runId desc", async () => {
    writeRun(makeRun("run-msc-A", { startedAt: "2026-05-11T10:00:00Z" }));
    writeRun(makeRun("run-msc-B", { startedAt: "2026-05-11T11:00:00Z" }));
    writeRun(makeRun("run-msc-C", { startedAt: "2026-05-11T12:00:00Z" }));
    const hit = '[{"id":"m"}]';
    writeTrace("run-msc-A", [
      { ts: "x", method: "memory_search", params: { tags: ["step:read"] }, ok: true, response_summary: hit, duration_ms: 100 },
    ]);
    writeTrace("run-msc-B", [
      { ts: "x", method: "memory_search", params: { tags: ["step:read"] }, ok: true, response_summary: hit, duration_ms: 100 },
      { ts: "x", method: "memory_search", params: { tags: ["step:plan"] }, ok: true, response_summary: hit, duration_ms: 100 },
    ]);
    writeTrace("run-msc-C", [
      { ts: "x", method: "memory_search", params: { tags: ["step:read"] }, ok: true, response_summary: hit, duration_ms: 100 },
      { ts: "x", method: "memory_judge", params: { tags: ["step:read"], memory_id: "m" }, ok: true, response_summary: "", duration_ms: 50 },
    ]);

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    // Affected: (A,read), (B,read), (B,plan). C judged — not affected.
    expect(stats.missingStepComplete.count).toBe(3);
    expect(stats.missingStepComplete.totalRuns).toBe(3);
    // Sort: runId desc → B, B, A. Within same runId: step asc → plan, read.
    expect(stats.missingStepComplete.affectedRuns.map((e) => `${e.runId}:${e.step}`)).toEqual([
      "run-msc-B:plan",
      "run-msc-B:read",
      "run-msc-A:read",
    ]);
  });

  // -------------------------------------------------------------------------
  // Integration: all 3 fields populated in collectEngramStats result
  // -------------------------------------------------------------------------

  it("collectEngramStats integration: returns 3 new fields with correct shape", async () => {
    writeRun(makeRun("run-int"));
    writeTrace("run-int", [
      { ts: "x", method: "memory_search", params: { tags: ["step:read"] }, ok: true, response_summary: '[{"id":"m1","memory_type":"pattern"}]', duration_ms: 100 },
    ]);

    const stats = await collectEngramStats(vaultPath, { skipLive: true });
    expect(stats.crossRunReuse).toEqual({ total: 1, reused: 0, percent: 0 });
    expect(stats.perStepHitRate["read"]).toEqual({ searches: 1, nonEmpty: 1, percent: 100 });
    expect(stats.missingStepComplete.count).toBe(1);
    expect(stats.missingStepComplete.totalRuns).toBe(1);
  });
});
