// Local response shapes for the dev-workflow web API wrappers (task-055).
//
// These interfaces describe the ACTUAL server JSON (see src/web/api-*.ts) for
// the handlers that have no matching `@dev-workflow/types` contract — the vault
// without `updatedAt`, the wider settings shape, engram health/stats, and the
// mutation acks. They live apart from `api.ts` so the wrapper module stays
// within the 300-LOC budget; `api.ts` re-exports them where callers need them.

import type { Project, ApiTask, ApiWorkflowRun } from "./types";

/** `GET /api/projects` — registry list with the active marker. */
export interface ProjectListResponse {
  projects: Array<Project & { active: boolean }>;
  activeProject: string | null;
}

/** `GET /api/projects/active` — the selected project, or null when none. */
export interface ActiveProjectResponse {
  activeProject: Project | null;
}

/** `PUT /api/projects/active` — acknowledges the switch by name. */
export interface PutActiveProjectResponse {
  activeProject: string;
}

/** `GET /api/vault/:section` — the real shape carries NO `updatedAt`. */
export interface VaultSectionResponse {
  section: string;
  content: string;
}

/** `PATCH /api/vault/:section` — write ack with the rotated backup path. */
export interface PatchVaultSectionResponse {
  section: string;
  backupPath: string;
}

/** One full-text hit returned inside `GET /api/vault/search`. */
export interface VaultSearchMatch {
  file: string;
  line: number;
  content: string;
}

/** `GET /api/vault/search?q=` — full-text vault search results. */
export interface VaultSearchResponse {
  matches: VaultSearchMatch[];
}

/** `GET /api/tasks` — task list. */
export interface TaskListResponse {
  tasks: ApiTask[];
}

/** `GET /api/workflow/runs` — read-only run list. */
export interface WorkflowRunListResponse {
  runs: ApiWorkflowRun[];
}

/** `GET /api/engram/health` — `status` is opaque to the dashboard (R7). */
export interface EngramHealthResponse {
  healthy: boolean;
  status: unknown;
}

/**
 * `GET /api/engram/stats` — aggregated engram activity. Mirrors the server's
 * `EngramStats`; field payloads the dashboard does not introspect are typed
 * conservatively (`unknown` / `Record`).
 */
export interface EngramStatsResponse {
  scope: { runCount: number; vaultPath: string; cutoffISO: string | null };
  byMethod: Record<string, { count: number; errors: number; avgDurationMs: number }>;
  byMemoryType: Record<string, number>;
  byStep: Record<string, { search: number; store: number; judge: number }>;
  recentRuns: Array<{
    id: string;
    workflowName: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
  }>;
  warnings: Array<{ runId: string; issue: string }>;
  live: { health: unknown; topMemories: unknown[] };
  crossRunReuse: { total: number; reused: number; percent: number };
  perStepHitRate: Record<string, { searches: number; nonEmpty: number; percent: number }>;
  missingStepComplete: {
    totalRuns: number;
    affectedRuns: Array<{ runId: string; step: string; searches: number; judges: number }>;
    count: number;
  };
}

/**
 * `GET /api/settings` — wider than the `ApiSettings` contract: it adds
 * `defaultProfile` and the migration-lock document.
 */
export interface SettingsResponse {
  activeProfile: string | null;
  availableProfiles: string[];
  defaultProfile: string | null;
  lockFilePresent: boolean;
  lock: unknown;
}

/** `PATCH /api/settings/communication` — write ack. */
export interface PatchCommunicationResponse {
  written: boolean;
}

/** `PUT /api/settings/profile` — acknowledges the active profile. */
export interface PutProfileResponse {
  activeProfile: string;
}
