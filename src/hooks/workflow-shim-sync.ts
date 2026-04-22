import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter, serializeFrontmatter } from "../lib/frontmatter.js";
import type { WorkflowDefinition } from "../workflow/types.js";

export interface ShimSyncResult {
  synced: number;
  skipped: number;
  errors: string[];
}

const GENERATED_MARKER = "true";
const WORKFLOW_SUBDIR = "workflow";
const WORKFLOW_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const DESCRIPTION_MAX_LENGTH = 200;
const DESCRIPTION_FALLBACK = "(no description)";

/**
 * Sync auto-generated workflow shims in .claude/commands/workflow/.
 *
 * For each workflow: render shim with `generated: true` + `source:` frontmatter,
 * write if absent or outdated. Never touches files lacking `generated: true`
 * (builtin shims). Errors logged to result.errors[], never thrown.
 *
 * Idempotency: parsed-structure compare (fields.source + fields.generated +
 * body equality) — avoids line-ending / trailing-whitespace fragility of
 * byte-compare.
 */
export function syncWorkflowShims(
  workflows: WorkflowDefinition[],
  claudeCommandsPath: string,
): ShimSyncResult {
  const result: ShimSyncResult = { synced: 0, skipped: 0, errors: [] };

  if (workflows.length === 0) {
    return result;
  }

  const workflowDir = join(claudeCommandsPath, WORKFLOW_SUBDIR);

  try {
    mkdirSync(workflowDir, { recursive: true });
  } catch (error) {
    result.errors.push(`failed to create ${workflowDir}: ${errorMessage(error)}`);
    return result;
  }

  for (const workflow of workflows) {
    if (!isSafeWorkflowName(workflow.name)) {
      result.errors.push(
        `invalid workflow name "${workflow.name}": must match [a-z0-9][a-z0-9_-]{0,63}`,
      );
      continue;
    }

    const shimPath = join(workflowDir, `${workflow.name}.md`);
    const desired = renderWorkflowShim(workflow);
    syncSingleShim(shimPath, desired, result);
  }

  return result;
}

function isSafeWorkflowName(name: string): boolean {
  return WORKFLOW_NAME_PATTERN.test(name);
}

function syncSingleShim(
  shimPath: string,
  desired: string,
  result: ShimSyncResult,
): void {
  if (existsSync(shimPath)) {
    const existingContent = readShim(shimPath, result);
    if (existingContent === null) return;

    const existing = parseFrontmatter(existingContent);
    if (existing.fields.generated !== GENERATED_MARKER) {
      result.skipped += 1;
      return;
    }

    const desiredParsed = parseFrontmatter(desired);
    if (shimContentEquals(existing, desiredParsed)) {
      result.skipped += 1;
      return;
    }
  }

  try {
    writeFileSync(shimPath, desired, "utf-8");
    result.synced += 1;
  } catch (error) {
    result.errors.push(`failed to write ${shimPath}: ${errorMessage(error)}`);
  }
}

function readShim(shimPath: string, result: ShimSyncResult): string | null {
  try {
    return readFileSync(shimPath, "utf-8");
  } catch (error) {
    result.errors.push(`failed to read ${shimPath}: ${errorMessage(error)}`);
    return null;
  }
}

function shimContentEquals(
  a: ReturnType<typeof parseFrontmatter>,
  b: ReturnType<typeof parseFrontmatter>,
): boolean {
  if (a.fields.generated !== b.fields.generated) return false;
  if (a.fields.source !== b.fields.source) return false;
  return normalizeBody(a.body) === normalizeBody(b.body);
}

function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, "\n").trimEnd();
}

function sanitizeDescription(raw: string): string {
  const collapsed = raw.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (collapsed.length <= DESCRIPTION_MAX_LENGTH) {
    return collapsed;
  }
  return collapsed.slice(0, DESCRIPTION_MAX_LENGTH) + "…";
}

function renderWorkflowShim(workflow: WorkflowDefinition): string {
  const description = workflow.description
    ? sanitizeDescription(workflow.description)
    : DESCRIPTION_FALLBACK;

  const body = [
    `# /workflow:${workflow.name}`,
    "",
    description,
    "",
    `**Dispatch:** apply the generic dispatcher at \`templates/claude/commands/workflow/_dispatch.md\` with:`,
    "",
    `- \`workflow = "${workflow.name}"\``,
    "- `args = ` the ARGUMENTS value supplied by the harness",
    "",
    `The dispatcher resolves \`${workflow.name}\` from \`.dev-vault/workflows/${workflow.name}.yaml\`, runs each step via the step-file resolution order, enforces gates and permissions, and records findings to the vault.`,
  ].join("\n");

  return serializeFrontmatter(
    {
      generated: GENERATED_MARKER,
      source: `.dev-vault/workflows/${workflow.name}.yaml`,
    },
    body,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
