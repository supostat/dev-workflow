import type { ProjectContext } from "../lib/types.js";
import { WorkflowState } from "../workflow/state.js";

export interface PipelineContext {
  branch?: string;
  step?: string;
  runId?: string;
  taskId?: string;
  phase?: string;
}

// Concurrent runs: ENGRAM_RUN_ID env (set by workflow_start) takes priority
// over state.loadCurrent(). This closes the concurrent-runs caveat per
// ADR 2026-05-13 — subagent processes inherit ENV, ensuring each call
// attributes memories to its own run instead of the most-recent one.
//
// Phase tag implemented via run.phase field populated at workflowStart
// (task-023, ADR 2026-05-13).
export function loadPipelineContext(ctx: ProjectContext): PipelineContext {
  const envRunId = process.env["ENGRAM_RUN_ID"];
  if (envRunId !== undefined && envRunId.length > 0) {
    // ENGRAM_RUN_ID set by workflow_start handler — has priority over state lookup
    // Closes concurrent-runs caveat: each subagent process inherits ENV, no cross-run contamination
    try {
      const state = new WorkflowState(ctx.vaultPath);
      const run = state.load(envRunId);
      return {
        branch: ctx.branch,
        step: run.currentStep,
        runId: envRunId,
        taskId: run.taskId ?? undefined,
        phase: run.phase ?? undefined,
      };
    } catch {
      // Run not in state (orphan trace) — preserve env runId, no step/taskId/phase
      return { branch: ctx.branch, runId: envRunId };
    }
  }
  // Fallback: read most-recent run from state (legacy single-run scenarios)
  try {
    const state = new WorkflowState(ctx.vaultPath);
    const run = state.loadCurrent();
    return {
      branch: ctx.branch,
      step: run?.currentStep,
      runId: run?.id,
      taskId: run?.taskId ?? undefined,
      phase: run?.phase ?? undefined,
    };
  } catch {
    return { branch: ctx.branch };
  }
}

export function buildAutoTags(c: PipelineContext): string[] {
  const tags: string[] = [];
  if (c.step) tags.push(`step:${c.step}`);
  if (c.branch) tags.push(`branch:${c.branch}`);
  if (c.taskId) tags.push(`task:${c.taskId}`);
  if (c.runId) tags.push(`run:${c.runId}`);
  // phase appended at END — supplementary scope metadata, preserves the
  // existing 4-element order for tests/consumers that depend on stable
  // prefix positions. Tag order is semantically irrelevant on the engram
  // ingestion side (set-based filtering).
  if (c.phase) tags.push(`phase:${c.phase}`);
  return tags;
}

/**
 * Build tags filter for memory_search (retrieval path).
 *
 * Returns an empty array: search-sites MUST NOT inject auto/scope tags
 * (branch/task/run/step/phase) into the `tags` filter. Engram applies the
 * `tags` filter with AND semantics, so any scope tag would AND-exclude every
 * prior memory not stamped with that exact tag — silently hiding cross-run,
 * cross-branch, and cross-task memories.
 *
 * Project isolation is provided by the `project` JSON-RPC param, not by tags.
 * The `tags` filter is reserved for user-supplied tags and intentional
 * single-record lookups (e.g. vault-mirror dedup by `vault-source:`).
 *
 * Store path still uses full buildAutoTags for attribution accuracy.
 */
export function buildSearchTags(): string[] {
  return [];
}

export function mergeTags(autoTags: string[], userTags?: string[]): string[] {
  if (!userTags?.length) return autoTags;
  return Array.from(new Set([...autoTags, ...userTags]));
}
