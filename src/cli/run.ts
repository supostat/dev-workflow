import { detectContext } from "../lib/context.js";
import { resolveWorkflow, listAvailableWorkflows } from "../workflow/resolver.js";
import { createEngine } from "./cli-engine.js";
import { buildDryRunPreview, renderDryRunPretty } from "./dry-run.js";
import type { WorkflowDefinition } from "../workflow/types.js";

function parseFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index >= args.length - 1) return undefined;
  return args[index + 1];
}

export async function run(args: string[]): Promise<void> {
  console.log("Note: CLI workflows output agent prompts but do not execute them.");
  console.log("For full pipeline execution, use /workflow:dev in Claude Code.\n");

  const context = detectContext();
  if (!context) {
    console.error("Not a git repository.");
    process.exitCode = 1;
    return;
  }

  const workflowName = args[0];
  if (!workflowName) {
    console.error("Usage: dev-workflow run <workflow> \"task description\" [--task <id>]");
    console.error("Workflows: dev, hotfix, review, test, intake");
    process.exitCode = 1;
    return;
  }

  let workflow: WorkflowDefinition;
  try {
    workflow = resolveWorkflow(workflowName, context.vaultPath);
  } catch {
    const available = listAvailableWorkflows(context.vaultPath);
    console.error(`Unknown workflow: ${workflowName}`);
    if (available.length > 0) {
      console.error(`Available: ${available.join(", ")}`);
    }
    process.exitCode = 1;
    return;
  }

  const taskDescription = args.filter((a) => !a.startsWith("--")).slice(1).join(" ") || workflowName;
  const taskId = parseFlag(args, "--task");
  const dryRun = args.includes("--dry-run");
  const jsonMode = args.includes("--json");

  if (dryRun) {
    const preview = buildDryRunPreview(workflow, taskDescription, taskId);
    if (jsonMode) {
      console.log(JSON.stringify(preview, null, 2));
    } else {
      renderDryRunPretty(preview);
    }
    return;
  }

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
