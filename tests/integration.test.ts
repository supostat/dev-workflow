import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultWriter } from "../src/lib/writer.js";
import { VaultReader } from "../src/lib/reader.js";
import { AgentRegistry } from "../src/agents/registry.js";
import { AgentContextBuilder } from "../src/agents/context-builder.js";
import { TaskManager } from "../src/tasks/manager.js";
import { WorkflowEngine } from "../src/workflow/engine.js";
import type { StepExecutor, GateChecker } from "../src/workflow/engine.js";
import { WorkflowState } from "../src/workflow/state.js";
import type { ProjectContext } from "../src/lib/types.js";
import type { PreparedAgent } from "../src/agents/types.js";
import type { WorkflowDefinition } from "../src/workflow/types.js";

function createFullEnv() {
  const projectRoot = join(tmpdir(), `dev-vault-integration-${Date.now()}`);
  const vaultPath = join(projectRoot, ".dev-vault");

  const context: ProjectContext = {
    projectName: "integration-test",
    branch: "feature/auth",
    parentBranch: "main",
    vaultPath,
    projectRoot,
    gitRemote: null,
  };

  const writer = new VaultWriter(context);
  writer.scaffold();

  writeFileSync(join(vaultPath, "stack.md"), [
    "---", "updated: 2026-03-31", "tags: [stack]", "---",
    "# integration-test — Stack", "", "## Languages", "- TypeScript 6.0",
  ].join("\n"), "utf-8");

  writeFileSync(join(vaultPath, "conventions.md"), [
    "---", "updated: 2026-03-31", "tags: [conventions]", "---",
    "# integration-test — Conventions", "", "## Naming", "- camelCase for functions",
  ].join("\n"), "utf-8");

  const agentsDir = join(projectRoot, "test-agents");
  mkdirSync(agentsDir, { recursive: true });
  for (const name of ["reader", "planner", "coder", "reviewer", "tester", "committer"]) {
    writeFileSync(join(agentsDir, `${name}.md`), `---
name: ${name}
description: Test ${name} agent
vault: [stack, conventions]
---
Agent ${name} for {{projectName}}.
Stack: {{stack}}
Task: {{taskDescription}}
`, "utf-8");
  }

  return { projectRoot, vaultPath, context, agentsDir };
}

describe("Full integration cycle", () => {
  let projectRoot: string;
  let vaultPath: string;
  let context: ProjectContext;
  let agentsDir: string;

  beforeEach(() => {
    const env = createFullEnv();
    projectRoot = env.projectRoot;
    vaultPath = env.vaultPath;
    context = env.context;
    agentsDir = env.agentsDir;
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("scaffold creates all required directories", () => {
    expect(existsSync(join(vaultPath, "daily"))).toBe(true);
    expect(existsSync(join(vaultPath, "branches"))).toBe(true);
    expect(existsSync(join(vaultPath, "tasks"))).toBe(true);
    expect(existsSync(join(vaultPath, "workflows"))).toBe(true);
    expect(existsSync(join(vaultPath, "architecture"))).toBe(true);
  });

  it("agent prompt contains vault data", async () => {
    const reader = new VaultReader(context);
    const registry = new AgentRegistry(agentsDir);
    const contextBuilder = new AgentContextBuilder(reader, context);

    const agent = registry.get("coder");
    const prepared = await contextBuilder.prepare(agent, { taskDescription: "Add JWT auth" });

    expect(prepared.resolvedPrompt).toContain("integration-test");
    expect(prepared.resolvedPrompt).toContain("TypeScript 6.0");
    expect(prepared.resolvedPrompt).toContain("Add JWT auth");
  });

  it("task linked to workflow completes full cycle", async () => {
    const reader = new VaultReader(context);
    const registry = new AgentRegistry(agentsDir);
    const contextBuilder = new AgentContextBuilder(reader, context);
    const state = new WorkflowState(vaultPath);
    const taskManager = new TaskManager(vaultPath);

    const task = taskManager.create("Add authentication", "JWT with refresh tokens");
    expect(task.status).toBe("pending");

    const executedAgents: string[] = [];
    const executor: StepExecutor = {
      async execute(agent: PreparedAgent): Promise<string> {
        executedAgents.push(agent.definition.name);
        return `${agent.definition.name} completed`;
      },
    };

    const gateChecker: GateChecker = {
      checkTestsPass: async () => true,
      checkReviewPass: () => true,
      requestUserApproval: async () => true,
    };

    const workflow: WorkflowDefinition = {
      name: "dev",
      description: "Full dev cycle",
      steps: [
        { name: "read", agent: "reader", input: [], gate: "none", onFail: null, maxAttempts: 3 },
        { name: "plan", agent: "planner", input: ["read.output"], gate: "none", onFail: null, maxAttempts: 3 },
        { name: "code", agent: "coder", input: ["plan.output"], gate: "none", onFail: null, maxAttempts: 3 },
        { name: "review", agent: "reviewer", input: ["code.output"], gate: "review-pass", onFail: "code", maxAttempts: 3 },
        { name: "commit", agent: "committer", input: ["code.output"], gate: "none", onFail: null, maxAttempts: 3 },
      ],
    };

    const engine = new WorkflowEngine(
      registry, contextBuilder, state, taskManager,
      executor, gateChecker,
    );

    const run = await engine.start(workflow, "Add JWT authentication", task.id);

    expect(run.status).toBe("completed");
    expect(executedAgents).toEqual(["reader", "planner", "coder", "reviewer", "committer"]);

    const updatedTask = taskManager.get(task.id);
    expect(updatedTask.status).toBe("done");
    expect(updatedTask.workflowRun).toBe(run.id);

    const savedRun = state.load(run.id);
    expect(savedRun.status).toBe("completed");

    for (const stepState of Object.values(savedRun.steps)) {
      expect(stepState.status).toBe("completed");
      expect(stepState.output).not.toBeNull();
    }
  });

  it("workflow pause and resume preserves state", async () => {
    const reader = new VaultReader(context);
    const registry = new AgentRegistry(agentsDir);
    const contextBuilder = new AgentContextBuilder(reader, context);
    const state = new WorkflowState(vaultPath);
    const taskManager = new TaskManager(vaultPath);

    const workflow: WorkflowDefinition = {
      name: "approval",
      description: "Needs approval",
      steps: [
        { name: "plan", agent: "planner", input: [], gate: "user-approve", onFail: null, maxAttempts: 3 },
        { name: "code", agent: "coder", input: ["plan.output"], gate: "none", onFail: null, maxAttempts: 3 },
      ],
    };

    const resolver = { resolve: () => workflow };

    const pauseEngine = new WorkflowEngine(
      registry, contextBuilder, state, taskManager,
      { execute: async () => "plan output" },
      { checkTestsPass: async () => true, checkReviewPass: () => true, requestUserApproval: async () => false },
      resolver,
    );

    const paused = await pauseEngine.start(workflow, "Test approval");
    expect(paused.status).toBe("paused");

    const current = state.loadCurrent();
    expect(current).not.toBeNull();
    expect(current!.status).toBe("paused");

    const resumeEngine = new WorkflowEngine(
      registry, contextBuilder, state, taskManager,
      { execute: async () => "code output" },
      { checkTestsPass: async () => true, checkReviewPass: () => true, requestUserApproval: async () => true },
      resolver,
    );

    const completed = await resumeEngine.resume(paused.id, "approved plan");
    expect(completed.status).toBe("completed");
  });

  it("MCP handlers work with vault data", async () => {
    const { ToolHandlers } = await import("../src/mcp/handlers.js");

    const vaultReader = new VaultReader(context);
    const vaultWriter = new VaultWriter(context);
    const registry = new AgentRegistry(agentsDir);
    const contextBuilder = new AgentContextBuilder(vaultReader, context);
    const taskManager = new TaskManager(vaultPath);

    const handlers = new ToolHandlers(
      vaultReader, vaultWriter, context, registry, contextBuilder, taskManager,
    );

    const stack = await handlers.handle("vault_read", { section: "stack" });
    expect(stack).toContain("TypeScript 6.0");

    const search = await handlers.handle("vault_search", { query: "camelCase" }) as Array<unknown>;
    expect(search.length).toBeGreaterThan(0);

    const created = await handlers.handle("task_create", { title: "Integration task" }) as { id: string };
    expect(created.id).toBe("task-001");

    const agents = await handlers.handle("agent_list", {}) as Array<{ name: string }>;
    expect(agents).toHaveLength(6);
  });
});
