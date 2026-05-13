import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ProjectContext } from "../src/lib/types.js";
import { ToolHandlers } from "../src/mcp/handlers.js";
import { VaultReader } from "../src/lib/reader.js";
import { VaultWriter } from "../src/lib/writer.js";
import { AgentRegistry } from "../src/agents/registry.js";
import { AgentContextBuilder } from "../src/agents/context-builder.js";
import { TaskManager } from "../src/tasks/manager.js";
import { TaskTracker } from "../src/tasks/tracker.js";
import { WorkflowState } from "../src/workflow/state.js";

interface WorkflowStartResult {
  runId: string;
  traceFilePath: string;
}

function createTestContext(): { context: ProjectContext; projectRoot: string } {
  const projectRoot = join(tmpdir(), `step-start-test-${Date.now()}-${Math.random()}`);
  const vaultPath = join(projectRoot, ".dev-vault");
  mkdirSync(vaultPath, { recursive: true });
  return {
    projectRoot,
    context: {
      projectName: "test-project",
      branch: "feature-x",
      parentBranch: "main",
      vaultPath,
      projectRoot,
      gitRemote: null,
    },
  };
}

function createHandlers(context: ProjectContext): ToolHandlers {
  const writer = new VaultWriter(context);
  writer.scaffold();
  const reader = new VaultReader(context);
  const registry = new AgentRegistry(join(context.projectRoot, "agents-stub"));
  const contextBuilder = new AgentContextBuilder(reader, context);
  const taskManager = new TaskManager(context.vaultPath);
  const taskTracker = new TaskTracker(context.projectRoot, taskManager);
  return new ToolHandlers(
    reader, writer, context, registry, contextBuilder, taskManager, taskTracker,
  );
}

describe("step_start MCP handler", () => {
  let projectRoot: string;
  let context: ProjectContext;
  let handlers: ToolHandlers;
  let originalTraceFile: string | undefined;
  let originalRunId: string | undefined;

  beforeEach(() => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    context = env.context;
    handlers = createHandlers(context);
    originalTraceFile = process.env["ENGRAM_TRACE_FILE"];
    originalRunId = process.env["ENGRAM_RUN_ID"];
    delete process.env["ENGRAM_TRACE_FILE"];
    delete process.env["ENGRAM_RUN_ID"];
  });

  afterEach(() => {
    if (originalTraceFile === undefined) delete process.env["ENGRAM_TRACE_FILE"];
    else process.env["ENGRAM_TRACE_FILE"] = originalTraceFile;
    if (originalRunId === undefined) delete process.env["ENGRAM_RUN_ID"];
    else process.env["ENGRAM_RUN_ID"] = originalRunId;
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  async function startRun(): Promise<string> {
    const result = await handlers.handle("workflow_start", {
      workflowName: "dev",
      taskDescription: "step-start test",
    }) as WorkflowStartResult;
    // workflow_start sets ENGRAM_RUN_ID — clear it so each test opts in
    // explicitly (either via param or by re-setting env).
    delete process.env["ENGRAM_RUN_ID"];
    return result.runId;
  }

  it("happy path: explicit runId + valid stepName updates currentStep and returns {ok: true}", async () => {
    const runId = await startRun();

    const result = await handlers.handle("step_start", {
      stepName: "plan",
      runId,
    });

    expect(result).toEqual({ ok: true });

    const state = new WorkflowState(context.vaultPath);
    const run = state.load(runId);
    expect(run.currentStep).toBe("plan");
  });

  it("uses ENGRAM_RUN_ID env when runId param omitted", async () => {
    const runId = await startRun();
    process.env["ENGRAM_RUN_ID"] = runId;

    const result = await handlers.handle("step_start", {
      stepName: "review",
    });

    expect(result).toEqual({ ok: true });

    const state = new WorkflowState(context.vaultPath);
    const run = state.load(runId);
    expect(run.currentStep).toBe("review");
  });

  it("throws E003 when no runId param and ENGRAM_RUN_ID unset", async () => {
    await startRun();
    expect(process.env["ENGRAM_RUN_ID"]).toBeUndefined();

    await expect(handlers.handle("step_start", {
      stepName: "plan",
    })).rejects.toThrow(/E003/);
  });

  it.each([
    ["uppercase prefix", "RUN-abcdef012345"],
    ["wrong prefix", "task-abcdef012345"],
    ["non-hex char", "run-abcdefg12345"],
    ["short hex tail", "run-abc123"],
    ["long hex tail", "run-abcdef0123456789"],
    ["empty string", ""],
    ["plain string", "not-a-run-id"],
  ])("throws E002 when runId has invalid format (%s)", async (_label, runId) => {
    await expect(handlers.handle("step_start", {
      stepName: "plan",
      runId,
    })).rejects.toThrow(/E002/);
  });

  it.each([
    ["empty string", ""],
    ["uppercase first char", "Plan"],
    ["embedded uppercase", "plan_FIX"],
    ["dot separator", "plan.review"],
    ["slash separator", "plan/review"],
    ["space separator", "plan review"],
    ["leading dash", "-plan"],
    ["over 64 chars", "step-with-very-long-name-that-exceeds-the-sixty-four-character-limit-here"],
    ["non-string (number)", 42 as unknown as string],
    ["non-string (null)", null as unknown as string],
  ])("throws E001 when stepName is invalid (%s)", async (_label, stepName) => {
    const runId = await startRun();
    await expect(handlers.handle("step_start", {
      stepName,
      runId,
    })).rejects.toThrow(/E001/);
  });

  it.each([
    ["single char", "a"],
    ["digit first", "0step"],
    ["with underscore", "plan_fix"],
    ["with dash", "plan-review"],
    ["max length (64 chars)", "a".repeat(64)],
  ])("accepts valid stepName (%s)", async (_label, stepName) => {
    const runId = await startRun();
    const result = await handlers.handle("step_start", {
      stepName,
      runId,
    });
    expect(result).toEqual({ ok: true });

    const state = new WorkflowState(context.vaultPath);
    const run = state.load(runId);
    expect(run.currentStep).toBe(stepName);
  });

  it("throws E004 when runId points to non-existent run", async () => {
    // Valid format but no state file persisted.
    await expect(handlers.handle("step_start", {
      stepName: "plan",
      runId: "run-abcdef012345",
    })).rejects.toThrow(/E004.*run-abcdef012345/);
  });

  it("currentStep persists across reload via WorkflowState.load", async () => {
    const runId = await startRun();

    const state = new WorkflowState(context.vaultPath);
    const before = state.load(runId);
    const initialStep = before.currentStep;
    expect(initialStep).toBe("preflight"); // dev workflow first step

    await handlers.handle("step_start", {
      stepName: "code",
      runId,
    });

    const after = state.load(runId);
    expect(after.currentStep).toBe("code");
    expect(after.currentStep).not.toBe(initialStep);

    // Other fields are preserved — only currentStep mutates.
    expect(after.id).toBe(before.id);
    expect(after.workflowName).toBe(before.workflowName);
    expect(after.startedAt).toBe(before.startedAt);
    expect(Object.keys(after.steps)).toEqual(Object.keys(before.steps));
  });

  it("explicit runId takes priority over ENGRAM_RUN_ID env", async () => {
    const runId = await startRun();
    // Set env to a different (invalid) runId — explicit param must win.
    process.env["ENGRAM_RUN_ID"] = "run-ffffffffffff";

    const result = await handlers.handle("step_start", {
      stepName: "verify",
      runId,
    });

    expect(result).toEqual({ ok: true });
    const state = new WorkflowState(context.vaultPath);
    const run = state.load(runId);
    expect(run.currentStep).toBe("verify");
  });
});
