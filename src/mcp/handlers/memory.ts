import type { ProjectContext } from "../../lib/types.js";
import { engramSearch, engramStoreStrict, engramJudge } from "../../lib/engram.js";
import { loadPipelineContext, buildAutoTags, buildSearchTags, mergeTags } from "../engram-proxy.js";
import {
  parseEngramFeedback as parseEngramFeedbackFn,
  type EngramFeedbackResult,
} from "../../lib/engram-feedback.js";
import { bumpTelemetry } from "./helpers.js";

const UUID_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const JUDGE_CAP = 20;
const MAX_OUTPUT_LEN = 50_000;
const ANTIPATTERN_BUCKETS = ["0.0-0.2", "0.2-0.4", "0.4-0.6", "0.6-0.8", "0.8-1.0"] as const;

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
  const tags = mergeTags(buildSearchTags(), opts.tags);
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

export interface BeforeSearchMemory {
  id: string;
  memoryType: string;
}

export interface StepCompleteResult {
  judgmentsApplied: number;
  fallbackIds: string[];
  antipatternIdsInBefore: string[];
  antipatternJudgmentDistribution: Record<string, number>;
}

/**
 * MCP step_complete handler. Receives full subagent output + retrieved-before
 * memory descriptors, parses the `## Engram Feedback` section, applies each
 * judgment to engram (silent fail-safe via engramJudge), and emits antipattern
 * observability metrics.
 *
 * Locked invariants (ADR 2026-05-13):
 *   - NO blanket fallback application: missing ids surface in `fallbackIds`
 *   - antipatternJudgmentDistribution buckets ONLY scores whose memory id is
 *     classified as antipattern in `beforeSearchMemoryIds`
 *   - Validation at entry: stepName non-empty, output is string, each item is
 *     `{ id: UUID, memoryType: non-empty string }`
 *   - JUDGE_CAP=20 per call to bound daemon load
 */
export async function stepComplete(
  context: ProjectContext,
  stepName: string,
  beforeSearchMemoryIds: BeforeSearchMemory[],
  output: string,
): Promise<StepCompleteResult> {
  if (output.length > MAX_OUTPUT_LEN) {
    throw new Error(`step_complete: output exceeds ${MAX_OUTPUT_LEN} bytes`);
  }
  void stepName; // accepted for telemetry/auto-tags by spec; not currently consumed inside helper
  const expectedIds = beforeSearchMemoryIds.map((m) => m.id);
  const feedbackResult = parseEngramFeedbackFn(output, expectedIds);

  const judgmentsApplied = await applyJudgmentsCapped(feedbackResult);
  if (judgmentsApplied > 0) {
    bumpTelemetry(context.vaultPath, "judge");
  }

  const antipatternIdsInBefore = beforeSearchMemoryIds
    .filter((m) => m.memoryType === "antipattern")
    .map((m) => m.id);

  const antipatternJudgmentDistribution = bucketAntipatternScores(
    feedbackResult,
    antipatternIdsInBefore,
  );

  return {
    judgmentsApplied,
    fallbackIds: feedbackResult.fallbackIds,
    antipatternIdsInBefore,
    antipatternJudgmentDistribution,
  };
}

async function applyJudgmentsCapped(feedbackResult: EngramFeedbackResult): Promise<number> {
  let applied = 0;
  for (const [id, judgment] of feedbackResult.judgments.entries()) {
    if (applied >= JUDGE_CAP) break;
    await engramJudge(id, judgment.score, judgment.explanation);
    applied++;
  }
  return applied;
}

/**
 * Bucket antipattern judgment scores into a 5-bin distribution.
 *
 * Return shape is deliberately bimodal to encode "scope vs feedback" distinctly:
 *
 *   - Returns empty `{}` when `antipatternIdsInBefore` is empty (no antipatterns
 *     were in the BEFORE-search scope → there is nothing to track).
 *   - Returns 5-bucket distribution with zero counts when antipatterns exist
 *     in scope but none received feedback (e.g. agent omitted them from the
 *     Engram Feedback section → fallbackIds will carry them).
 *
 * Consumers can rely on this distinction to differentiate:
 *   distribution === {}        → "no antipatterns to track this step"
 *   distribution === {... :0}  → "antipatterns existed but no judgments arrived"
 */
function bucketAntipatternScores(
  feedbackResult: EngramFeedbackResult,
  antipatternIdsInBefore: string[],
): Record<string, number> {
  const distribution: Record<string, number> = {};
  for (const bucket of ANTIPATTERN_BUCKETS) {
    distribution[bucket] = 0;
  }
  if (antipatternIdsInBefore.length === 0) {
    return {};
  }
  const antipatternSet = new Set(antipatternIdsInBefore);
  for (const [id, judgment] of feedbackResult.judgments.entries()) {
    if (!antipatternSet.has(id)) continue;
    const bucket = scoreToBucket(judgment.score);
    distribution[bucket]!++;
  }
  return distribution;
}

function scoreToBucket(score: number): typeof ANTIPATTERN_BUCKETS[number] {
  if (score < 0.2) return "0.0-0.2";
  if (score < 0.4) return "0.2-0.4";
  if (score < 0.6) return "0.4-0.6";
  if (score < 0.8) return "0.6-0.8";
  return "0.8-1.0";
}

export function validateBeforeSearchMemoryIds(raw: unknown): BeforeSearchMemory[] {
  if (!Array.isArray(raw)) {
    throw new Error("step_complete: beforeSearchMemoryIds must be an array");
  }
  return raw.map((item, index) => validateOneMemoryDescriptor(item, index));
}

function validateOneMemoryDescriptor(item: unknown, index: number): BeforeSearchMemory {
  if (item === null || typeof item !== "object") {
    throw new Error(
      `step_complete: beforeSearchMemoryIds[${index}] must be an object with { id, memoryType }`,
    );
  }
  const record = item as Record<string, unknown>;
  const id = record["id"];
  if (typeof id !== "string" || id === "") {
    throw new Error(
      `step_complete: beforeSearchMemoryIds[${index}].id must be a non-empty string`,
    );
  }
  if (!UUID_REGEX.test(id)) {
    throw new Error(
      `step_complete: beforeSearchMemoryIds[${index}].id must be a UUID, got "${id}"`,
    );
  }
  const memoryType = record["memoryType"];
  if (typeof memoryType !== "string" || memoryType === "") {
    throw new Error(
      `step_complete: beforeSearchMemoryIds[${index}].memoryType must be a non-empty string`,
    );
  }
  return { id, memoryType };
}
