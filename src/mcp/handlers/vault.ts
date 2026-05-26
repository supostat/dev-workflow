import type { VaultReader } from "../../lib/reader.js";
import type { VaultWriter, AppendReason } from "../../lib/writer.js";
import type { ProjectContext } from "../../lib/types.js";
import type { TaskManager } from "../../tasks/manager.js";
import { WorkflowState } from "../../workflow/state.js";
import { renderTemplate } from "../../lib/templates.js";
import { engramSearch, engramStore } from "../../lib/engram.js";
import { loadPipelineContext, buildAutoTags } from "../engram-proxy.js";
import { mirrorVaultRecord } from "../vault-mirror.js";
import { bumpTelemetry, searchVaultFiles, slugifyTitle, type SearchMatch } from "./helpers.js";

const VAULT_RECORD_TYPES = new Set(["adr", "bug", "debt"]);

export function vaultRead(reader: VaultReader, section: string): string | null {
  const colonIndex = section.indexOf(":");
  if (colonIndex !== -1) {
    const base = section.slice(0, colonIndex);
    const sub = section.slice(colonIndex + 1);
    if (base !== "knowledge") throw new Error(`Unknown vault section: ${section}`);
    return reader.readKnowledgeSection(sub);
  }

  const readers: Record<string, () => string | null> = {
    stack: () => reader.readStack(),
    conventions: () => reader.readConventions(),
    knowledge: () => reader.readKnowledge(),
    gameplan: () => reader.readGameplan(),
  };
  const fn = readers[section];
  if (!fn) throw new Error(`Unknown vault section: ${section}`);
  return fn();
}

export function vaultSearch(vaultPath: string, query: string): SearchMatch[] {
  return searchVaultFiles(vaultPath, query);
}

/**
 * Side-effects: (1) writes ADR/bug/debt markdown to vault; (2) mirrors
 * content to engram via {@link mirrorVaultRecord} (content-hash idempotent,
 * silent fail on daemon error per ADR 2026-05-01); (3) bumps telemetry
 * counters (`vaultRecord` always; `store` and `skipped` from mirror result).
 */
export async function vaultRecord(
  writer: VaultWriter,
  context: ProjectContext,
  type: string,
  title: string,
  content: string,
): Promise<{ filepath: string }> {
  if (!VAULT_RECORD_TYPES.has(type)) {
    throw new Error(`vault_record: invalid type "${type}", expected adr|bug|debt`);
  }
  const slug = slugifyTitle(title);
  const rendered = renderTemplate(`records/${type}`, {
    title,
    projectName: context.projectName,
  });
  const finalContent = rendered + "\n" + content;
  const filepath = writer.writeRecord(type, slug, finalContent);

  const mirror = await mirrorVaultRecord({
    type,
    title,
    content,
    filepath,
    projectRoot: context.projectRoot,
    projectName: context.projectName,
    autoTags: buildAutoTags(loadPipelineContext(context)),
  });
  bumpTelemetry(context.vaultPath, "vaultRecord");
  if (mirror.stored) bumpTelemetry(context.vaultPath, "store");
  if (mirror.skipped) bumpTelemetry(context.vaultPath, "skipped");

  return { filepath };
}

/**
 * Side-effects: appends to `knowledge.md` section, then auto-mirrors to engram
 * (silent fail-safe via {@link engramStore}). Telemetry: `store` bumped on
 * every call (whether or not engram succeeded — failure is invisible here by
 * design, see auto-mirror invariant in ADR 2026-05-01).
 */
export async function vaultKnowledge(
  writer: VaultWriter,
  context: ProjectContext,
  section: string,
  content: string,
): Promise<{ success: boolean }> {
  writer.appendKnowledge(section, content);

  await engramStore(
    `Knowledge updated: ${section}`,
    content.slice(0, 300),
    `Section "${section}" appended in ${context.projectName}`,
    "context",
    [context.projectName, "knowledge", section],
    context.projectName,
  );
  bumpTelemetry(context.vaultPath, "store");

  return { success: true };
}

/**
 * Append a single-line pattern to `conventions.md`. Boundary validation:
 * both `section` (if provided) and `content` are rejected if they contain
 * newlines (fail-fast at MCP boundary before writer call). Side-effects on
 * successful append: auto-mirror to engram + `store` telemetry bump. If
 * writer reports `appended: false` (duplicate or missing section), engram
 * is NOT touched.
 */
export async function vaultPattern(
  writer: VaultWriter,
  context: ProjectContext,
  section: string | undefined,
  content: string,
): Promise<{ success: boolean; appended: boolean; reason?: AppendReason }> {
  if (content.includes("\n")) {
    throw new Error("vault_pattern: content must be a single line (no newlines)");
  }
  if (section !== undefined && section.includes("\n")) {
    throw new Error("vault_pattern: section must be a single line (no newlines)");
  }

  const targetSection = section ?? "Patterns";
  const result = writer.appendConventions(targetSection, content);

  if (!result.appended) {
    return { success: true, appended: false, reason: result.reason };
  }

  await engramStore(
    `Convention updated: ${targetSection}`,
    content.slice(0, 300),
    `Section "${targetSection}" appended in conventions.md of ${context.projectName}`,
    "context",
    [context.projectName, "conventions", targetSection],
    context.projectName,
  );
  bumpTelemetry(context.vaultPath, "store");

  return { success: true, appended: true };
}

export function vaultStatus(
  reader: VaultReader,
  context: ProjectContext,
  taskManager: TaskManager,
): unknown {
  const sectionInfo = (content: string | null) => {
    if (!content) return { filled: false, lines: 0 };
    const lines = content.split("\n").length;
    return { filled: lines > 8, lines };
  };

  const tasks = taskManager.list();
  const statusCounts: Record<string, number> = {};
  for (const task of tasks) {
    statusCounts[task.status] = (statusCounts[task.status] ?? 0) + 1;
  }

  const workflowState = new WorkflowState(context.vaultPath);
  const currentRun = workflowState.loadCurrent();

  return {
    project: context.projectName,
    branch: context.branch,
    sections: {
      stack: sectionInfo(reader.readStack()),
      conventions: sectionInfo(reader.readConventions()),
      knowledge: sectionInfo(reader.readKnowledge()),
      gameplan: sectionInfo(reader.readGameplan()),
    },
    tasks: {
      total: tasks.length,
      ...statusCounts,
    },
    workflow: currentRun ? {
      active: true,
      name: currentRun.workflowName,
      step: currentRun.currentStep,
      status: currentRun.status,
    } : null,
  };
}

export async function intelligenceQuery(
  context: ProjectContext,
  branch?: string,
  task?: string,
  limit?: number,
): Promise<unknown> {
  const query = [branch ?? context.branch, task].filter(Boolean).join(" ");
  const memories = await engramSearch(query, context.projectName, limit ?? 15);
  return memories.map((memory) => ({
    id: memory.id,
    category: memory.memory_type,
    content: memory.context,
    score: memory.score,
    action: memory.action,
  }));
}
