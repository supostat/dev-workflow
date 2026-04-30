import type { ProjectContext } from "../lib/types.js";
import { WorkflowState } from "../workflow/state.js";

export interface PipelineContext {
  branch?: string;
  step?: string;
  runId?: string;
  taskId?: string;
}

// Concurrent runs caveat: WorkflowState.loadCurrent() returns the most recent
// running/paused run. Two parallel pipelines (rare; CI scenarios) may attribute
// memories to the wrong run. Acceptable for first cut — revisit when concurrent
// pipelines become a typical pattern.
//
// Phase tag deferred per ADR 2026-04-30 (WorkflowRun lacks phase field).
// Add when phase is persisted in WorkflowRun.
export function loadPipelineContext(ctx: ProjectContext): PipelineContext {
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
