import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { parseAgentFile } from "../agents/loader.js";
import type { AgentDefinition } from "../agents/types.js";
import type { StepDefinition, WorkflowDefinition } from "./types.js";

const CANONICAL_PERMISSIONS_HEADING = "## Permissions (VIOLATION = ABORT)";

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

/**
 * Validate that every custom agent template under `.dev-vault/agents/` carries
 * the canonical `## Permissions (VIOLATION = ABORT)` block.
 *
 * After Path D (ADR `2026-05-13-conversational-workflow-subagents-are-mcp-isolated`)
 * the conversational orchestrator dispatches every pipeline subagent via
 * `subagent_type: general-purpose`, which has the full Claude Code tool surface
 * (Edit, Write, Bash, MCP). Role enforcement is now carried by the prompt-level
 * Permissions block in the agent template. A custom user agent that omits the
 * block inherits the full surface regardless of its frontmatter `write` /
 * `shell` / `git` declarations — those declarations are documentation only at
 * the conversational layer.
 *
 * Missing directory → no warnings (silent). Unreadable directory → no warnings.
 * Per-file parse error → one `failed to parse` warning, siblings continue.
 */
export function validateCustomAgentPermissions(customAgentsDir: string): string[] {
  if (!existsSync(customAgentsDir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(customAgentsDir).filter((entry) => entry.endsWith(".md"));
  } catch {
    return [];
  }

  const warnings: string[] = [];
  for (const entry of entries) {
    const filepath = join(customAgentsDir, entry);
    let definition: AgentDefinition;
    try {
      definition = parseAgentFile(filepath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(
        `custom agent ".dev-vault/agents/${basename(filepath)}" failed to parse: ${message}`,
      );
      continue;
    }
    if (!definition.systemPrompt.includes(CANONICAL_PERMISSIONS_HEADING)) {
      warnings.push(
        `custom agent "${definition.name}" at .dev-vault/agents/${basename(filepath)} is missing canonical "${CANONICAL_PERMISSIONS_HEADING}" block — agent inherits full general-purpose tool surface regardless of frontmatter write/shell/git declarations`,
      );
    }
  }
  return warnings;
}
