import { existsSync, readFileSync } from "node:fs";
import { join, resolve as resolvePath, isAbsolute } from "node:path";
import { AgentRegistry } from "../agents/registry.js";
import { parseWorkflowYaml } from "../workflow/loader.js";
import {
  validateCustomAgentPermissions,
  validateOnFailRouting,
} from "../workflow/validate.js";
import type { WorkflowDefinition } from "../workflow/types.js";
import { PACKAGE_ROOT } from "../lib/package-root.js";

const WORKFLOW_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const OUTPUT_BLOCK_PATTERN = /^[A-Z][A-Z0-9_]{1,64}$/;
const VALID_GATES: ReadonlySet<string> = new Set([
  "none", "user-approve", "tests-pass", "review-pass", "custom-command",
]);
const DEV_CLASS_AGENTS: ReadonlySet<string> = new Set(["coder", "committer"]);
const STEP_FILE_ALLOWED_PREFIXES = [
  ".dev-vault/workflow-steps",
  "templates/claude/skills/workflow__dev/steps",
];

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
  warnings.push(...validateCustomAgentPermissions(customAgentsDir));

  if (warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warning of warnings) {
      console.log(`  ${warning}`);
    }
  }
}
