import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { detectContext } from "../lib/context.js";
import { VaultReader } from "../lib/reader.js";
import { AgentRegistry } from "../agents/registry.js";
import { AgentContextBuilder } from "../agents/context-builder.js";
import { TaskManager } from "../tasks/manager.js";
import { WorkflowEngine } from "../workflow/engine.js";
import type { StepExecutor, GateChecker } from "../workflow/engine.js";
import { WorkflowState } from "../workflow/state.js";
import { getBuiltinWorkflow } from "../workflow/builtin.js";
import { loadCustomWorkflows } from "../workflow/loader.js";
import type { PreparedAgent } from "../agents/types.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

class CliStepExecutor implements StepExecutor {
  async execute(agent: PreparedAgent): Promise<string> {
    console.log(`\n--- Agent: ${agent.definition.name} ---`);
    console.log(agent.resolvedPrompt);
    console.log(`--- End ---\n`);
    return "Executed via CLI output";
  }
}

class CliGateChecker implements GateChecker {
  async checkTestsPass(command: string): Promise<boolean> {
    try {
      execSync(command, { stdio: "inherit" });
      return true;
    } catch {
      return false;
    }
  }

  checkReviewPass(reviewOutput: string): boolean {
    return !/severity:\s*(high|critical)/i.test(reviewOutput)
      && !/\bBLOCKER\b/.test(reviewOutput)
      && !/\bMUST FIX\b/i.test(reviewOutput);
  }

  async requestUserApproval(stepName: string, context: string): Promise<boolean> {
    console.log(`\nStep '${stepName}' requires approval.`);
    console.log(context);
    return true;
  }
}

function createEngine(vaultPath: string, projectRoot: string) {
  const context = detectContext(projectRoot)!;
  const vaultReader = new VaultReader(context);
  const agentsDir = join(PACKAGE_ROOT, "templates", "agents");
  const customAgentsDir = join(vaultPath, "agents");
  const registry = new AgentRegistry(agentsDir, customAgentsDir);
  const contextBuilder = new AgentContextBuilder(vaultReader, context);
  const state = new WorkflowState(vaultPath);
  const taskManager = new TaskManager(vaultPath);
  const resolver = { resolve: getBuiltinWorkflow };

  return new WorkflowEngine(
    registry, contextBuilder, state, taskManager,
    new CliStepExecutor(), new CliGateChecker(), resolver,
  );
}

function parseFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index >= args.length - 1) return undefined;
  return args[index + 1];
}

export async function run(args: string[]): Promise<void> {
  const context = detectContext();
  if (!context) {
    console.error("Not a git repository.");
    process.exitCode = 1;
    return;
  }

  const workflowName = args[0];
  if (!workflowName) {
    console.error("Usage: dev-workflow run <workflow> \"task description\" [--task <id>]");
    console.error("Workflows: dev, hotfix, review, test");
    process.exitCode = 1;
    return;
  }

  let workflow;
  try {
    workflow = getBuiltinWorkflow(workflowName);
  } catch {
    const custom = loadCustomWorkflows(context.vaultPath);
    workflow = custom.find((w) => w.name === workflowName);
    if (!workflow) {
      console.error(`Unknown workflow: ${workflowName}`);
      console.error("Builtin: dev, hotfix, review, test");
      if (custom.length > 0) {
        console.error(`Custom: ${custom.map((w) => w.name).join(", ")}`);
      }
      process.exitCode = 1;
      return;
    }
  }

  const taskDescription = args.filter((a) => !a.startsWith("--")).slice(1).join(" ") || workflowName;
  const taskId = parseFlag(args, "--task");

  const engine = createEngine(context.vaultPath, context.projectRoot);
  const result = await engine.start(workflow, taskDescription, taskId);

  const completedSteps = Object.values(result.steps).filter((s) => s.status === "completed").length;
  const totalSteps = Object.keys(result.steps).length;

  if (result.status === "completed") {
    console.log(`Workflow '${workflowName}' completed. ${completedSteps}/${totalSteps} steps executed.`);
  } else if (result.status === "paused") {
    console.log(`Workflow paused at step '${result.currentStep}'. Run 'dev-workflow resume' to continue.`);
  } else if (result.status === "failed") {
    console.error(`Workflow failed at step '${result.currentStep}'.`);
    process.exitCode = 1;
  }
}

export async function resume(args: string[]): Promise<void> {
  const context = detectContext();
  if (!context) {
    console.error("Not a git repository.");
    process.exitCode = 1;
    return;
  }

  const engine = createEngine(context.vaultPath, context.projectRoot);
  const runId = parseFlag(args, "--run");

  let targetRunId = runId;
  if (!targetRunId) {
    const current = engine.getStatus();
    if (!current) {
      console.error("No paused workflow found.");
      process.exitCode = 1;
      return;
    }
    targetRunId = current.id;
  }

  const result = await engine.resume(targetRunId);

  if (result.status === "completed") {
    console.log(`Workflow '${result.workflowName}' resumed and completed.`);
  } else if (result.status === "paused") {
    console.log(`Workflow paused again at step '${result.currentStep}'.`);
  } else if (result.status === "failed") {
    console.error(`Workflow failed at step '${result.currentStep}'.`);
    process.exitCode = 1;
  }
}
