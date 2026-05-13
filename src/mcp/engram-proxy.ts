import type { ProjectContext } from "../lib/types.js";
import { WorkflowState } from "../workflow/state.js";

export interface PipelineContext {
  branch?: string;
  step?: string;
  runId?: string;
  taskId?: string;
}

// Concurrent runs: ENGRAM_RUN_ID env (set by workflow_start) takes priority
// over state.loadCurrent(). This closes the concurrent-runs caveat per
// ADR 2026-05-13 — subagent processes inherit ENV, ensuring each call
// attributes memories to its own run instead of the most-recent one.
//
// Phase tag deferred per ADR 2026-04-30 (WorkflowRun lacks phase field).
// Add when phase is persisted in WorkflowRun.
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
      };
    } catch {
      // Run not in state (orphan trace) — preserve env runId, no step/taskId
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
  return tags;
}

export function mergeTags(autoTags: string[], userTags?: string[]): string[] {
  if (!userTags?.length) return autoTags;
  return Array.from(new Set([...autoTags, ...userTags]));
}
