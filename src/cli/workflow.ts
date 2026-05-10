import { detectContext } from "../lib/context.js";
import {
  renderShow,
  renderGraphMermaid,
  renderGraphAscii,
  renderEffective,
} from "../lib/workflow-render.js";
import type { WorkflowDefinition } from "../workflow/types.js";
import { listAvailableWorkflows, resolveWorkflow } from "./run.js";

const SUBCOMMANDS: ReadonlySet<string> = new Set(["show", "graph", "effective"]);

function printUsage(): void {
  console.error("Usage: dev-workflow workflow <subcommand> <name> [options]");
  console.error("");
  console.error("Subcommands:");
  console.error("  show <name> [--bodies]      List steps and metadata");
  console.error("  graph <name> [--ascii]      Render DAG (Mermaid by default)");
  console.error("  effective <name>            Show resolved step-files and subagents");
}

function failWithUsage(message: string): void {
  console.error(message);
  console.error("");
  printUsage();
  process.exitCode = 1;
}

export function runWorkflowCommand(args: string[]): void {
  const subcommand = args[0];
  if (!subcommand) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (!SUBCOMMANDS.has(subcommand)) {
    failWithUsage(`Unknown subcommand: ${subcommand}`);
    return;
  }

  const workflowName = args[1];
  if (!workflowName) {
    failWithUsage(`workflow name required for "${subcommand}"`);
    return;
  }

  const flags = args.slice(2);

  const context = detectContext();
  if (!context) {
    console.error("Not a git repository.");
    process.exitCode = 1;
    return;
  }

  let workflow: WorkflowDefinition;
  try {
    workflow = resolveWorkflow(workflowName, context.vaultPath);
  } catch {
    console.error(`Unknown workflow: ${workflowName}`);
    const available = listAvailableWorkflows(context.vaultPath);
    if (available.length > 0) {
      console.error(`Available: ${available.join(", ")}`);
    }
    process.exitCode = 1;
    return;
  }

  let output: string;
  try {
    if (subcommand === "show") {
      output = renderShow(workflow, { bodies: flags.includes("--bodies") });
    } else if (subcommand === "graph") {
      output = flags.includes("--ascii")
        ? renderGraphAscii(workflow)
        : renderGraphMermaid(workflow);
    } else {
      output = renderEffective(workflow);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Render error";
    console.error(`Failed to render workflow: ${message}`);
    process.exitCode = 1;
    return;
  }

  console.log(output);
}
