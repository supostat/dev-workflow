import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import type { StepState, WorkflowRun } from "../src/workflow/types.js";

const RUNID_PATTERN = /^run-[a-f0-9]{12}$/;

interface WorkflowStartResult {
  runId: string;
  traceFilePath: string;
}

function createTestContext(): { context: ProjectContext; projectRoot: string } {
  const projectRoot = join(tmpdir(), `wf-start-test-${Date.now()}-${Math.random()}`);
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

describe("workflow_start MCP handler", () => {
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

  it("happy path: returns runId + traceFilePath matching prefixed-hex pattern", async () => {
    const result = await handlers.handle("workflow_start", {
      workflowName: "dev",
      taskDescription: "implement feature X",
    }) as WorkflowStartResult;

    expect(result.runId).toMatch(RUNID_PATTERN);
    expect(result.traceFilePath).toBe(
      join(context.vaultPath, "workflow-state", "runs", `${result.runId}.engram-trace.jsonl`),
    );
  });

  it("persists state file at <vault>/workflow-state/runs/run-<12hex>.json with all 10 WorkflowRun fields", async () => {
    const result = await handlers.handle("workflow_start", {
      workflowName: "dev",
      taskDescription: "test task",
    }) as WorkflowStartResult;

    const expectedPath = join(
      context.vaultPath, "workflow-state", "runs", `${result.runId}.json`,
    );
    expect(existsSync(expectedPath)).toBe(true);

    const loaded = JSON.parse(readFileSync(expectedPath, "utf-8")) as WorkflowRun;
    const state = new WorkflowState(context.vaultPath);
    const workflow = state.load(result.runId);

    // 1. id matches generated runId
    expect(loaded.id).toBe(result.runId);
    // 2. workflowName
    expect(loaded.workflowName).toBe("dev");
    // 3. taskId is null when not supplied
    expect(loaded.taskId).toBeNull();
    // 4. taskDescription mirrors input
    expect(loaded.taskDescription).toBe("test task");
    // 5. phase is null — test fixture has no gameplan.md
    expect(loaded.phase).toBeNull();
    // 6. currentStep is the first step of the resolved workflow ('preflight' for dev)
    expect(loaded.currentStep).toBe("preflight");
    // 7. startedAt is an ISO 8601 string
    expect(loaded.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isFinite(Date.parse(loaded.startedAt))).toBe(true);
    // 8. completedAt is null on a fresh run
    expect(loaded.completedAt).toBeNull();
    // 9. status is "running"
    expect(loaded.status).toBe("running");
    // 10. steps is an object with one entry per workflow step
    const stepCount = Object.keys(workflow.steps).length;
    expect(stepCount).toBeGreaterThan(0);
    expect(Object.keys(loaded.steps)).toHaveLength(stepCount);
  });

  it("sets ENGRAM_TRACE_FILE env var when unset", async () => {
    const result = await handlers.handle("workflow_start", {
      workflowName: "dev",
      taskDescription: "trace env test",
    }) as WorkflowStartResult;

    expect(process.env["ENGRAM_TRACE_FILE"]).toBe(result.traceFilePath);
  });

  it("repoints ENGRAM_TRACE_FILE to the new run even when already set", async () => {
    // The MCP server is long-lived and serves sequential runs. Each
    // workflow_start MUST repoint the trace env to its own run; a stale
    // preset (left by an earlier run) would otherwise capture this run's
    // trace events into the wrong .engram-trace.jsonl.
    process.env["ENGRAM_TRACE_FILE"] = "/tmp/preset-trace-file.jsonl";

    const result = await handlers.handle("workflow_start", {
      workflowName: "dev",
      taskDescription: "repoint env",
    }) as WorkflowStartResult;

    expect(process.env["ENGRAM_TRACE_FILE"]).toBe(result.traceFilePath);
  });

  it("sets ENGRAM_RUN_ID env var to the generated runId", async () => {
    const result = await handlers.handle("workflow_start", {
      workflowName: "dev",
      taskDescription: "run-id env test",
    }) as WorkflowStartResult;

    expect(process.env["ENGRAM_RUN_ID"]).toBe(result.runId);
  });

  it("repoints ENGRAM_RUN_ID to the new run even when already set", async () => {
    process.env["ENGRAM_RUN_ID"] = "run-0000deadbeef";

    const result = await handlers.handle("workflow_start", {
      workflowName: "dev",
      taskDescription: "repoint runid env",
    }) as WorkflowStartResult;

    expect(process.env["ENGRAM_RUN_ID"]).toBe(result.runId);
  });

  it("sequential runs each repoint trace env to their own run", async () => {
    // Regression guard: the original `if (!process.env[...])` guard left every
    // run after the first writing trace events into run #1's file. Each
    // workflow_start in the same process must supersede the previous run.
    const first = await handlers.handle("workflow_start", {
      workflowName: "dev",
      taskDescription: "first sequential run",
    }) as WorkflowStartResult;
    expect(process.env["ENGRAM_TRACE_FILE"]).toBe(first.traceFilePath);
    expect(process.env["ENGRAM_RUN_ID"]).toBe(first.runId);

    const second = await handlers.handle("workflow_start", {
      workflowName: "dev",
      taskDescription: "second sequential run",
    }) as WorkflowStartResult;

    expect(second.runId).not.toBe(first.runId);
    expect(second.traceFilePath).not.toBe(first.traceFilePath);
    expect(process.env["ENGRAM_TRACE_FILE"]).toBe(second.traceFilePath);
    expect(process.env["ENGRAM_RUN_ID"]).toBe(second.runId);
  });

  it("WorkflowRun.currentStep equals the first step name in the workflow", async () => {
    const result = await handlers.handle("workflow_start", {
      workflowName: "dev",
      taskDescription: "first step test",
    }) as WorkflowStartResult;

    const state = new WorkflowState(context.vaultPath);
    const run = state.load(result.runId);
    // dev.yaml first step is 'preflight'
    expect(run.currentStep).toBe("preflight");
  });

  it("initializes every step's StepState with all 8 fields", async () => {
    const result = await handlers.handle("workflow_start", {
      workflowName: "dev",
      taskDescription: "step init test",
    }) as WorkflowStartResult;

    const state = new WorkflowState(context.vaultPath);
    const run = state.load(result.runId);
    const stepNames = Object.keys(run.steps);
    expect(stepNames.length).toBeGreaterThan(0);

    for (const stepName of stepNames) {
      const step: StepState = run.steps[stepName]!;
      expect(step.status).toBe("pending");
      expect(step.output).toBeNull();
      expect(step.startedAt).toBeNull();
      expect(step.completedAt).toBeNull();
      expect(step.durationMs).toBeNull();
      expect(step.attempt).toBe(0);
      expect(step.engramMemoryId).toBeNull();
      expect(step.error).toBeNull();
    }
  });

  // Multiple bypass attempts: each must be rejected at the validator boundary
  // before reaching resolveWorkflow / state persistence.
  it.each([
    ["uppercase-first", "Test"],
    ["embedded uppercase", "Invalid_Name"],
    ["dot separator", "test.workflow"],
    ["slash separator", "test/workflow"],
    ["space separator", "test workflow"],
    ["empty string", ""],
    ["leading dash", "-test"],
    ["over 64 chars", "test-with-very-long-name-that-exceeds-the-sixty-four-character-limit-here"],
  ])("invalid workflowName (%s) throws E001", async (_label, workflowName) => {
    await expect(handlers.handle("workflow_start", {
      workflowName,
      taskDescription: "x",
    })).rejects.toThrow(/E001/);
  });

  it("unknown workflow throws E004", async () => {
    await expect(handlers.handle("workflow_start", {
      workflowName: "nonexistent-workflow",
      taskDescription: "x",
    })).rejects.toThrow(/E004/);
  });

  it("empty taskDescription throws E002", async () => {
    await expect(handlers.handle("workflow_start", {
      workflowName: "dev",
      taskDescription: "   ",
    })).rejects.toThrow(/E002/);
  });

  it("taskId optional: present and valid → set on run; absent → null", async () => {
    const withTask = await handlers.handle("workflow_start", {
      workflowName: "dev",
      taskDescription: "with task",
      taskId: "task-021",
    }) as WorkflowStartResult;
    const state = new WorkflowState(context.vaultPath);
    const runWith = state.load(withTask.runId);
    expect(runWith.taskId).toBe("task-021");

    const withoutTask = await handlers.handle("workflow_start", {
      workflowName: "dev",
      taskDescription: "without task",
    }) as WorkflowStartResult;
    const runWithout = state.load(withoutTask.runId);
    expect(runWithout.taskId).toBeNull();
  });

  // TASK_ID_PATTERN = /^task-\d{3,}$/ — every bypass attempt must reject.
  it.each([
    ["only 2 digits", "task-12"],
    ["leading zero, 2 digits", "task-01"],
    ["uppercase prefix", "TASK-001"],
    ["no dash separator", "task001"],
    ["wrong prefix", "tsk-001"],
    ["dash without digits", "task-"],
    ["non-digit suffix", "task-abc"],
    ["legacy bad-id literal", "bad-id"],
  ])("invalid taskId (%s) throws E003", async (_label, taskId) => {
    await expect(handlers.handle("workflow_start", {
      workflowName: "dev",
      taskDescription: "x",
      taskId,
    })).rejects.toThrow(/E003/);
  });

  it("state.list() reads new dir (workflow-state/runs) and finds the run", async () => {
    const result = await handlers.handle("workflow_start", {
      workflowName: "dev",
      taskDescription: "list test",
    }) as WorkflowStartResult;

    const state = new WorkflowState(context.vaultPath);
    const all = state.list();
    expect(all.some((r) => r.id === result.runId)).toBe(true);
  });

  it("minimal workflow with a single step initializes one StepState entry", async () => {
    // Custom workflow YAML in the vault — resolveWorkflow checks vault first
    // (src/cli/run.ts:144-152), so this shadows any same-named template/builtin.
    const workflowsDir = join(context.vaultPath, "workflows");
    mkdirSync(workflowsDir, { recursive: true });
    writeFileSync(join(workflowsDir, "solo.yaml"), `name: solo
description: Single-step minimal workflow
steps:
  - name: only-step
    agent: reader
`, "utf-8");

    const result = await handlers.handle("workflow_start", {
      workflowName: "solo",
      taskDescription: "single step run",
    }) as WorkflowStartResult;

    const state = new WorkflowState(context.vaultPath);
    const run = state.load(result.runId);

    expect(Object.keys(run.steps)).toHaveLength(1);
    expect(run.currentStep).toBe("only-step");
    const step: StepState = run.steps["only-step"]!;
    expect(step.status).toBe("pending");
    expect(step.output).toBeNull();
    expect(step.startedAt).toBeNull();
    expect(step.completedAt).toBeNull();
    expect(step.durationMs).toBeNull();
    expect(step.attempt).toBe(0);
    expect(step.engramMemoryId).toBeNull();
    expect(step.error).toBeNull();
  });

  it("workflow without 'match' field resolves and sets currentStep correctly", async () => {
    // Builtin/template workflows like 'dev' and 'hotfix' typically omit `match:`
    // (intake.yaml owns routing). Verify resolution succeeds and the resolved
    // definition truly has an empty match array — guards against accidental
    // hard-dependence on the field.
    const { resolveWorkflow } = await import("../src/workflow/resolver.js");
    const resolved = resolveWorkflow("hotfix", context.vaultPath);
    expect(resolved.match).toEqual([]);

    const result = await handlers.handle("workflow_start", {
      workflowName: "hotfix",
      taskDescription: "no-match-field run",
    }) as WorkflowStartResult;

    const state = new WorkflowState(context.vaultPath);
    const run = state.load(result.runId);
    expect(run.workflowName).toBe("hotfix");
    expect(run.currentStep).toBe(resolved.steps[0]!.name);
  });

  // task-023 (ADR 2026-05-13): WorkflowRun.phase snapshot
  it("populates run.phase from gameplan.md frontmatter (current-phase field)", async () => {
    // Overwrite the scaffold gameplan with frontmatter declaring the phase.
    writeFileSync(join(context.vaultPath, "gameplan.md"), `---
current-phase: engram-hardening
tags: [gameplan]
---
# Gameplan
`, "utf-8");

    const result = await handlers.handle("workflow_start", {
      workflowName: "dev",
      taskDescription: "phase snapshot test",
    }) as WorkflowStartResult;

    const state = new WorkflowState(context.vaultPath);
    const run = state.load(result.runId);
    expect(run.phase).toBe("engram-hardening");
  });

  it("populates run.phase from gameplan.md body marker when frontmatter absent", async () => {
    writeFileSync(join(context.vaultPath, "gameplan.md"), `---
tags: [gameplan]
---
# Gameplan

## Current Phase

**Active: \`fallback-phase\`** — body marker only
`, "utf-8");

    const result = await handlers.handle("workflow_start", {
      workflowName: "dev",
      taskDescription: "phase body fallback",
    }) as WorkflowStartResult;

    const state = new WorkflowState(context.vaultPath);
    const run = state.load(result.runId);
    expect(run.phase).toBe("fallback-phase");
  });

  it("run.phase is null when frontmatter has current-phase: null sentinel (no body fallback)", async () => {
    // Integration coverage for parseGameplanPhase null-literal handling at the
    // workflow_start handler boundary. Body marker is present but MUST be
    // ignored — the sentinel signals authoritative intent to clear phase.
    writeFileSync(join(context.vaultPath, "gameplan.md"), `---
current-phase: null
tags: [gameplan]
---
## Current Phase

**Active: \`body-should-not-leak\`** — must not be used
`, "utf-8");

    const result = await handlers.handle("workflow_start", {
      workflowName: "dev",
      taskDescription: "null sentinel integration test",
    }) as WorkflowStartResult;

    const state = new WorkflowState(context.vaultPath);
    const run = state.load(result.runId);
    expect(run.phase).toBeNull();
  });

  it("run.phase is null when frontmatter has current-phase: ~ (YAML tilde sentinel, no body fallback)", async () => {
    writeFileSync(join(context.vaultPath, "gameplan.md"), `---
current-phase: ~
tags: [gameplan]
---
**Active: \`body-should-not-leak\`** — must not be used
`, "utf-8");

    const result = await handlers.handle("workflow_start", {
      workflowName: "dev",
      taskDescription: "tilde sentinel integration test",
    }) as WorkflowStartResult;

    const state = new WorkflowState(context.vaultPath);
    const run = state.load(result.runId);
    expect(run.phase).toBeNull();
  });

  it("run.phase is null when gameplan.md is absent", async () => {
    // Remove the scaffold-created gameplan to simulate the "no gameplan" case.
    rmSync(join(context.vaultPath, "gameplan.md"));

    const result = await handlers.handle("workflow_start", {
      workflowName: "dev",
      taskDescription: "no gameplan",
    }) as WorkflowStartResult;

    const state = new WorkflowState(context.vaultPath);
    const run = state.load(result.runId);
    expect(run.phase).toBeNull();
  });

  it("snapshot semantics: mid-run gameplan edit does NOT update run.phase", async () => {
    writeFileSync(join(context.vaultPath, "gameplan.md"), `---
current-phase: initial-phase
---
`, "utf-8");

    const result = await handlers.handle("workflow_start", {
      workflowName: "dev",
      taskDescription: "snapshot test",
    }) as WorkflowStartResult;

    // Edit gameplan AFTER workflow_start — the persisted run.phase must
    // remain the snapshot value, not pick up the new value.
    writeFileSync(join(context.vaultPath, "gameplan.md"), `---
current-phase: edited-after-start
---
`, "utf-8");

    const state = new WorkflowState(context.vaultPath);
    const run = state.load(result.runId);
    expect(run.phase).toBe("initial-phase");
  });

  it("rejects workflow YAML with prototype-pollution step name (E005)", async () => {
    // Defense-in-depth: even if loader.ts accepts `__proto__` as a step name,
    // the MCP boundary refuses to use it as an object key in steps Record.
    const workflowsDir = join(context.vaultPath, "workflows");
    mkdirSync(workflowsDir, { recursive: true });
    writeFileSync(join(workflowsDir, "evil.yaml"), `name: evil
description: Attempts prototype pollution via step name
steps:
  - name: __proto__
    agent: reader
`, "utf-8");

    await expect(handlers.handle("workflow_start", {
      workflowName: "evil",
      taskDescription: "pollution attempt",
    })).rejects.toThrow(/E005/);
  });
});
