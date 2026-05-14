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
 * Asymmetric to buildAutoTags: drops volatile per-run scope tags
 * (run/step/phase) which would AND-exclude all prior memories — engram
 * applies tags filter with AND semantics, so a unique-per-run `run:<id>`
 * tag guarantees zero cross-run matches. Keeps stable scope tags
 * (branch/task) so retrieval is scoped to the project context without
 * narrowing to a single pipeline invocation.
 *
 * Store path uses full buildAutoTags for attribution accuracy. See ADR
 * `2026-05-14-asymmetric-engram-tag-injection...` for the design split.
 */
export function buildSearchTags(c: PipelineContext): string[] {
  const tags: string[] = [];
  if (c.branch) tags.push(`branch:${c.branch}`);
  if (c.taskId) tags.push(`task:${c.taskId}`);
  return tags;
}

export function mergeTags(autoTags: string[], userTags?: string[]): string[] {
  if (!userTags?.length) return autoTags;
  return Array.from(new Set([...autoTags, ...userTags]));
}
