import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowDefinition, StepDefinition, GateType } from "./types.js";

const VALID_GATES: ReadonlySet<string> = new Set(["none", "user-approve", "tests-pass", "review-pass", "custom-command"]);

function parseYamlLine(line: string): { key: string; value: string } | null {
  const match = line.match(/^(\s*)(\w[\w-]*):\s*(.*)$/);
  if (!match) return null;
  return { key: match[2]!, value: match[3]!.trim() };
}

function parseYamlArray(value: string): string[] {
  const match = value.match(/^\[(.*)]\s*$/);
  if (match) {
    return match[1]!.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

export function parseWorkflowYaml(content: string): WorkflowDefinition {
  const lines = content.split("\n");

  let name = "";
  let description = "";
  let match: string[] = [];
  const steps: StepDefinition[] = [];
  let currentStep: Partial<StepDefinition> | null = null;

  for (const line of lines) {
    const trimmed = line.trimStart();

    if (trimmed.startsWith("- name:")) {
      if (currentStep?.name) {
        steps.push(finalizeStep(currentStep));
      }
      currentStep = { name: trimmed.replace("- name:", "").trim() };
      continue;
    }

    if (currentStep) {
      const parsed = parseYamlLine(trimmed);
      if (!parsed) continue;

      switch (parsed.key) {
        case "agent":
          currentStep.agent = parsed.value;
          break;
        case "gate":
          if (VALID_GATES.has(parsed.value)) {
            currentStep.gate = parsed.value as GateType;
          }
          break;
        case "gateCommand":
          currentStep.gateCommand = parsed.value || undefined;
          break;
        case "onFail":
          currentStep.onFail = parsed.value || null;
          break;
        case "maxAttempts":
          currentStep.maxAttempts = parseInt(parsed.value, 10) || 3;
          break;
        case "input":
          currentStep.input = parseYamlArray(parsed.value);
          break;
      }
      continue;
    }

    const parsed = parseYamlLine(trimmed);
    if (!parsed) continue;

    switch (parsed.key) {
      case "name":
        name = parsed.value;
        break;
      case "description":
        description = parsed.value;
        break;
      case "match":
        match = parseYamlArray(parsed.value);
        break;
    }
  }

  if (currentStep?.name) {
    steps.push(finalizeStep(currentStep));
  }

  if (!name) throw new Error("Workflow yaml missing 'name' field");
  if (steps.length === 0) throw new Error("Workflow yaml has no steps");

  return { name, description, match, steps };
}

function finalizeStep(partial: Partial<StepDefinition>): StepDefinition {
  return {
    name: partial.name ?? "",
    agent: partial.agent ?? partial.name ?? "",
    input: partial.input ?? [],
    gate: partial.gate ?? "none",
    gateCommand: partial.gateCommand,
    onFail: partial.onFail ?? null,
    maxAttempts: partial.maxAttempts ?? 3,
  };
}

export function loadCustomWorkflows(vaultPath: string): WorkflowDefinition[] {
  const workflowsDir = join(vaultPath, "workflows");
  if (!existsSync(workflowsDir)) return [];

  const files = readdirSync(workflowsDir)
    .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"));

  const workflows: WorkflowDefinition[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(workflowsDir, file), "utf-8");
      workflows.push(parseWorkflowYaml(content));
    } catch {
      continue;
    }
  }

  return workflows;
}
