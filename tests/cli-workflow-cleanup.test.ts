import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runWorkflowCleanup } from "../src/cli/workflow-cleanup.js";
import type { WorkflowRun, WorkflowStatus } from "../src/workflow/types.js";

function makeRun(overrides: Partial<WorkflowRun> & { id: string; startedAt: string; status: WorkflowStatus }): WorkflowRun {
  return {
    workflowName: "dev",
    taskId: null,
    taskDescription: "test",
    phase: null,
    currentStep: "read",
    completedAt: null,
    steps: {},
    ...overrides,
  };
}

describe("dev-workflow workflow cleanup", () => {
  let vaultPath: string;
  let runsDir: string;
  let logOutput: string[];
  let errOutput: string[];
  let origLog: typeof console.log;
  let origErr: typeof console.error;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "workflow-cleanup-test-"));
    runsDir = join(vaultPath, "workflow-state", "runs");
    mkdirSync(runsDir, { recursive: true });
    logOutput = [];
    errOutput = [];
    origLog = console.log;
    origErr = console.error;
    console.log = ((msg: string) => { logOutput.push(String(msg)); return true; }) as typeof console.log;
    console.error = ((msg: string) => { errOutput.push(String(msg)); return true; }) as typeof console.error;
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origErr;
    rmSync(vaultPath, { recursive: true, force: true });
    process.exitCode = 0;
  });

  function writeRun(run: WorkflowRun): void {
    writeFileSync(join(runsDir, `${run.id}.json`), JSON.stringify(run, null, 2), "utf-8");
  }

  function readRun(id: string): WorkflowRun {
    return JSON.parse(readFileSync(join(runsDir, `${id}.json`), "utf-8")) as WorkflowRun;
  }

  function isoOffset(hoursAgo: number): string {
    return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  }

  it("marks stale paused/running runs as aborted by default", () => {
    writeRun(makeRun({ id: "run-old1", status: "paused", startedAt: isoOffset(48) }));
    writeRun(makeRun({ id: "run-old2", status: "running", startedAt: isoOffset(72) }));

    runWorkflowCleanup([], vaultPath);

    expect(process.exitCode).not.toBe(1);
    expect(readRun("run-old1").status).toBe("aborted");
    expect(readRun("run-old1").completedAt).not.toBeNull();
    expect(readRun("run-old1").abortReason).toContain("auto-aborted");
    expect(readRun("run-old2").status).toBe("aborted");
    expect(logOutput.join("\n")).toContain("2 run(s) marked aborted");
  });

  it("--dry-run lists candidates without modifying files", () => {
    writeRun(makeRun({ id: "run-stale", status: "paused", startedAt: isoOffset(48) }));

    runWorkflowCleanup(["--dry-run"], vaultPath);

    expect(readRun("run-stale").status).toBe("paused"); // unchanged
    expect(readRun("run-stale").completedAt).toBeNull();
    const log = logOutput.join("\n");
    expect(log).toContain("Would affect 1 run(s)");
    expect(log).toContain("run-stale");
    expect(log).toContain("(dry-run)");
  });

  it("--delete removes run JSON and associated trace file", () => {
    const tracePath = join(runsDir, "run-trash.engram-trace.jsonl");
    writeRun(makeRun({ id: "run-trash", status: "paused", startedAt: isoOffset(48) }));
    writeFileSync(tracePath, '{"ts":"x","method":"memory_search"}\n', "utf-8");

    runWorkflowCleanup(["--delete"], vaultPath);

    expect(existsSync(join(runsDir, "run-trash.json"))).toBe(false);
    expect(existsSync(tracePath)).toBe(false);
    expect(logOutput.join("\n")).toContain("1 run(s) deleted");
  });

  it("--delete works even when trace file is absent", () => {
    writeRun(makeRun({ id: "run-no-trace", status: "running", startedAt: isoOffset(48) }));

    runWorkflowCleanup(["--delete"], vaultPath);

    expect(existsSync(join(runsDir, "run-no-trace.json"))).toBe(false);
    expect(process.exitCode).not.toBe(1);
  });

  it("skips runs younger than threshold", () => {
    writeRun(makeRun({ id: "run-fresh", status: "paused", startedAt: isoOffset(2) }));
    writeRun(makeRun({ id: "run-old", status: "paused", startedAt: isoOffset(48) }));

    runWorkflowCleanup([], vaultPath);

    expect(readRun("run-fresh").status).toBe("paused"); // unchanged — too young
    expect(readRun("run-old").status).toBe("aborted");
  });

  it("--older-than overrides the default threshold", () => {
    writeRun(makeRun({ id: "run-2h", status: "paused", startedAt: isoOffset(2) }));
    writeRun(makeRun({ id: "run-30m-young", status: "paused", startedAt: isoOffset(0.5) }));

    runWorkflowCleanup(["--older-than", "1h"], vaultPath);

    expect(readRun("run-2h").status).toBe("aborted");
    expect(readRun("run-30m-young").status).toBe("paused");
  });

  it("--older-than accepts <N>d unit", () => {
    writeRun(makeRun({ id: "run-3d", status: "paused", startedAt: isoOffset(72) }));
    writeRun(makeRun({ id: "run-1d", status: "paused", startedAt: isoOffset(24) }));

    runWorkflowCleanup(["--older-than", "2d"], vaultPath);

    expect(readRun("run-3d").status).toBe("aborted");
    expect(readRun("run-1d").status).toBe("paused");
  });

  it("rejects malformed --older-than with E001 and exit 1", () => {
    runWorkflowCleanup(["--older-than", "5xyz"], vaultPath);
    expect(process.exitCode).toBe(1);
    expect(errOutput.join("\n")).toContain("E001");
    expect(errOutput.join("\n")).toContain("Usage:");
  });

  it("--status filter respects terminal statuses (completed/failed untouched)", () => {
    writeRun(makeRun({ id: "run-done", status: "completed", startedAt: isoOffset(48), completedAt: isoOffset(40) }));
    writeRun(makeRun({ id: "run-fail", status: "failed", startedAt: isoOffset(48) }));
    writeRun(makeRun({ id: "run-paused", status: "paused", startedAt: isoOffset(48) }));

    runWorkflowCleanup([], vaultPath);

    expect(readRun("run-done").status).toBe("completed");
    expect(readRun("run-fail").status).toBe("failed");
    expect(readRun("run-paused").status).toBe("aborted");
  });

  it("--status running only targets running, leaves paused untouched", () => {
    writeRun(makeRun({ id: "run-running", status: "running", startedAt: isoOffset(48) }));
    writeRun(makeRun({ id: "run-paused", status: "paused", startedAt: isoOffset(48) }));

    runWorkflowCleanup(["--status", "running"], vaultPath);

    expect(readRun("run-running").status).toBe("aborted");
    expect(readRun("run-paused").status).toBe("paused");
  });

  it("rejects unknown status with E001", () => {
    runWorkflowCleanup(["--status", "running,nonsense"], vaultPath);
    expect(process.exitCode).toBe(1);
    expect(errOutput.join("\n")).toContain("unknown status \"nonsense\"");
  });

  it("idempotent — re-running on already-aborted runs is a no-op (status filter excludes aborted by default)", () => {
    writeRun(makeRun({ id: "run-was-aborted", status: "aborted", startedAt: isoOffset(48), completedAt: isoOffset(24), abortReason: "previous run" }));

    runWorkflowCleanup([], vaultPath);

    // aborted is not in default --status filter, so untouched
    expect(readRun("run-was-aborted").status).toBe("aborted");
    expect(readRun("run-was-aborted").abortReason).toBe("previous run"); // not overwritten
    expect(logOutput.join("\n")).toContain("No stale runs found.");
  });

  it("rejects unknown flag with E001 and usage", () => {
    runWorkflowCleanup(["--unknown-flag"], vaultPath);
    expect(process.exitCode).toBe(1);
    expect(errOutput.join("\n")).toContain("unknown flag");
    expect(errOutput.join("\n")).toContain("Usage:");
  });

  it("rejects --dry-run combined with --delete", () => {
    runWorkflowCleanup(["--dry-run", "--delete"], vaultPath);
    expect(process.exitCode).toBe(1);
    expect(errOutput.join("\n")).toContain("mutually exclusive");
  });
});
