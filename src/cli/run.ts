import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve as resolvePath, isAbsolute } from "node:path";

/**
 * Hardcoded allowlist for `custom-command` gate binaries. Restricts what
 * `gateCommand: "<bin> [args]"` from workflow YAML can invoke at runtime.
 *
 * Shells (bash, sh, zsh, fish) are deliberately excluded — allowing them would
 * re-enable RCE via child-shell interpretation of args (e.g. `bash -c "rm -rf $HOME"`).
 * For composite gate logic, users must move to a script file invoked via `node`.
 *
 * Adding a binary here requires a security review PR — these are all of the form
 * "tools that read project files and exit, with no shell-like interpolation surface".
 */
export const ALLOWED_GATE_BINARIES: ReadonlySet<string> = new Set([
  "npm", "pnpm", "yarn", "npx",
  "vitest", "jest",
  "tsc", "eslint", "prettier",
  "node",
]);

/**
 * Run a binary with literal args, inheriting parent stdio so the user sees
 * test/lint output in real time. No shell — args pass through verbatim.
 * Resolves to true iff the child exits with code 0; false on spawn error
 * (ENOENT, EACCES) or non-zero exit. Never throws — gate semantics handle
 * boolean. Allowlist rejection happens BEFORE this is called.
 */
function runGateBinary(bin: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: "inherit" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}
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
import type { WorkflowDefinition, StepDefinition } from "../workflow/types.js";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { resolveSubagent, type ResolvedSubagentInfo } from "../lib/workflow-render.js";

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

export class CliGateChecker implements GateChecker {
  /**
   * Run the project's test command (trusted source — comes from
   * `agent.permissions.shellCommands[0]` set in agent definitions, NOT from
   * user-supplied workflow YAML). No allowlist check: the threat model treats
   * agent definitions as trusted (bundled, version-controlled). Empty/invalid
   * input returns false silently — caller handles boolean as gate result.
   */
  async checkTestsPass(command: string): Promise<boolean> {
    const [bin, ...args] = command.trim().split(/\s+/);
    if (!bin) return false;
    return runGateBinary(bin, args);
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

  /**
   * Run a user-supplied `gateCommand` from workflow YAML. Untrusted input —
   * THROWS on allowlist rejection (the engine catches and marks the step
   * failed with the message). Non-zero exit returns false (gate fails
   * cleanly, no throw). Asymmetric with `checkTestsPass`: only this method
   * exposes user YAML to spawn, so only this one needs the allowlist.
   */
  async checkCustomCommand(command: string): Promise<boolean> {
    const [bin, ...args] = command.trim().split(/\s+/);
    if (!bin) {
      throw new Error(
        "gateCommand is empty after trim/split — must be \"<allowed-binary> [args]\". " +
        `Allowed binaries: ${[...ALLOWED_GATE_BINARIES].sort().join(", ")}.`,
      );
    }
    if (!ALLOWED_GATE_BINARIES.has(bin)) {
      throw new Error(
        `gateCommand binary "${bin}" is not in the allowlist. ` +
        `Allowed: ${[...ALLOWED_GATE_BINARIES].sort().join(", ")}. ` +
        "Shell metacharacters (|, ;, &&, $, backtick) and arbitrary binaries are blocked " +
        "to prevent RCE via YAML injection. To compose multiple commands, move them to a " +
        "script file invoked via an allowlisted binary (e.g. \"node scripts/gate.js\").",
      );
    }
    return runGateBinary(bin, args);
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

/**
 * Stable JSON contract for `dev-workflow run <name> --dry-run --json`.
 * Tooling consumers (CI dashboards, workflow inspectors) rely on this
 * shape. Post-1.0.x additive changes only; removals/renames require
 * a major version bump.
 */
export interface DryRunStepPreview {
  index: number;
  name: string;
  agent: string;
  subagent: ResolvedSubagentInfo["subagent"];
  subagentProvenance: string;
  gate: string;
  gateCommand: string | null;
  input: string[];
  outputBlock: string | null;
  stepFile: string | null;
  onFail: string | null;
  maxAttempts: number;
}

export interface DryRunPreview {
  workflow: { name: string; description: string };
  task: { description: string; taskId: string | null };
  stepCount: number;
  steps: DryRunStepPreview[];
}

export function buildDryRunPreview(
  workflow: WorkflowDefinition,
  taskDescription: string,
  taskId?: string,
): DryRunPreview {
  return {
    workflow: { name: workflow.name, description: workflow.description },
    task: { description: taskDescription, taskId: taskId ?? null },
    stepCount: workflow.steps.length,
    steps: workflow.steps.map((step, index) => buildStepPreview(step, index)),
  };
}

function buildStepPreview(step: StepDefinition, index: number): DryRunStepPreview {
  const sub = resolveSubagent(step);
  return {
    index,
    name: step.name,
    agent: step.agent,
    subagent: sub.subagent,
    subagentProvenance: sub.provenance,
    gate: step.gate,
    gateCommand: step.gateCommand ?? null,
    input: step.input,
    outputBlock: step.outputBlock ?? null,
    stepFile: step.stepFile ?? null,
    onFail: step.onFail,
    maxAttempts: step.maxAttempts,
  };
}

function renderDryRunPretty(preview: DryRunPreview): void {
  console.log(`\n🔄 Workflow: ${preview.workflow.name} — ${preview.workflow.description}`);
  console.log(`📝 Task: ${preview.task.description}`);
  if (preview.task.taskId) console.log(`🔗 Linked: ${preview.task.taskId}`);
  console.log(`\nSteps (${preview.stepCount}):`);
  for (const step of preview.steps) {
    const gate = step.gate === "none" ? "" : ` gate=${step.gate}`;
    const gateCmd = step.gateCommand ? ` cmd="${step.gateCommand}"` : "";
    const fail = step.onFail ? ` onFail→${step.onFail}` : "";
    const subagent = step.subagent === "orchestrator" ? "orch" : step.subagent;
    const inputs = step.input.length > 0 ? ` ← [${step.input.join(", ")}]` : "";
    const out = step.outputBlock ? ` → ${step.outputBlock}` : "";
    const attempts = step.maxAttempts !== 3 ? ` max=${step.maxAttempts}` : "";

    console.log(`  ${String(step.index + 1).padStart(2)}. ${step.name.padEnd(14)} [${subagent.padEnd(6)}] ${step.agent}${gate}${gateCmd}${fail}${attempts}`);
    if (inputs || out) {
      console.log(`      ${inputs}${out}`.trim());
    }
  }
  console.log(`\nRun without --dry-run to execute. Use --json for tooling-friendly output.`);
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

  // Pre-flight agent registry: bundled agents always; custom from .dev-vault/agents/
  // if present at cwd (project root). Closes debt 2026-04-22-loaderts finding #2
  // (HIGH agent resolution validation). Without this, a typo in `agent:` only
  // surfaces at runtime when the engine first tries to resolve the step —
  // pipeline aborts mid-execution after preflight, losing accumulated work.
  const builtinAgentsDir = join(PACKAGE_ROOT, "templates", "agents");
  const customAgentsDir = join(process.cwd(), ".dev-vault", "agents");
  const agentRegistry = new AgentRegistry(builtinAgentsDir, customAgentsDir);

  for (const step of workflow.steps) {
    const issues: string[] = [];
    if (!step.agent) issues.push("missing agent");
    if (!VALID_GATES.has(step.gate)) issues.push(`unknown gate: ${step.gate}`);
    const status = issues.length > 0 ? ` — ${issues.join(", ")}` : "";
    console.log(`  ${step.name}: ${step.agent} [${step.gate}]${status}`);

    if (step.agent && !agentRegistry.has(step.agent)) {
      warnings.push(
        `step "${step.name}": agent "${step.agent}" not found in bundled templates/agents/ or .dev-vault/agents/`,
      );
    }

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
