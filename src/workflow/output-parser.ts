import type { WorkflowDefinition } from "./types.js";

const VERDICT_PATTERN = /^Verdict:\s*(APPROVED|NEEDS_REVISION)\s*$/m;
const NEXT_PATTERN = /^Next:\s*([a-z][a-z0-9_-]*)\s*$/m;

export type Verdict = "APPROVED" | "NEEDS_REVISION";

export function extractVerdict(output: string): Verdict | null {
  const match = output.match(VERDICT_PATTERN);
  if (!match) return null;
  return match[1] as Verdict;
}

export function extractNextTarget(output: string): string | null {
  const match = output.match(NEXT_PATTERN);
  return match ? match[1]! : null;
}

/**
 * Whitelist for Next directive override.
 * Allows override only when target step is a Full-subagent fix step.
 *
 * Defense against malicious agent output that emits `Next: commit` (or similar)
 * to skip mandatory code/review/test/verify gates.
 *
 * Allowed targets are steps whose:
 * - agent === "coder" (Full subagent), AND
 * - name ends with `-fix` (semantic indicator of patch/revision intent)
 *
 * Other targets (commit, test, verify, review, vault-updates, etc.) are rejected
 * even if they exist in workflow.steps.
 */
export function isAllowedNextTarget(
  target: string,
  workflow: WorkflowDefinition,
): boolean {
  const step = workflow.steps.find((s) => s.name === target);
  if (!step) return false;
  return step.agent === "coder" && step.name.endsWith("-fix");
}
