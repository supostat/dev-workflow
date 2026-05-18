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
  for (const name of ["reader", "planner", "plan-reviewer", "coder", "reviewer", "tester", "committer"]) {
    // The real bundled tester agent declares `shell: [npm test]`; mirror that
    // so the tests-pass gate has a shell command (it now throws without one).
    const shellLine = name === "tester" ? "shell: [npm test]\n" : "";
    writeFileSync(join(agentsDir, `${name}.md`), `---
name: ${name}
description: Test ${name}
vault: []
${shellLine}---
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
    mkdirSync(join(vaultPath, "workflow-state", "runs"), { recursive: true });
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
      phase: null,
      currentStep: "read",
      startedAt: "2026-03-31T10:00:00Z",
      completedAt: null,
      status: "running",
      steps: {
        read: { status: "pending", output: null, startedAt: null, completedAt: null, durationMs: null, attempt: 0, engramMemoryId: null, error: null },
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
      phase: null,
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
      phase: null,
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

  it("load() strips __proto__ key from poisoned JSON (no prototype pollution)", () => {
    const filepath = join(vaultPath, "workflow-state", "runs", "run-poison.json");
    writeFileSync(filepath,
      '{"id":"run-poison","workflowName":"x","taskId":null,"taskDescription":"t","currentStep":"a","startedAt":"2026-01-01T00:00:00Z","completedAt":null,"status":"completed","steps":{},"__proto__":{"polluted":"YES"}}',
      "utf-8");
    state.load("run-poison");
    expect((({}) as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
  });

  it("load() strips constructor and prototype keys too", () => {
    const filepath = join(vaultPath, "workflow-state", "runs", "run-poison2.json");
    writeFileSync(filepath,
      '{"id":"run-poison2","workflowName":"x","taskId":null,"taskDescription":"t","currentStep":"a","startedAt":"2026-01-01T00:00:00Z","completedAt":null,"status":"completed","steps":{},"constructor":{"polluted2":"x"},"prototype":{"polluted3":"x"}}',
      "utf-8");
    const loaded = state.load("run-poison2");
    expect(Object.prototype.hasOwnProperty.call(loaded, "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(loaded, "prototype")).toBe(false);
    expect((({}) as Record<string, unknown>)["polluted2"]).toBeUndefined();
    expect((({}) as Record<string, unknown>)["polluted3"]).toBeUndefined();
  });

  it("list() also strips reserved keys", () => {
    const filepath = join(vaultPath, "workflow-state", "runs", "run-poison-list.json");
    writeFileSync(filepath,
      '{"id":"run-poison-list","workflowName":"x","taskId":null,"taskDescription":"t","currentStep":"a","startedAt":"2026-01-01T00:00:00Z","completedAt":null,"status":"completed","steps":{},"__proto__":{"listPollution":"BAD"}}',
      "utf-8");
    state.list();
    expect((({}) as Record<string, unknown>)["listPollution"]).toBeUndefined();
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

  it("user-approve gate fails when output verdict is NEEDS_REVISION", async () => {
    const executor: StepExecutor = {
      async execute(_agent: PreparedAgent): Promise<string> {
        return "PLAN_REVIEW:\nVerdict: NEEDS_REVISION\nIssues:\n- something\nEND_PLAN_REVIEW";
      },
    };

    let approvalCallCount = 0;
    const gateChecker = createMockGateChecker({
      requestUserApproval: async () => {
        approvalCallCount++;
        return true;
      },
    });

    const workflow: WorkflowDefinition = {
      name: "verdict-gate",
      description: "Verdict-aware gate",
      steps: [
        { name: "plan-review", agent: "plan-reviewer", input: [], gate: "user-approve", onFail: null, maxAttempts: 1 },
      ],
    };

    const engine = createEngine(executor, gateChecker);
    const run = await engine.start(workflow, "Test");

    expect(run.status).toBe("failed");
    expect(approvalCallCount).toBe(0);
  });

  it("user-approve gate proceeds normally when verdict is APPROVED", async () => {
    const executor: StepExecutor = {
      async execute(_agent: PreparedAgent): Promise<string> {
        return "PLAN_REVIEW:\nVerdict: APPROVED\nIssues:\nEND_PLAN_REVIEW";
      },
    };

    let approvalCallCount = 0;
    const gateChecker = createMockGateChecker({
      requestUserApproval: async () => {
        approvalCallCount++;
        return true;
      },
    });

    const workflow: WorkflowDefinition = {
      name: "verdict-approved",
      description: "Verdict APPROVED gate",
      steps: [
        { name: "plan-review", agent: "plan-reviewer", input: [], gate: "user-approve", onFail: null, maxAttempts: 1 },
      ],
    };

    const engine = createEngine(executor, gateChecker);
    const run = await engine.start(workflow, "Test");

    expect(run.status).toBe("completed");
    expect(approvalCallCount).toBe(1);
  });

  it("user-approve gate proceeds normally when no Verdict field present", async () => {
    const executor: StepExecutor = {
      async execute(_agent: PreparedAgent): Promise<string> {
        return "Some output without verdict";
      },
    };

    let approvalCallCount = 0;
    const gateChecker = createMockGateChecker({
      requestUserApproval: async () => {
        approvalCallCount++;
        return true;
      },
    });

    const workflow: WorkflowDefinition = {
      name: "no-verdict",
      description: "No verdict field",
      steps: [
        { name: "plan", agent: "planner", input: [], gate: "user-approve", onFail: null, maxAttempts: 1 },
      ],
    };

    const engine = createEngine(executor, gateChecker);
    const run = await engine.start(workflow, "Test");

    expect(run.status).toBe("completed");
    expect(approvalCallCount).toBe(1);
  });

  it("Next directive overrides static onFail target", async () => {
    const callOrder: string[] = [];
    const executor: StepExecutor = {
      async execute(agent: PreparedAgent): Promise<string> {
        callOrder.push(agent.definition.name);
        if (agent.definition.name === "plan-reviewer") {
          return "PLAN_REVIEW:\nVerdict: NEEDS_REVISION\nNext: plan-fix\nEND_PLAN_REVIEW";
        }
        return "ok";
      },
    };

    const workflow: WorkflowDefinition = {
      name: "next-override",
      description: "Next directive overrides onFail",
      steps: [
        { name: "plan", agent: "planner", input: [], gate: "none", onFail: null, maxAttempts: 3 },
        { name: "plan-review", agent: "plan-reviewer", input: [], gate: "user-approve", onFail: "plan", maxAttempts: 3 },
        { name: "plan-fix", agent: "coder", input: [], gate: "none", onFail: null, maxAttempts: 2 },
      ],
    };

    const engine = createEngine(executor, createMockGateChecker());
    const run = await engine.start(workflow, "Test");

    expect(run.status).toBe("completed");
    expect(callOrder).toEqual(["planner", "plan-reviewer", "coder"]);
    expect(run.steps["plan-fix"]!.status).toBe("completed");
  });

  it("Next directive falls back to static onFail target when Next is missing", async () => {
    const callOrder: string[] = [];
    let planReviewCallCount = 0;
    const executor: StepExecutor = {
      async execute(agent: PreparedAgent): Promise<string> {
        callOrder.push(agent.definition.name);
        if (agent.definition.name === "plan-reviewer") {
          planReviewCallCount++;
          if (planReviewCallCount === 1) {
            return "PLAN_REVIEW:\nVerdict: NEEDS_REVISION\nEND_PLAN_REVIEW";
          }
          return "PLAN_REVIEW:\nVerdict: APPROVED\nEND_PLAN_REVIEW";
        }
        return "ok";
      },
    };

    const workflow: WorkflowDefinition = {
      name: "next-fallback",
      description: "Next missing falls back to onFail target",
      steps: [
        { name: "plan", agent: "planner", input: [], gate: "none", onFail: null, maxAttempts: 3 },
        { name: "plan-review", agent: "plan-reviewer", input: [], gate: "user-approve", onFail: "plan", maxAttempts: 3 },
        { name: "plan-fix", agent: "coder", input: [], gate: "none", onFail: null, maxAttempts: 2 },
      ],
    };

    const engine = createEngine(executor, createMockGateChecker());
    const run = await engine.start(workflow, "Test");

    expect(run.status).toBe("completed");
    expect(callOrder.filter((n) => n === "planner").length).toBe(2);
    expect(callOrder.filter((n) => n === "plan-reviewer").length).toBe(2);
  });

  it("Next directive falls back to onFail when target is not in whitelist (security: gate bypass guard)", async () => {
    const callOrder: string[] = [];
    const executor: StepExecutor = {
      async execute(agent: PreparedAgent): Promise<string> {
        callOrder.push(agent.definition.name);
        if (agent.definition.name === "plan-reviewer") {
          return "PLAN_REVIEW:\nVerdict: NEEDS_REVISION\nNext: commit\nEND_PLAN_REVIEW";
        }
        return "ok";
      },
    };

    let planRecallCount = 0;
    const workflow: WorkflowDefinition = {
      name: "next-not-whitelisted",
      description: "Next target not whitelisted",
      steps: [
        { name: "plan", agent: "planner", input: [], gate: "none", onFail: null, maxAttempts: 3 },
        { name: "plan-review", agent: "plan-reviewer", input: [], gate: "user-approve", onFail: "plan", maxAttempts: 3 },
        { name: "commit", agent: "committer", input: [], gate: "none", onFail: null, maxAttempts: 3 },
      ],
    };

    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stderr.write;

    try {
      const engine = createEngine(executor, createMockGateChecker());
      const run = await engine.start(workflow, "Test");
      planRecallCount = callOrder.filter((n) => n === "planner").length;
      expect(planRecallCount).toBeGreaterThanOrEqual(2);
      expect(run.steps["commit"]!.status).toBe("pending");
      expect(stderrChunks.join("")).toContain('Next: "commit"');
      expect(stderrChunks.join("")).toContain("not whitelisted");
    } finally {
      process.stderr.write = origWrite;
    }
  });

  it("Next directive pointing to unknown step gracefully fails workflow (no uncaught throw)", async () => {
    const executor: StepExecutor = {
      async execute(agent: PreparedAgent): Promise<string> {
        if (agent.definition.name === "plan-reviewer") {
          return "PLAN_REVIEW:\nVerdict: NEEDS_REVISION\nNext: nowhere-fix\nEND_PLAN_REVIEW";
        }
        return "ok";
      },
    };

    const workflow: WorkflowDefinition = {
      name: "next-unknown",
      description: "Next points to unknown step that is allowed-class but not present",
      steps: [
        { name: "plan", agent: "planner", input: [], gate: "none", onFail: null, maxAttempts: 3 },
        { name: "plan-review", agent: "plan-reviewer", input: [], gate: "user-approve", onFail: "nowhere-fix", maxAttempts: 3 },
      ],
    };

    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stderr.write;

    try {
      const engine = createEngine(executor, createMockGateChecker());
      const run = await engine.start(workflow, "Test");
      expect(run.status).toBe("failed");
      expect(run.completedAt).not.toBeNull();
      expect(stderrChunks.join("")).toContain('"nowhere-fix"');
      expect(stderrChunks.join("")).toContain("unknown step");
    } finally {
      process.stderr.write = origWrite;
    }
  });

  it("Next directive verdict regex rejects malformed verdicts (NEEDS_REVISION_X)", async () => {
    const executor: StepExecutor = {
      async execute(_agent: PreparedAgent): Promise<string> {
        return "PLAN_REVIEW:\nVerdict: NEEDS_REVISION_EXTRA\nEND_PLAN_REVIEW";
      },
    };

    let approvalCallCount = 0;
    const gateChecker = createMockGateChecker({
      requestUserApproval: async () => {
        approvalCallCount++;
        return true;
      },
    });

    const workflow: WorkflowDefinition = {
      name: "verdict-malformed",
      description: "Malformed verdict suffix",
      steps: [
        { name: "plan-review", agent: "plan-reviewer", input: [], gate: "user-approve", onFail: null, maxAttempts: 1 },
      ],
    };

    const engine = createEngine(executor, gateChecker);
    const run = await engine.start(workflow, "Test");

    expect(run.status).toBe("completed");
    expect(approvalCallCount).toBe(1);
  });

  it("self-loop onFail does not infinite-loop due to global attempt cap (D3a)", async () => {
    let executorCalls = 0;
    const executor: StepExecutor = {
      async execute(_agent: PreparedAgent): Promise<string> {
        executorCalls++;
        if (executorCalls > 100) {
          throw new Error("infinite loop detected — test guard");
        }
        return "fail";
      },
    };

    const gateChecker = createMockGateChecker({
      checkTestsPass: async () => false,
    });

    const workflow: WorkflowDefinition = {
      name: "self-loop",
      description: "Step onFails to itself",
      steps: [
        { name: "tester", agent: "tester", input: [], gate: "tests-pass", onFail: "tester", maxAttempts: 3 },
      ],
    };

    const engine = createEngine(executor, gateChecker);
    const run = await engine.start(workflow, "Test");

    expect(run.status).toBe("failed");
    expect(executorCalls).toBeLessThanOrEqual(3);
    expect(run.steps["tester"]!.attempt).toBe(3);
  });

  it("onFail attempt counter accumulates globally across re-entry cycle (D3a)", async () => {
    const gateChecker = createMockGateChecker({
      checkTestsPass: async () => false,
    });

    const workflow: WorkflowDefinition = {
      name: "global-cap",
      description: "Global attempt cap across re-entry",
      steps: [
        { name: "a", agent: "tester", input: [], gate: "tests-pass", onFail: "b", maxAttempts: 2 },
        { name: "b", agent: "tester", input: [], gate: "tests-pass", onFail: "a", maxAttempts: 2 },
      ],
    };

    const engine = createEngine(undefined, gateChecker);
    const run = await engine.start(workflow, "Test");

    expect(run.status).toBe("failed");
    const totalAttempts = (run.steps["a"]!.attempt ?? 0) + (run.steps["b"]!.attempt ?? 0);
    expect(totalAttempts).toBeGreaterThanOrEqual(2);
    expect(totalAttempts).toBeLessThanOrEqual(4);
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
  it("returns 5 builtin workflows", () => {
    const workflows = getBuiltinWorkflows();
    expect(workflows).toHaveLength(5);
  });

  it("gets workflow by name", () => {
    const dev = getBuiltinWorkflow("dev");
    expect(dev.name).toBe("dev");
    expect(dev.steps.length).toBe(11);
  });

  it("throws for unknown workflow", () => {
    expect(() => getBuiltinWorkflow("nonexistent")).toThrow("Workflow not found");
  });

  it("dev workflow has correct step order", () => {
    const dev = getBuiltinWorkflow("dev");
    const names = dev.steps.map((s) => s.name);
    expect(names).toEqual([
      "preflight",
      "read",
      "plan",
      "plan-review",
      "plan-fix",
      "code",
      "review",
      "test",
      "verify",
      "commit",
      "vault-updates",
    ]);
  });

  it("dev plan-fix step routes through coder agent (Full subagent)", () => {
    const dev = getBuiltinWorkflow("dev");
    const planFix = dev.steps.find((s) => s.name === "plan-fix");
    expect(planFix?.agent).toBe("coder");
    expect(planFix?.input).toEqual(["plan.output", "plan-review.output"]);
    expect(planFix?.maxAttempts).toBe(2);
    expect(planFix?.gate).toBe("none");
    expect(planFix?.onFail).toBeNull();
  });

  it("hotfix workflow skips plan and review", () => {
    const hotfix = getBuiltinWorkflow("hotfix");
    const names = hotfix.steps.map((s) => s.name);
    expect(names).toEqual([
      "preflight",
      "read",
      "code",
      "test",
      "verify",
      "commit",
      "vault-updates",
    ]);
  });

  it("review workflow has correct step order", () => {
    const review = getBuiltinWorkflow("review");
    const names = review.steps.map((s) => s.name);
    expect(names).toEqual(["read", "review", "vault-updates"]);
  });

  it("intake workflow has single classify step with user-approve gate", () => {
    const intake = getBuiltinWorkflow("intake");
    expect(intake.name).toBe("intake");
    expect(intake.match).toEqual([]);
    expect(intake.steps).toHaveLength(1);
    expect(intake.steps[0]!.name).toBe("classify");
    expect(intake.steps[0]!.agent).toBe("intake");
    expect(intake.steps[0]!.gate).toBe("user-approve");
  });

  it("intake workflow is included in builtin workflows list", () => {
    const workflows = getBuiltinWorkflows();
    const intake = workflows.find((w) => w.name === "intake");
    expect(intake?.steps[0]?.agent).toBe("intake");
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

describe("WorkflowEngine — ENGRAM_TRACE_FILE", () => {
  let env: ReturnType<typeof createTestEnv>;
  let originalTraceEnv: string | undefined;

  beforeEach(() => {
    env = createTestEnv();
    originalTraceEnv = process.env["ENGRAM_TRACE_FILE"];
  });

  afterEach(() => {
    if (originalTraceEnv === undefined) {
      delete process.env["ENGRAM_TRACE_FILE"];
    } else {
      process.env["ENGRAM_TRACE_FILE"] = originalTraceEnv;
    }
    rmSync(env.projectRoot, { recursive: true, force: true });
  });

  function createEngine(): WorkflowEngine {
    return new WorkflowEngine(
      env.registry,
      env.contextBuilder,
      env.state,
      env.taskManager,
      createMockExecutor(),
      createMockGateChecker(),
    );
  }

  it("sets ENGRAM_TRACE_FILE under workflow-state/runs when env is unset", async () => {
    delete process.env["ENGRAM_TRACE_FILE"];
    const workflow: WorkflowDefinition = {
      name: "trace-default",
      description: "Default trace path",
      steps: [
        { name: "read", agent: "reader", input: [], gate: "none", onFail: null, maxAttempts: 1 },
      ],
    };

    const run = await createEngine().start(workflow, "Trace task");

    const expected = join(env.vaultPath, "workflow-state", "runs", `${run.id}.engram-trace.jsonl`);
    expect(process.env["ENGRAM_TRACE_FILE"]).toBe(expected);
  });

  it("does not overwrite ENGRAM_TRACE_FILE when manually set", async () => {
    process.env["ENGRAM_TRACE_FILE"] = "/custom/trace/path.jsonl";
    const workflow: WorkflowDefinition = {
      name: "trace-keep",
      description: "Preserve manual trace path",
      steps: [
        { name: "read", agent: "reader", input: [], gate: "none", onFail: null, maxAttempts: 1 },
      ],
    };

    await createEngine().start(workflow, "Trace task");

    expect(process.env["ENGRAM_TRACE_FILE"]).toBe("/custom/trace/path.jsonl");
  });
});
