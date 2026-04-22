import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serializeWorkflowYaml } from "../lib/yaml-serialize.js";
import { parseWorkflowYaml } from "../workflow/loader.js";
import type {
  WorkflowDefinition,
  StepDefinition,
  GateType,
  SubagentType,
} from "../workflow/types.js";

const WORKFLOW_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const STEP_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const AGENT_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const OUTPUT_BLOCK_PATTERN = /^[A-Z][A-Z0-9_]{1,64}$/;
const STEP_FILE_PATTERN = /^[a-z0-9][a-z0-9_/.-]*\.md$/;
const VALID_GATES: ReadonlySet<string> = new Set([
  "none",
  "user-approve",
  "tests-pass",
  "review-pass",
  "custom-command",
]);
const VALID_SUBAGENTS: ReadonlySet<string> = new Set(["Explore", "Full", "bash"]);

export interface WorkflowCreateStepInput {
  name: string;
  agent: string;
  input?: string[];
  gate?: string;
  gateCommand?: string;
  onFail?: string;
  maxAttempts?: number;
  stepFile?: string;
  subagent?: string;
  outputBlock?: string;
}

export interface WorkflowCreateInput {
  name: string;
  description: string;
  match?: string[];
  steps: WorkflowCreateStepInput[];
}

export function createWorkflow(
  input: WorkflowCreateInput,
  vaultPath: string,
): { filepath: string } {
  validateInput(input);

  const workflow: WorkflowDefinition = {
    name: input.name,
    description: sanitizeDescription(input.description),
    match: input.match ?? [],
    steps: input.steps.map((step) => buildStep(step)),
  };

  validateStepReferences(workflow);

  const workflowsDir = join(vaultPath, "workflows");
  const filepath = join(workflowsDir, `${workflow.name}.yaml`);

  if (existsSync(filepath)) {
    throw new Error(
      `Workflow "${workflow.name}" already exists. Delete or rename first.`,
    );
  }

  const serialized = serializeWorkflowYaml(workflow);
  const roundTripped = parseWorkflowYaml(serialized);
  if (JSON.stringify(roundTripped) !== JSON.stringify(workflow)) {
    throw new Error("Internal error: serialized workflow failed deep round-trip validation");
  }

  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(filepath, serialized, "utf-8");

  return { filepath };
}

function validateInput(input: WorkflowCreateInput): void {
  if (typeof input.name !== "string" || !WORKFLOW_NAME_PATTERN.test(input.name)) {
    throw new Error(
      `Invalid workflow name "${input.name}": must match ^[a-z0-9][a-z0-9_-]{0,63}$`,
    );
  }
  if (typeof input.description !== "string" || input.description.trim().length === 0) {
    throw new Error("Workflow description is required and cannot be empty");
  }
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw new Error("Workflow must have at least 1 step");
  }
  for (const step of input.steps) {
    if (typeof step.name !== "string" || !STEP_NAME_PATTERN.test(step.name)) {
      throw new Error(
        `Step name "${step.name}" must match ^[a-z0-9][a-z0-9_-]{0,63}$`,
      );
    }
    if (typeof step.agent !== "string" || !AGENT_NAME_PATTERN.test(step.agent)) {
      throw new Error(
        `Step "${step.name}": agent "${step.agent}" must match ^[a-z0-9][a-z0-9_-]{0,63}$`,
      );
    }
    if (step.gate !== undefined && !VALID_GATES.has(step.gate)) {
      throw new Error(`Step "${step.name}": invalid gate "${step.gate}"`);
    }
    if (step.subagent !== undefined && !VALID_SUBAGENTS.has(step.subagent)) {
      throw new Error(`Step "${step.name}": invalid subagent "${step.subagent}"`);
    }
    if (step.outputBlock !== undefined && !OUTPUT_BLOCK_PATTERN.test(step.outputBlock)) {
      throw new Error(
        `Step "${step.name}": outputBlock "${step.outputBlock}" must match ^[A-Z][A-Z0-9_]{1,64}$`,
      );
    }
    if (step.stepFile !== undefined) {
      if (step.stepFile.includes("..") || step.stepFile.startsWith("/")) {
        throw new Error(
          `Step "${step.name}": stepFile "${step.stepFile}" must be a relative path without ".."`,
        );
      }
      if (!STEP_FILE_PATTERN.test(step.stepFile)) {
        throw new Error(
          `Step "${step.name}": stepFile "${step.stepFile}" must match ^[a-z0-9][a-z0-9_/.-]*\\.md$`,
        );
      }
    }
    if (step.gateCommand !== undefined && /[\r\n]/.test(step.gateCommand)) {
      throw new Error(
        `Step "${step.name}": gateCommand must not contain line breaks`,
      );
    }
    if (typeof step.onFail === "string" && /[\r\n]/.test(step.onFail)) {
      throw new Error(`Step "${step.name}": onFail must not contain line breaks`);
    }
    for (const entry of step.input ?? []) {
      if (typeof entry !== "string" || /[\r\n,\]]/.test(entry)) {
        throw new Error(
          `Step "${step.name}": input entry "${entry}" must be a string without line breaks or brackets`,
        );
      }
    }
  }
}

function sanitizeDescription(raw: string): string {
  return raw.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function buildStep(input: WorkflowCreateStepInput): StepDefinition {
  const step: StepDefinition = {
    name: input.name,
    agent: input.agent,
    input: input.input ?? [],
    gate: (input.gate as GateType | undefined) ?? "none",
    onFail: input.onFail ?? null,
    maxAttempts: input.maxAttempts ?? 3,
  };
  if (input.gateCommand !== undefined) step.gateCommand = input.gateCommand;
  if (input.stepFile !== undefined) step.stepFile = input.stepFile;
  if (input.subagent !== undefined) step.subagent = input.subagent as SubagentType;
  if (input.outputBlock !== undefined) step.outputBlock = input.outputBlock;
  return step;
}

function validateStepReferences(workflow: WorkflowDefinition): void {
  const stepNames = new Set(workflow.steps.map((step) => step.name));
  for (const step of workflow.steps) {
    if (step.onFail !== null && !stepNames.has(step.onFail)) {
      throw new Error(
        `Step "${step.name}": onFail references unknown step "${step.onFail}"`,
      );
    }
  }
}
