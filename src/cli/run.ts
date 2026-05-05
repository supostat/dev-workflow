import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve as resolvePath, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { detectContext } from "../lib/context.js";
import { VaultReader } from "../lib/reader.js";
import { AgentRegistry } from "../agents/registry.js";
import { AgentContextBuilder } from "../agents/context-builder.js";
import { TaskManager } from "../tasks/manager.js";
import { WorkflowEngine } from "../workflow/engine.js";
import type { StepExecutor, GateChecker } from "../workflow/engine.js";
import { WorkflowState } from "../workflow/state.js";
import { getBuiltinWorkflow, getBuiltinWorkflows } from "../workflow/builtin.js";
import { loadCustomWorkflows, parseWorkflowYaml } from "../workflow/loader.js";
import { validateOnFailRouting } from "../workflow/validate.js";
import type { PreparedAgent } from "../agents/types.js";
import type { WorkflowDefinition } from "../workflow/types.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const WORKFLOW_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const OUTPUT_BLOCK_PATTERN = /^[A-Z][A-Z0-9_]{1,64}$/;
const VALID_GATES: ReadonlySet<string> = new Set([
  "none", "user-approve", "tests-pass", "review-pass", "custom-command",
]);
const DEV_CLASS_AGENTS: ReadonlySet<string> = new Set(["coder", "committer"]);
const STEP_FILE_ALLOWED_PREFIXES = [
  ".dev-vault/workflow-steps",
  "templates/claude/commands/workflow/steps",
];

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

  async checkCustomCommand(command: string): Promise<boolean> {
    try {
      execSync(command, { stdio: "inherit" });
      return true;
    } catch {
      return false;
    }
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
  const resolver = { resolve: (name: string): WorkflowDefinition => resolveWorkflow(name, vaultPath) };

  return new WorkflowEngine(
    registry, contextBuilder, state, taskManager,
    new CliStepExecutor(), new CliGateChecker(), resolver,
  );
}

export function resolveWorkflow(name: string, vaultPath: string): WorkflowDefinition {
  const vaultMatch = loadCustomWorkflows(vaultPath).find((w) => w.name === name);
  if (vaultMatch) return vaultMatch;

  const libraryMatch = loadCustomWorkflows(join(PACKAGE_ROOT, "templates")).find((w) => w.name === name);
  if (libraryMatch) return libraryMatch;

  return getBuiltinWorkflow(name);
}

export function listAvailableWorkflows(vaultPath: string): string[] {
  const names = new Set<string>();
  for (const workflow of loadCustomWorkflows(vaultPath)) names.add(workflow.name);
  for (const workflow of loadCustomWorkflows(join(PACKAGE_ROOT, "templates"))) names.add(workflow.name);
  for (const workflow of getBuiltinWorkflows()) names.add(workflow.name);
  return [...names].sort();
}

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

  if (dryRun) {
    console.log(`\n\uD83D\uDD04 Workflow: ${workflow.name} \u2014 ${workflow.description}\n`);
    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i]!;
      const gate = step.gate === "none" ? "" : ` [${step.gate}]`;
      const fail = step.onFail ? ` \u2192 retry: ${step.onFail}` : "";
      console.log(`  \u25CB ${step.name.padEnd(12)} ${step.agent}${gate}${fail}`);
    }
    console.log(`\n\uD83D\uDCDD Task: ${taskDescription}`);
    if (taskId) console.log(`\uD83D\uDD17 Linked: ${taskId}`);
    console.log(`\nRun without --dry-run to execute.`);
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

function checkStepFile(stepFile: string): string | null {
  if (stepFile.includes("..")) {
    return `stepFile "${stepFile}" contains ".." — path traversal not allowed`;
  }
  if (isAbsolute(stepFile)) {
    return `stepFile "${stepFile}" is absolute — relative path required`;
  }

  const cwd = process.cwd();
  const resolved = resolvePath(cwd, stepFile);
  const allowedRoots = STEP_FILE_ALLOWED_PREFIXES.map((prefix) => resolvePath(cwd, prefix));
  const insideAllowed = allowedRoots.some(
    (root) => resolved === root || resolved.startsWith(`${root}/`),
  );
  if (!insideAllowed) {
    return `stepFile "${stepFile}" resolves outside allowed directories (${STEP_FILE_ALLOWED_PREFIXES.join(", ")})`;
  }

  if (!existsSync(resolved)) {
    return `stepFile "${stepFile}" does not exist at ${resolved}`;
  }

  return null;
}

export function validate(args: string[]): void {
  const filepath = args[0];
  if (!filepath) {
    console.error("Usage: dev-workflow validate <workflow.yaml>");
    process.exitCode = 1;
    return;
  }

  let workflow: WorkflowDefinition;
  try {
    const content = readFileSync(filepath, "utf-8");
    workflow = parseWorkflowYaml(content);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Parse error";
    console.error(`Invalid workflow: ${message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Valid workflow: ${workflow.name}`);
  console.log(`Description: ${workflow.description}`);
  console.log(`Steps: ${workflow.steps.length}`);

  const warnings: string[] = [];

  if (!WORKFLOW_NAME_PATTERN.test(workflow.name)) {
    warnings.push(`workflow name "${workflow.name}" does not match ${WORKFLOW_NAME_PATTERN}`);
  }

  const stepNames = new Set(workflow.steps.map((step) => step.name));
  const hasDevAgent = workflow.steps.some((step) => DEV_CLASS_AGENTS.has(step.agent));
  if (hasDevAgent && !stepNames.has("vault-updates")) {
    warnings.push(
      'dev-class workflow (uses coder/committer) should declare a "vault-updates" step — vault drift risk',
    );
  }

  for (const step of workflow.steps) {
    const issues: string[] = [];
    if (!step.agent) issues.push("missing agent");
    if (!VALID_GATES.has(step.gate)) issues.push(`unknown gate: ${step.gate}`);
    const status = issues.length > 0 ? ` — ${issues.join(", ")}` : "";
    console.log(`  ${step.name}: ${step.agent} [${step.gate}]${status}`);

    if (step.outputBlock !== undefined && !OUTPUT_BLOCK_PATTERN.test(step.outputBlock)) {
      warnings.push(
        `step "${step.name}": outputBlock "${step.outputBlock}" does not match ${OUTPUT_BLOCK_PATTERN}`,
      );
    }

    if (step.onFail !== null && !stepNames.has(step.onFail)) {
      warnings.push(`step "${step.name}": onFail references unknown step "${step.onFail}"`);
    }

    if (step.stepFile !== undefined) {
      const stepFileIssue = checkStepFile(step.stepFile);
      if (stepFileIssue) {
        warnings.push(`step "${step.name}": ${stepFileIssue}`);
      }
    }
  }

  warnings.push(...validateOnFailRouting(workflow));

  if (warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warning of warnings) {
      console.log(`  ${warning}`);
    }
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
