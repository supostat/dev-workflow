import type { StepDefinition, WorkflowDefinition } from "./types.js";

type BuiltinSubagentType = "Explore" | "Full" | "bash";

const BUILTIN_AGENT_SUBAGENT: ReadonlyMap<string, BuiltinSubagentType> = new Map([
  ["reader", "Explore"],
  ["planner", "Explore"],
  ["plan-reviewer", "Explore"],
  ["reviewer", "Explore"],
  ["verifier", "Explore"],
  ["intake", "Explore"],
  ["coder", "Full"],
  ["committer", "Full"],
  ["tester", "bash"],
]);

function resolveSubagentType(step: StepDefinition): BuiltinSubagentType | null {
  if (step.subagent) return step.subagent;
  return BUILTIN_AGENT_SUBAGENT.get(step.agent) ?? null;
}

function detectOnFailCycles(workflow: WorkflowDefinition): string[] {
  const warnings: string[] = [];
  const stepByName = new Map(workflow.steps.map((step) => [step.name, step] as const));

  for (const start of workflow.steps) {
    if (!start.onFail) continue;

    const path: string[] = [start.name];
    let current: string | null = start.onFail;

    while (current) {
      if (current === start.name) {
        warnings.push(
          `step "${start.name}": onFail forms a cycle (${[...path, current].join(" → ")})`,
        );
        break;
      }
      if (path.includes(current)) break;
      path.push(current);
      current = stepByName.get(current)?.onFail ?? null;
    }
  }

  return warnings;
}

/**
 * Validate static onFail edges declared in workflow YAML.
 *
 * Returns advisory warnings (CLI logs them; does not fail load).
 *
 * Checks:
 * - Full→Explore mismatches (output structure of Full agent likely incompatible
 *   with Explore-target prompt expectations).
 * - Cycles via DFS (A→B→A, A→A self-loop, A→B→C→A).
 *
 * Note: Runtime `Next:` directives override onFail and are validated separately
 * in `engine.ts` via `isAllowedNextTarget` (whitelist) — this function only
 * inspects YAML-declared edges.
 */
export function validateOnFailRouting(workflow: WorkflowDefinition): string[] {
  const warnings: string[] = [];
  const stepByName = new Map(workflow.steps.map((step) => [step.name, step] as const));

  for (const step of workflow.steps) {
    if (!step.onFail) continue;
    const target = stepByName.get(step.onFail);
    if (!target) continue;

    const sourceType = resolveSubagentType(step);
    const targetType = resolveSubagentType(target);

    if (sourceType === "Full" && targetType === "Explore") {
      warnings.push(
        `step "${step.name}": onFail target "${step.onFail}" routes Full agent (${step.agent}) to Explore agent (${target.agent}) — output structure mismatch risk`,
      );
    }
  }

  warnings.push(...detectOnFailCycles(workflow));
  return warnings;
}
