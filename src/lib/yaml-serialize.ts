import type { WorkflowDefinition, StepDefinition } from "../workflow/types.js";

/**
 * Serialize a WorkflowDefinition to YAML matching the format produced by
 * templates/workflows/*.yaml. Applies omit-defaults convention so output
 * round-trips through parseWorkflowYaml (parser re-applies defaults in
 * finalizeStep).
 *
 * Defaults omitted:
 *  - step.gate === "none"
 *  - step.onFail === null
 *  - step.maxAttempts === 3
 *  - step.input is empty
 *  - workflow.match is empty
 *  - optional fields undefined (gateCommand, stepFile, subagent, outputBlock)
 */
export function serializeWorkflowYaml(workflow: WorkflowDefinition): string {
  const lines: string[] = [];
  lines.push(`name: ${workflow.name}`);
  lines.push(`description: ${workflow.description}`);
  if (workflow.match.length > 0) {
    lines.push(`match: [${workflow.match.join(", ")}]`);
  }
  lines.push("steps:");
  for (const step of workflow.steps) {
    lines.push(...serializeStep(step));
  }
  return lines.join("\n") + "\n";
}

function serializeStep(step: StepDefinition): string[] {
  const lines: string[] = [];
  lines.push(`  - name: ${step.name}`);
  lines.push(`    agent: ${step.agent}`);
  if (step.input.length > 0) {
    lines.push(`    input: [${step.input.join(", ")}]`);
  }
  if (step.gate !== "none") {
    lines.push(`    gate: ${step.gate}`);
  }
  if (step.gateCommand !== undefined) {
    lines.push(`    gateCommand: ${step.gateCommand}`);
  }
  if (step.onFail !== null) {
    lines.push(`    onFail: ${step.onFail}`);
  }
  if (step.maxAttempts !== 3) {
    lines.push(`    maxAttempts: ${step.maxAttempts}`);
  }
  if (step.stepFile !== undefined) {
    lines.push(`    stepFile: ${step.stepFile}`);
  }
  if (step.subagent !== undefined) {
    lines.push(`    subagent: ${step.subagent}`);
  }
  if (step.outputBlock !== undefined) {
    lines.push(`    outputBlock: ${step.outputBlock}`);
  }
  return lines;
}
