// Shared type contract between the web API server (task-055) and the
// dashboard frontend (task-056). Pure type declarations — no runtime code,
// so the dashboard can import it through a type-only workspace path without
// pulling core modules into its bundle.
//
// This file is intentionally NOT re-exported from src/index.ts: the web
// surface is internal, consumed by the bundled dashboard and the local
// http server, not by external package consumers.

import type { TaskStatus, TaskPriority } from "../tasks/types.js";
import type { WorkflowStatus } from "../workflow/types.js";

/** A single project registered in `~/.config/dev-workflow/projects.json`. */
export interface Project {
  /** Unique registry key. Matches NAME_PATTERN in projects.ts. */
  name: string;
  /** Absolute filesystem path to the project root. */
  path: string;
  /** ISO timestamp of the last `dev-workflow web` invocation for this project. */
  lastSeen: string;
}

/**
 * The multi-project registry document. `projects` is keyed by project name;
 * `activeProject` is the currently selected name or null when none is set.
 */
export interface ProjectRegistry {
  projects: Record<string, Project>;
  activeProject: string | null;
}

// `GET /api/tasks` and `GET /api/workflow/runs` return raw domain objects, so
// the API contract must reuse the domain status/priority unions verbatim — a
// re-declared literal that drifts from `TaskStatus` / `WorkflowStatus` is a
// latent contract bug. These aliases keep the web surface pinned to the source.

/** A task as exposed by `GET /api/tasks`. */
export interface ApiTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  branch: string | null;
  created: string;
  updated: string;
}

/**
 * Engram telemetry counters carried by a workflow run — mirrors the core
 * `TelemetryCounters` (src/workflow/types.ts). Counts of the engram operations
 * a run performed across all of its steps.
 */
export interface ApiTelemetryCounters {
  search: number;
  store: number;
  judge: number;
  vaultRecord: number;
  skipped: number;
}

/**
 * Per-step execution state inside a workflow run — mirrors the core `StepState`
 * (src/workflow/types.ts). Every field is explicitly present; nullable fields
 * are `null` rather than absent.
 */
export interface ApiStepState {
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  output: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  attempt: number;
  engramMemoryId: string | null;
  error: string | null;
}

/**
 * A workflow run as exposed by the read-only workflow endpoints — mirrors the
 * core `WorkflowRun` (src/workflow/types.ts) verbatim. Both `GET
 * /api/workflow/runs` and `GET /api/workflow/runs/:id` serve this full shape:
 * `workflowList` does no slimming, so the list rows and the detail object are
 * identical — there is no separate slimmed list type.
 */
export interface ApiWorkflowRun {
  id: string;
  workflowName: string;
  taskId: string | null;
  taskDescription: string;
  phase: string | null;
  currentStep: string;
  startedAt: string;
  completedAt: string | null;
  status: WorkflowStatus;
  steps: Record<string, ApiStepState>;
  telemetry?: ApiTelemetryCounters;
  abortReason?: string;
}

/** The topic an SSE stream carries. */
export type SseTopic = "vault" | "runs" | "trace" | "projects";

/** A single Server-Sent Event payload pushed to dashboard subscribers. */
export interface SseEvent {
  topic: SseTopic;
  /** Project the event belongs to. */
  project: string;
  /** Topic-specific payload — the changed path, a run id, or a trace line. */
  payload: string;
  /** ISO timestamp the event was emitted. */
  emittedAt: string;
}
