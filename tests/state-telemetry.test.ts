import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkflowState } from "../src/workflow/state.js";
import type { WorkflowRun } from "../src/workflow/types.js";

function makeRun(id: string, overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id,
    workflowName: "dev",
    taskId: null,
    taskDescription: "test",
    phase: null,
    currentStep: "plan",
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: "running",
    steps: {},
    ...overrides,
  };
}

describe("WorkflowState.bumpTelemetry", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "wf-telemetry-"));
    mkdirSync(join(vaultPath, "workflow-state", "runs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("initializes telemetry counters to zero when undefined and increments the requested kind", () => {
    const state = new WorkflowState(vaultPath);
    const run = makeRun("run-001");
    state.save(run);

    state.bumpTelemetry("run-001", "search");

    const reloaded = state.load("run-001");
    expect(reloaded.telemetry).toEqual({
      search: 1,
      store: 0,
      judge: 0,
      vaultRecord: 0,
      skipped: 0,
    });
  });

  it("increments existing counter and persists across calls", () => {
    const state = new WorkflowState(vaultPath);
    state.save(makeRun("run-002"));

    state.bumpTelemetry("run-002", "store");
    state.bumpTelemetry("run-002", "store");
    state.bumpTelemetry("run-002", "store");
    state.bumpTelemetry("run-002", "judge");

    const reloaded = state.load("run-002");
    expect(reloaded.telemetry).toEqual({
      search: 0,
      store: 3,
      judge: 1,
      vaultRecord: 0,
      skipped: 0,
    });
  });

  it("supports custom increment amount", () => {
    const state = new WorkflowState(vaultPath);
    state.save(makeRun("run-003"));

    state.bumpTelemetry("run-003", "vaultRecord", 5);

    expect(state.load("run-003").telemetry?.vaultRecord).toBe(5);
  });

  it("silent no-op when run file does not exist", () => {
    const state = new WorkflowState(vaultPath);

    expect(() => state.bumpTelemetry("missing-run", "search")).not.toThrow();
  });

  it("silent no-op when run JSON is corrupt", () => {
    writeFileSync(
      join(vaultPath, "workflow-state", "runs", "run-bad.json"),
      "{ this is not json",
      "utf-8",
    );

    const state = new WorkflowState(vaultPath);
    expect(() => state.bumpTelemetry("run-bad", "search")).not.toThrow();
    // File untouched
    expect(readFileSync(join(vaultPath, "workflow-state", "runs", "run-bad.json"), "utf-8")).toBe("{ this is not json");
  });

  it("preserves existing telemetry across bumps", () => {
    const state = new WorkflowState(vaultPath);
    const run = makeRun("run-004", {
      telemetry: { search: 10, store: 5, judge: 2, vaultRecord: 1, skipped: 0 },
    });
    state.save(run);

    state.bumpTelemetry("run-004", "skipped");

    expect(state.load("run-004").telemetry).toEqual({
      search: 10,
      store: 5,
      judge: 2,
      vaultRecord: 1,
      skipped: 1,
    });
  });

  it("sequential bumps remain consistent (sync I/O atomicity)", () => {
    const state = new WorkflowState(vaultPath);
    state.save(makeRun("run-005"));

    // Simulate burst of bumps — sync I/O within Node single-threaded model
    // guarantees no interleaving between read and write.
    for (let i = 0; i < 50; i++) {
      state.bumpTelemetry("run-005", "search");
    }

    expect(state.load("run-005").telemetry?.search).toBe(50);
  });
});
