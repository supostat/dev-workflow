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

/** One editable vault section returned by `GET /api/vault/:section`. */
export interface ApiVaultSection {
  section: "stack" | "conventions" | "knowledge" | "gameplan";
  content: string;
  /** ISO timestamp of the file's last modification. */
  updatedAt: string;
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

/** A workflow run as exposed by the read-only `GET /api/workflow/runs`. */
export interface ApiWorkflowRun {
  id: string;
  workflow: string;
  status: WorkflowStatus;
  currentStep: string | null;
  startedAt: string;
  updatedAt: string;
}

/** Aggregated engram activity for `GET /api/engram/stats`. */
export interface ApiEngramStats {
  totalMemories: number;
  byMethod: Record<string, number>;
  byStep: Record<string, number>;
  byType: Record<string, number>;
  daemonHealthy: boolean;
}

/** Communication-profile settings for `GET /api/settings`. */
export interface ApiSettings {
  activeProfile: string | null;
  availableProfiles: string[];
  lockFilePresent: boolean;
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
