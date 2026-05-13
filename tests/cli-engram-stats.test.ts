import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { engramStats } from "../src/cli/engram-stats.js";

describe("engram-stats CLI — E2E", () => {
  let projectRoot: string;
  let vaultPath: string;
  let originalCwd: string;
  let originalEngramSocket: string | undefined;
  let logOutput: string[];
  let errOutput: string[];
  let origLog: typeof console.log;
  let origErr: typeof console.error;

  beforeEach(() => {
    originalEngramSocket = process.env["ENGRAM_SOCKET_PATH"];
    process.env["ENGRAM_SOCKET_PATH"] = "/tmp/no-such-engram-socket-isolated-test";
    originalCwd = process.cwd();
    projectRoot = mkdtempSync(join(tmpdir(), "cli-engram-stats-test-"));
    vaultPath = join(projectRoot, ".dev-vault");
    process.chdir(projectRoot);

    execFileSync("git", ["init", "-q"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: projectRoot });
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ name: "stats-test" }), "utf-8");

    mkdirSync(join(vaultPath, "workflow-state", "runs"), { recursive: true });

    logOutput = [];
    errOutput = [];
    origLog = console.log;
    origErr = console.error;
    console.log = ((msg: string = "") => { logOutput.push(String(msg)); return true; }) as typeof console.log;
    console.error = ((msg: string) => { errOutput.push(String(msg)); return true; }) as typeof console.error;
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origErr;
    process.chdir(originalCwd);
    rmSync(projectRoot, { recursive: true, force: true });
    process.exitCode = 0;
    if (originalEngramSocket === undefined) {
      delete process.env["ENGRAM_SOCKET_PATH"];
    } else {
      process.env["ENGRAM_SOCKET_PATH"] = originalEngramSocket;
    }
  });

  function logJoined(): string { return logOutput.join("\n"); }

  function writeMinimalRun(id: string, telemetry?: object): void {
    const run = {
      id,
      workflowName: "dev",
      taskId: null,
      taskDescription: "t",
      currentStep: "code",
      startedAt: "2026-05-11T10:00:00Z",
      completedAt: "2026-05-11T11:00:00Z",
      status: "completed",
      steps: {
        read: { status: "completed", output: null, startedAt: null, completedAt: null, durationMs: 100, attempt: 1, engramMemoryId: null, error: null },
      },
      telemetry: telemetry ?? { search: 5, store: 3, judge: 5, vaultRecord: 1, skipped: 0 },
    };
    writeFileSync(join(vaultPath, "workflow-state", "runs", `${id}.json`), JSON.stringify(run), "utf-8");
  }

  it("not-in-git-repo: error + exitCode=1", async () => {
    const nonGit = mkdtempSync(join(tmpdir(), "cli-engram-stats-non-git-"));
    process.chdir(nonGit);
    try {
      await engramStats([]);
      expect(process.exitCode).toBe(1);
      expect(errOutput.join("\n")).toContain("Not a git repository");
    } finally {
      process.chdir(projectRoot);
      rmSync(nonGit, { recursive: true, force: true });
    }
  });

  it("empty vault: 'No workflow runs found' message", async () => {
    await engramStats([]);
    expect(logJoined()).toContain("No workflow runs found");
  });

  it("with runs: pretty mode prints dashboard sections", async () => {
    writeMinimalRun("run-test-1");
    await engramStats([]);
    const out = logJoined();
    expect(out).toContain("Engram Dashboard");
    expect(out).toContain("Engram daemon:");
    expect(out).toContain("unavailable"); // socket stubbed
    expect(out).toContain("Recent runs (1)");
    expect(out).toContain("run-test-1");
  });

  it("--json mode: emits valid JSON with stable top-level keys", async () => {
    writeMinimalRun("run-json-1");
    await engramStats(["--json"]);
    const out = logJoined();
    const json = JSON.parse(out) as Record<string, unknown>;
    expect(json["scope"]).toBeDefined();
    expect(json["byMethod"]).toBeDefined();
    expect(json["byMemoryType"]).toBeDefined();
    expect(json["byStep"]).toBeDefined();
    expect(json["recentRuns"]).toBeDefined();
    expect(json["warnings"]).toBeDefined();
    expect(json["live"]).toBeDefined();
    const live = json["live"] as Record<string, unknown>;
    expect(live["health"]).toBeNull(); // engram socket stubbed
    expect(live["topMemories"]).toEqual([]);
  });

  it("--runs N: limits scope to N most recent runs", async () => {
    writeMinimalRun("run-1");
    // delay startedAt by writing manually
    const run2 = {
      id: "run-2",
      workflowName: "dev",
      taskId: null,
      taskDescription: "t",
      currentStep: "code",
      startedAt: "2026-05-11T11:00:00Z",
      completedAt: null,
      status: "running",
      steps: {},
      telemetry: { search: 0, store: 0, judge: 0, vaultRecord: 0, skipped: 0 },
    };
    writeFileSync(join(vaultPath, "workflow-state", "runs", "run-2.json"), JSON.stringify(run2), "utf-8");

    await engramStats(["--runs", "1", "--json"]);
    const json = JSON.parse(logJoined()) as { scope: { runCount: number }; recentRuns: Array<{ id: string }> };
    expect(json.scope.runCount).toBe(1);
    expect(json.recentRuns[0]!.id).toBe("run-2");
  });

  it("--runs with non-numeric arg: falls back to default 10", async () => {
    writeMinimalRun("run-x");
    await engramStats(["--runs", "notanumber", "--json"]);
    expect(process.exitCode).not.toBe(1);
    const json = JSON.parse(logJoined()) as { scope: { runCount: number } };
    expect(json.scope.runCount).toBe(1); // single existing run, default limit 10
  });

  it("warnings: store>0 + judge=0 produces missed-feedback warning", async () => {
    writeMinimalRun("run-warn", { search: 0, store: 12, judge: 0, vaultRecord: 0, skipped: 0 });
    await engramStats(["--json"]);
    const json = JSON.parse(logJoined()) as { warnings: Array<{ issue: string }> };
    expect(json.warnings.length).toBe(1);
    expect(json.warnings[0]!.issue).toContain("missed agent feedback");
  });

  it("with trace files: byMethod populated from trace JSONL", async () => {
    writeMinimalRun("run-trace");
    const traceContent = [
      JSON.stringify({ ts: "x", method: "memory_search", params: { tags: ["step:read"] }, ok: true, response_summary: "", duration_ms: 500 }),
      JSON.stringify({ ts: "x", method: "memory_store", params: { memory_type: "pattern", tags: ["step:read"] }, ok: true, response_summary: "", duration_ms: 200 }),
    ].join("\n");
    writeFileSync(join(vaultPath, "workflow-state", "runs", "run-trace.engram-trace.jsonl"), traceContent, "utf-8");

    await engramStats(["--json"]);
    const json = JSON.parse(logJoined()) as { byMethod: Record<string, { count: number }>; byMemoryType: Record<string, number>; byStep: Record<string, unknown> };
    expect(json.byMethod["memory_search"]?.count).toBe(1);
    expect(json.byMethod["memory_store"]?.count).toBe(1);
    expect(json.byMemoryType["pattern"]).toBe(1);
    expect(json.byStep["read"]).toBeDefined();
  });

  it("--json mode: includes crossRunReuse / perStepHitRate / missingStepComplete fields", async () => {
    writeMinimalRun("run-ext");
    const traceContent = [
      JSON.stringify({
        ts: "x",
        method: "memory_search",
        params: { tags: ["step:read"] },
        ok: true,
        response_summary: '[{"id":"m1","memory_type":"pattern"}]',
        duration_ms: 300,
      }),
    ].join("\n");
    writeFileSync(join(vaultPath, "workflow-state", "runs", "run-ext.engram-trace.jsonl"), traceContent, "utf-8");

    await engramStats(["--json"]);
    const json = JSON.parse(logJoined()) as {
      crossRunReuse: { total: number; reused: number; percent: number };
      perStepHitRate: Record<string, { searches: number; nonEmpty: number; percent: number }>;
      missingStepComplete: { totalRuns: number; affectedRuns: Array<{ runId: string; step: string }>; count: number };
    };
    expect(json.crossRunReuse).toEqual({ total: 1, reused: 0, percent: 0 });
    expect(json.perStepHitRate["read"]).toEqual({ searches: 1, nonEmpty: 1, percent: 100 });
    expect(json.missingStepComplete.count).toBe(1);
    expect(json.missingStepComplete.affectedRuns[0]?.runId).toBe("run-ext");
    expect(json.missingStepComplete.affectedRuns[0]?.step).toBe("read");
  });

  it("pretty mode: renders 3 new sections when non-empty, skips when empty", async () => {
    writeMinimalRun("run-pretty-A", { search: 0, store: 0, judge: 0, vaultRecord: 0, skipped: 0 });
    // Build a trace with cross-run reuse + perStepHitRate + missing-step-complete signals.
    // Two runs so cross-run reuse triggers.
    const traceA = [
      JSON.stringify({
        ts: "x",
        method: "memory_search",
        params: { tags: ["step:read"] },
        ok: true,
        response_summary: '[{"id":"mem-x","memory_type":"pattern"}]',
        duration_ms: 200,
      }),
    ].join("\n");
    writeFileSync(join(vaultPath, "workflow-state", "runs", "run-pretty-A.engram-trace.jsonl"), traceA, "utf-8");

    const run2 = {
      id: "run-pretty-B",
      workflowName: "dev",
      taskId: null,
      taskDescription: "t",
      currentStep: "code",
      startedAt: "2026-05-11T12:00:00Z",
      completedAt: "2026-05-11T13:00:00Z",
      status: "completed",
      steps: {
        code: { status: "completed", output: null, startedAt: null, completedAt: null, durationMs: 100, attempt: 1, engramMemoryId: null, error: null },
      },
      telemetry: { search: 0, store: 0, judge: 1, vaultRecord: 0, skipped: 0 },
    };
    writeFileSync(join(vaultPath, "workflow-state", "runs", "run-pretty-B.json"), JSON.stringify(run2), "utf-8");
    const traceB = [
      JSON.stringify({
        ts: "x",
        method: "memory_judge",
        params: { tags: ["step:code"], memory_id: "mem-x", score: 0.9 },
        ok: true,
        response_summary: "",
        duration_ms: 50,
      }),
    ].join("\n");
    writeFileSync(join(vaultPath, "workflow-state", "runs", "run-pretty-B.engram-trace.jsonl"), traceB, "utf-8");

    await engramStats([]);
    const out = logJoined();
    expect(out).toContain("Cross-run memory reuse:");
    expect(out).toContain("1/1 pattern/antipattern memories");
    expect(out).toContain("Search hit rate by step:");
    expect(out).toContain("read");
    expect(out).toContain("Missing feedback loop");
    expect(out).toContain("run-pretty-A");
  });
});
