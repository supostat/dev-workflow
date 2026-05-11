import type { ProjectContext } from "../../lib/types.js";
import { engramSearch, engramStoreStrict, engramJudge } from "../../lib/engram.js";
import { loadPipelineContext, buildAutoTags, mergeTags } from "../engram-proxy.js";
import { parseEngramFeedback as parseEngramFeedbackFn } from "../../lib/engram-feedback.js";
import { bumpTelemetry } from "./helpers.js";

function validateTags(tags: string[], toolName: string): void {
  for (const tag of tags) {
    if (tag.includes(",") || tag.includes("\n")) {
      throw new Error(`${toolName}: tag must not contain commas or newlines, got "${tag}"`);
    }
  }
}

export async function memorySearch(
  context: ProjectContext,
  query: string,
  opts: { limit?: number; tags?: string[] },
): Promise<unknown> {
  if (opts.tags) validateTags(opts.tags, "memory_search");
  const pipelineCtx = loadPipelineContext(context);
  const tags = mergeTags(buildAutoTags(pipelineCtx), opts.tags);
  const result = await engramSearch(
    query,
    context.projectName,
    opts.limit ?? 5,
    tags,
  );
  bumpTelemetry(context.vaultPath, "search");
  return result;
}

/**
 * Strict variant of engram memory_store: throws on daemon errors via
 * {@link engramStoreStrict} so the MCP `tools/call` envelope can surface
 * `isError: true` to the agent (ADR 2026-05-06). Auto-mirror callers
 * (`vault_record`/`vault_knowledge`/`vault_pattern`) bypass this and call
 * {@link engramStore} directly to keep silent fail-safe semantics.
 */
export async function memoryStore(
  context: ProjectContext,
  storeContext: string,
  action: string,
  result: string,
  type: string,
  opts: { tags?: string[] },
): Promise<{ id: string }> {
  if (opts.tags) validateTags(opts.tags, "memory_store");
  const pipelineCtx = loadPipelineContext(context);
  const tags = mergeTags(buildAutoTags(pipelineCtx), opts.tags);
  const id = await engramStoreStrict(
    storeContext,
    action,
    result,
    type,
    tags,
    context.projectName,
  );
  bumpTelemetry(context.vaultPath, "store");
  return { id };
}

export async function memoryJudge(
  context: ProjectContext,
  memoryId: string,
  score: number,
  explanation?: string,
): Promise<{ ok: true }> {
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error(`memory_judge: score must be a finite number in [0, 1], got ${score}`);
  }
  await engramJudge(memoryId, score, explanation ?? "");
  bumpTelemetry(context.vaultPath, "judge");
  return { ok: true };
}

export function parseEngramFeedback(
  output: string,
  expectedMemoryIdsRaw: unknown,
): { judgments: Array<{ id: string; score: number; explanation: string }>; fallbackIds: string[] } {
  const expectedMemoryIds = Array.isArray(expectedMemoryIdsRaw)
    ? expectedMemoryIdsRaw.filter((id): id is string => typeof id === "string")
    : [];
  const result = parseEngramFeedbackFn(output, expectedMemoryIds);
  return {
    judgments: Array.from(result.judgments.entries()).map(([id, judgment]) => ({
      id,
      score: judgment.score,
      explanation: judgment.explanation,
    })),
    fallbackIds: result.fallbackIds,
  };
}
