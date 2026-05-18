import { resolveSubagent } from "../lib/workflow-render.js";
import type { ResolvedSubagentInfo } from "../lib/workflow-render.js";
import type { WorkflowDefinition, StepDefinition } from "../workflow/types.js";

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

export function renderDryRunPretty(preview: DryRunPreview): void {
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
