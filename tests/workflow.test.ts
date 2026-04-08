import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkflowState } from "../src/workflow/state.js";
import { WorkflowEngine } from "../src/workflow/engine.js";
import type { StepExecutor, GateChecker } from "../src/workflow/engine.js";
import { getBuiltinWorkflow, getBuiltinWorkflows } from "../src/workflow/builtin.js";
import { AgentRegistry } from "../src/agents/registry.js";
import { AgentContextBuilder } from "../src/agents/context-builder.js";
import { VaultReader } from "../src/lib/reader.js";
import { VaultWriter } from "../src/lib/writer.js";
import { TaskManager } from "../src/tasks/manager.js";
import type { ProjectContext } from "../src/lib/types.js";
import type { PreparedAgent } from "../src/agents/types.js";
import type { WorkflowResolver } from "../src/workflow/engine.js";
import type { WorkflowRun, WorkflowDefinition, StepState } from "../src/workflow/types.js";
import type { EngramBridge, EngramBeforeStepResult } from "../src/lib/engram.js";

function createTestEnv() {
  const projectRoot = join(tmpdir(), `dev-vault-workflow-test-${Date.now()}`);
  const vaultPath = join(projectRoot, ".dev-vault");

  const context: ProjectContext = {
    projectName: "test-project",
    branch: "main",
    parentBranch: "main",
    vaultPath,
    projectRoot,
    gitRemote: null,
  };

  const writer = new VaultWriter(context);
  writer.scaffold();

  const agentsDir = join(projectRoot, "test-agents");
  mkdirSync(agentsDir, { recursive: true });
  for (const name of ["reader", "planner", "coder", "reviewer", "tester", "committer"]) {
    writeFileSync(join(agentsDir, `${name}.md`), `---
name: ${name}
description: Test ${name}
vault: []
---
Agent ${name} for {{projectName}}: {{taskDescription}}
`, "utf-8");
  }

  const registry = new AgentRegistry(agentsDir);
  const reader = new VaultReader(context);
  const contextBuilder = new AgentContextBuilder(reader, context);
  const state = new WorkflowState(vaultPath);
  const taskManager = new TaskManager(vaultPath);

  return { projectRoot, vaultPath, context, registry, contextBuilder, state, taskManager, agentsDir };
}

function createMockExecutor(outputs: Record<string, string> = {}): StepExecutor {
  let callIndex = 0;
  const outputValues = Object.values(outputs);
  return {
    async execute(_agent: PreparedAgent): Promise<string> {
      const output = outputValues[callIndex] ?? `step-${callIndex}-output`;
      callIndex++;
      return output;
    },
  };
}

function createMockGateChecker(overrides: Partial<GateChecker> = {}): GateChecker {
  return {
    checkTestsPass: overrides.checkTestsPass ?? (async () => true),
    checkReviewPass: overrides.checkReviewPass ?? (() => true),
    requestUserApproval: overrides.requestUserApproval ?? (async () => true),
    checkCustomCommand: overrides.checkCustomCommand ?? (async () => true),
  };
}

describe("WorkflowState", () => {
  let vaultPath: string;
  let projectRoot: string;
  let state: WorkflowState;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `dev-vault-state-test-${Date.now()}`);
    vaultPath = join(projectRoot, ".dev-vault");
    mkdirSync(join(vaultPath, "workflows"), { recursive: true });
    state = new WorkflowState(vaultPath);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("save and load round-trip", () => {
    const run: WorkflowRun = {
      id: "run-2026-03-31-001",
      workflowName: "dev",
      taskId: null,
      taskDescription: "Test task",
      currentStep: "read",
      startedAt: "2026-03-31T10:00:00Z",
      completedAt: null,
      status: "running",
      steps: {
        read: { status: "pending", output: null, startedAt: null, completedAt: null, durationMs: null, attempt: 0 },
      },
    };

    state.save(run);
    const loaded = state.load("run-2026-03-31-001");

    expect(loaded.id).toBe(run.id);
    expect(loaded.workflowName).toBe("dev");
    expect(loaded.status).toBe("running");
  });

  it("loadCurrent returns running workflow", () => {
    const run: WorkflowRun = {
      id: "run-2026-03-31-001",
      workflowName: "dev",
      taskId: null,
      taskDescription: "Test",
      currentStep: "read",
      startedAt: "2026-03-31T10:00:00Z",
      completedAt: null,
      status: "running",
      steps: {},
    };

    state.save(run);

    const current = state.loadCurrent();
    expect(current).not.toBeNull();
    expect(current!.id).toBe("run-2026-03-31-001");
  });

  it("loadCurrent returns null when no active runs", () => {
    const run: WorkflowRun = {
      id: "run-2026-03-31-001",
      workflowName: "dev",
      taskId: null,
      taskDescription: "Test",
      currentStep: "read",
      startedAt: "2026-03-31T10:00:00Z",
      completedAt: "2026-03-31T11:00:00Z",
      status: "completed",
      steps: {},
    };

    state.save(run);

    expect(state.loadCurrent()).toBeNull();
  });

  it("list returns all runs", () => {
    for (const i of [1, 2, 3]) {
      state.save({
        id: `run-2026-03-31-00${i}`,
        workflowName: "dev",
        taskId: null,
        taskDescription: `Task ${i}`,
        currentStep: "read",
        startedAt: `2026-03-31T1${i}:00:00Z`,
        completedAt: null,
        status: "completed",
        steps: {},
      });
    }

    expect(state.list()).toHaveLength(3);
  });
});

describe("WorkflowEngine", () => {
  let env: ReturnType<typeof createTestEnv>;

  beforeEach(() => {
    env = createTestEnv();
  });

  afterEach(() => {
    rmSync(env.projectRoot, { recursive: true, force: true });
  });

  function createEngine(
    executor?: StepExecutor,
    gateChecker?: GateChecker,
    resolver?: WorkflowResolver,
  ): WorkflowEngine {
    return new WorkflowEngine(
      env.registry,
      env.contextBuilder,
      env.state,
      env.taskManager,
      executor ?? createMockExecutor(),
      gateChecker ?? createMockGateChecker(),
      resolver,
    );
  }

  it("starts workflow and executes all steps", async () => {
    const simpleWorkflow: WorkflowDefinition = {
      name: "simple",
      description: "Two step workflow",
      steps: [
        { name: "read", agent: "reader", input: [], gate: "none", onFail: null, maxAttempts: 3 },
        { name: "code", agent: "coder", input: ["read.output"], gate: "none", onFail: null, maxAttempts: 3 },
      ],
    };

    const engine = createEngine();
    const run = await engine.start(simpleWorkflow, "Build feature");

    expect(run.status).toBe("completed");
    expect(run.steps["read"]!.status).toBe("completed");
    expect(run.steps["code"]!.status).toBe("completed");
    expect(run.completedAt).not.toBeNull();
  });

  it("gate none auto-advances", async () => {
    const workflow: WorkflowDefinition = {
      name: "auto",
      description: "All none gates",
      steps: [
        { name: "a", agent: "reader", input: [], gate: "none", onFail: null, maxAttempts: 3 },
        { name: "b", agent: "coder", input: [], gate: "none", onFail: null, maxAttempts: 3 },
        { name: "c", agent: "tester", input: [], gate: "none", onFail: null, maxAttempts: 3 },
      ],
    };

    const engine = createEngine();
    const run = await engine.start(workflow, "Test");

    expect(run.status).toBe("completed");
    expect(run.steps["a"]!.status).toBe("completed");
    expect(run.steps["b"]!.status).toBe("completed");
    expect(run.steps["c"]!.status).toBe("completed");
  });

  it("gate user-approve pauses workflow", async () => {
    const workflow: WorkflowDefinition = {
      name: "approval",
      description: "Needs approval",
      steps: [
        { name: "plan", agent: "planner", input: [], gate: "user-approve", onFail: null, maxAttempts: 3 },
        { name: "code", agent: "coder", input: [], gate: "none", onFail: null, maxAttempts: 3 },
      ],
    };

    const gateChecker = createMockGateChecker({
      requestUserApproval: async () => false,
    });
    const engine = createEngine(undefined, gateChecker);
    const run = await engine.start(workflow, "Test");

    expect(run.status).toBe("paused");
    expect(run.currentStep).toBe("plan");
  });

  it("resume continues paused workflow", async () => {
    const workflow: WorkflowDefinition = {
      name: "approval",
      description: "Needs approval",
      steps: [
        { name: "plan", agent: "planner", input: [], gate: "user-approve", onFail: null, maxAttempts: 3 },
        { name: "code", agent: "coder", input: [], gate: "none", onFail: null, maxAttempts: 3 },
      ],
    };

    const resolver: WorkflowResolver = { resolve: () => workflow };

    const gateChecker = createMockGateChecker({
      requestUserApproval: async () => false,
    });
    const engine = createEngine(undefined, gateChecker, resolver);
    const paused = await engine.start(workflow, "Test");

    expect(paused.status).toBe("paused");

    const resumeEngine = createEngine(undefined, createMockGateChecker(), resolver);
    const resumed = await resumeEngine.resume(paused.id, "Approved plan output");

    expect(resumed.status).toBe("completed");
  });

  it("gate tests-pass checks shell command", async () => {
    const workflow: WorkflowDefinition = {
      name: "tested",
      description: "Has test gate",
      steps: [
        { name: "test", agent: "tester", input: [], gate: "tests-pass", onFail: null, maxAttempts: 1 },
      ],
    };

    const gateChecker = createMockGateChecker({
      checkTestsPass: async () => false,
    });
    const engine = createEngine(undefined, gateChecker);
    const run = await engine.start(workflow, "Test");

    expect(run.status).toBe("failed");
    expect(run.steps["test"]!.status).toBe("failed");
  });

  it("gate review-pass checks review output", async () => {
    const workflow: WorkflowDefinition = {
      name: "reviewed",
      description: "Has review gate",
      steps: [
        { name: "review", agent: "reviewer", input: [], gate: "review-pass", onFail: null, maxAttempts: 1 },
      ],
    };

    const gateChecker = createMockGateChecker({
      checkReviewPass: () => false,
    });
    const engine = createEngine(undefined, gateChecker);
    const run = await engine.start(workflow, "Test");

    expect(run.status).toBe("failed");
  });

  it("onFail redirects to specified step", async () => {
    let codeCallCount = 0;
    const executor: StepExecutor = {
      async execute(agent: PreparedAgent): Promise<string> {
        if (agent.definition.name === "coder") {
          codeCallCount++;
          return `code-attempt-${codeCallCount}`;
        }
        return "review-output";
      },
    };

    let reviewCallCount = 0;
    const gateChecker = createMockGateChecker({
      checkReviewPass: () => {
        reviewCallCount++;
        return reviewCallCount > 1;
      },
    });

    const workflow: WorkflowDefinition = {
      name: "retry",
      description: "Review with retry",
      steps: [
        { name: "code", agent: "coder", input: [], gate: "none", onFail: null, maxAttempts: 3 },
        { name: "review", agent: "reviewer", input: ["code.output"], gate: "review-pass", onFail: "code", maxAttempts: 3 },
      ],
    };

    const engine = createEngine(executor, gateChecker);
    const run = await engine.start(workflow, "Test");

    expect(run.status).toBe("completed");
    expect(codeCallCount).toBe(2);
    expect(reviewCallCount).toBe(2);
  });

  it("maxAttempts limits retries", async () => {
    const gateChecker = createMockGateChecker({
      checkTestsPass: async () => false,
    });

    const workflow: WorkflowDefinition = {
      name: "limited",
      description: "Limited retries",
      steps: [
        { name: "code", agent: "coder", input: [], gate: "none", onFail: null, maxAttempts: 3 },
        { name: "test", agent: "tester", input: [], gate: "tests-pass", onFail: "code", maxAttempts: 2 },
      ],
    };

    const engine = createEngine(undefined, gateChecker);
    const run = await engine.start(workflow, "Test");

    expect(run.status).toBe("failed");
    expect(run.steps["test"]!.attempt).toBe(2);
  });

  it("updates task on start and completion", async () => {
    const task = env.taskManager.create("Linked task");

    const workflow: WorkflowDefinition = {
      name: "linked",
      description: "Task-linked",
      steps: [
        { name: "read", agent: "reader", input: [], gate: "none", onFail: null, maxAttempts: 3 },
      ],
    };

    const engine = createEngine();
    await engine.start(workflow, "Test", task.id);

    const updated = env.taskManager.get(task.id);
    expect(updated.status).toBe("done");
    expect(updated.workflowRun).toContain("run-");
  });

  it("gate custom-command passes when checker returns true", async () => {
    const workflow: WorkflowDefinition = {
      name: "custom-gate",
      description: "Has custom command gate",
      steps: [
        { name: "lint", agent: "tester", input: [], gate: "custom-command", gateCommand: "npm run lint", onFail: null, maxAttempts: 1 },
      ],
    };

    const gateChecker = createMockGateChecker({
      checkCustomCommand: async () => true,
    });
    const engine = createEngine(undefined, gateChecker);
    const run = await engine.start(workflow, "Test");

    expect(run.status).toBe("completed");
    expect(run.steps["lint"]!.status).toBe("completed");
  });

  it("gate custom-command fails when checker returns false", async () => {
    const workflow: WorkflowDefinition = {
      name: "custom-gate-fail",
      description: "Custom command fails",
      steps: [
        { name: "lint", agent: "tester", input: [], gate: "custom-command", gateCommand: "slither .", onFail: null, maxAttempts: 1 },
      ],
    };

    const gateChecker = createMockGateChecker({
      checkCustomCommand: async () => false,
    });
    const engine = createEngine(undefined, gateChecker);
    const run = await engine.start(workflow, "Test");

    expect(run.status).toBe("failed");
    expect(run.steps["lint"]!.status).toBe("failed");
  });

  it("gate custom-command fails when gateCommand is missing", async () => {
    const workflow: WorkflowDefinition = {
      name: "custom-gate-no-cmd",
      description: "Missing gateCommand",
      steps: [
        { name: "check", agent: "tester", input: [], gate: "custom-command", onFail: null, maxAttempts: 1 },
      ],
    };

    const engine = createEngine();
    const run = await engine.start(workflow, "Test");

    expect(run.status).toBe("failed");
  });

  it("gate custom-command works with onFail retry", async () => {
    let codeCallCount = 0;
    const executor: StepExecutor = {
      async execute(agent: PreparedAgent): Promise<string> {
        if (agent.definition.name === "coder") codeCallCount++;
        return "output";
      },
    };

    let checkCount = 0;
    const gateChecker = createMockGateChecker({
      checkCustomCommand: async () => {
        checkCount++;
        return checkCount > 1;
      },
    });

    const workflow: WorkflowDefinition = {
      name: "custom-retry",
      description: "Custom command with retry",
      steps: [
        { name: "code", agent: "coder", input: [], gate: "none", onFail: null, maxAttempts: 3 },
        { name: "check", agent: "tester", input: [], gate: "custom-command", gateCommand: "forge test --fuzz", onFail: "code", maxAttempts: 3 },
      ],
    };

    const engine = createEngine(executor, gateChecker);
    const run = await engine.start(workflow, "Test");

    expect(run.status).toBe("completed");
    expect(codeCallCount).toBe(2);
    expect(checkCount).toBe(2);
  });

  it("abort sets failed status", async () => {
    const workflow: WorkflowDefinition = {
      name: "abort-test",
      description: "Will be aborted",
      steps: [
        { name: "plan", agent: "planner", input: [], gate: "user-approve", onFail: null, maxAttempts: 3 },
      ],
    };

    const gateChecker = createMockGateChecker({
      requestUserApproval: async () => false,
    });
    const engine = createEngine(undefined, gateChecker);
    const paused = await engine.start(workflow, "Test");

    const aborted = engine.abort(paused.id);

    expect(aborted.status).toBe("failed");
    expect(aborted.completedAt).not.toBeNull();
  });
});

describe("Builtin workflows", () => {
  it("returns 4 builtin workflows", () => {
    const workflows = getBuiltinWorkflows();
    expect(workflows).toHaveLength(4);
  });

  it("gets workflow by name", () => {
    const dev = getBuiltinWorkflow("dev");
    expect(dev.name).toBe("dev");
    expect(dev.steps.length).toBe(6);
  });

  it("throws for unknown workflow", () => {
    expect(() => getBuiltinWorkflow("nonexistent")).toThrow("Workflow not found");
  });

  it("dev workflow has correct step order", () => {
    const dev = getBuiltinWorkflow("dev");
    const names = dev.steps.map((s) => s.name);
    expect(names).toEqual(["read", "plan", "code", "review", "test", "commit"]);
  });

  it("hotfix workflow skips plan and review", () => {
    const hotfix = getBuiltinWorkflow("hotfix");
    const names = hotfix.steps.map((s) => s.name);
    expect(names).toEqual(["read", "code", "test", "commit"]);
  });
});

function createMockEngramBridge(overrides: Partial<{
  beforeStep: EngramBridge["beforeStep"];
  afterStep: EngramBridge["afterStep"];
  judge: EngramBridge["judge"];
}> = {}): EngramBridge {
  return {
    beforeStep: overrides.beforeStep ?? (async () => ({
      context: "", isDegraded: false, memoryIds: [],
    })),
    afterStep: overrides.afterStep ?? (async () => null),
    judge: overrides.judge ?? (async () => {}),
  } as unknown as EngramBridge;
}

describe("WorkflowEngine with Engram", () => {
  let env: ReturnType<typeof createTestEnv>;

  beforeEach(() => {
    env = createTestEnv();
  });

  afterEach(() => {
    rmSync(env.projectRoot, { recursive: true, force: true });
  });

  function createEngineWithEngram(
    bridge: EngramBridge,
    executor?: StepExecutor,
    gateChecker?: GateChecker,
  ): WorkflowEngine {
    return new WorkflowEngine(
      env.registry,
      env.contextBuilder,
      env.state,
      env.taskManager,
      executor ?? createMockExecutor(),
      gateChecker ?? createMockGateChecker(),
      undefined,
      bridge,
    );
  }

  it("stores engramMemoryId after successful step", async () => {
    const bridge = createMockEngramBridge({
      afterStep: async () => "memory-abc-123",
    });

    const workflow: WorkflowDefinition = {
      name: "engram-store",
      description: "Test engram store",
      steps: [
        { name: "read", agent: "reader", input: [], gate: "none", onFail: null, maxAttempts: 3 },
      ],
    };

    const engine = createEngineWithEngram(bridge);
    const run = await engine.start(workflow, "Test task");

    expect(run.status).toBe("completed");
    expect(run.steps["read"]!.engramMemoryId).toBe("memory-abc-123");
  });

  it("judges found memories with 0.7 on step success", async () => {
    const judgeCalls: Array<{ memoryId: string; score: number; explanation: string }> = [];

    const bridge = createMockEngramBridge({
      beforeStep: async () => ({
        context: "## Engram Memory\n- [PATTERN] auth pattern",
        isDegraded: false,
        memoryIds: ["mem-001", "mem-002"],
      }),
      judge: async (memoryId, score, explanation) => {
        judgeCalls.push({ memoryId, score, explanation });
      },
    });

    const workflow: WorkflowDefinition = {
      name: "engram-judge",
      description: "Test auto-judge",
      steps: [
        { name: "plan", agent: "planner", input: [], gate: "none", onFail: null, maxAttempts: 3 },
      ],
    };

    const engine = createEngineWithEngram(bridge);
    await engine.start(workflow, "Test task");

    expect(judgeCalls).toHaveLength(2);
    expect(judgeCalls[0].memoryId).toBe("mem-001");
    expect(judgeCalls[0].score).toBe(0.7);
    expect(judgeCalls[0].explanation).toContain("plan");
    expect(judgeCalls[0].explanation).toContain("completed successfully");
    expect(judgeCalls[1].memoryId).toBe("mem-002");
  });

  it("judges found memories with 0.3 on step failure", async () => {
    const judgeCalls: Array<{ memoryId: string; score: number; explanation: string }> = [];

    const bridge = createMockEngramBridge({
      beforeStep: async () => ({
        context: "some context",
        isDegraded: false,
        memoryIds: ["mem-fail"],
      }),
      afterStep: async () => "mem-stored",
      judge: async (memoryId, score, explanation) => {
        judgeCalls.push({ memoryId, score, explanation });
      },
    });

    const workflow: WorkflowDefinition = {
      name: "engram-judge-fail",
      description: "Test judge on failure",
      steps: [
        { name: "test", agent: "tester", input: [], gate: "tests-pass", onFail: null, maxAttempts: 1 },
      ],
    };

    const gateChecker = createMockGateChecker({
      checkTestsPass: async () => false,
    });

    const engine = createEngineWithEngram(bridge, undefined, gateChecker);
    const run = await engine.start(workflow, "Test task");

    expect(run.status).toBe("failed");
    expect(judgeCalls).toHaveLength(1);
    expect(judgeCalls[0].memoryId).toBe("mem-fail");
    expect(judgeCalls[0].score).toBe(0.3);
    expect(judgeCalls[0].explanation).toContain("test");
    expect(judgeCalls[0].explanation).toContain("failed gate check");
  });

  it("skips judge when no memories found", async () => {
    const judgeCalls: string[] = [];

    const bridge = createMockEngramBridge({
      beforeStep: async () => ({
        context: "", isDegraded: false, memoryIds: [],
      }),
      judge: async (memoryId) => {
        judgeCalls.push(memoryId);
      },
    });

    const workflow: WorkflowDefinition = {
      name: "engram-no-judge",
      description: "No memories to judge",
      steps: [
        { name: "read", agent: "reader", input: [], gate: "none", onFail: null, maxAttempts: 3 },
      ],
    };

    const engine = createEngineWithEngram(bridge);
    await engine.start(workflow, "Test task");

    expect(judgeCalls).toHaveLength(0);
  });

  it("continues in degraded mode when engram unavailable", async () => {
    const bridge = createMockEngramBridge({
      beforeStep: async () => ({
        context: "", isDegraded: true, memoryIds: [],
      }),
    });

    const workflow: WorkflowDefinition = {
      name: "engram-degraded",
      description: "Test degraded mode",
      steps: [
        { name: "read", agent: "reader", input: [], gate: "none", onFail: null, maxAttempts: 3 },
        { name: "code", agent: "coder", input: ["read.output"], gate: "none", onFail: null, maxAttempts: 3 },
      ],
    };

    const engine = createEngineWithEngram(bridge);
    const run = await engine.start(workflow, "Test task");

    expect(run.status).toBe("completed");
    expect(run.steps["read"]!.status).toBe("completed");
    expect(run.steps["code"]!.status).toBe("completed");
  });
});
