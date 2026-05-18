// Typed REST wrappers for the dev-workflow web API (task-055).
//
// Pure module — no React, no hooks. Every wrapper hits a relative `/api/...`
// URL so the static export works behind the local server. Project-scoped
// wrappers take an explicit `project` name and inject it as `?project=`; the
// four `/api/projects*` routes are `needsProject:false` and take no such arg.
//
// Return types mirror the ACTUAL server JSON (see src/web/api-*.ts). Where the
// shared `@dev-workflow/types` contract matches a handler it is reused; where
// the handler diverges (vault without `updatedAt`, the wider settings shape,
// engram health/stats, mutation acks) a local response interface is declared
// in `./api-types` and re-exported here. `request` throws `Error(body.error)`
// on any non-2xx response.

import type { Project, ApiTask, ApiWorkflowRun } from "./types";
import type {
  ProjectListResponse,
  ActiveProjectResponse,
  PutActiveProjectResponse,
  VaultSectionResponse,
  PatchVaultSectionResponse,
  VaultSearchResponse,
  TaskListResponse,
  WorkflowRunListResponse,
  EngramHealthResponse,
  EngramStatsResponse,
  SettingsResponse,
  PatchCommunicationResponse,
  PutProfileResponse,
} from "./api-types";

export type {
  ProjectListResponse,
  ActiveProjectResponse,
  PutActiveProjectResponse,
  VaultSectionResponse,
  PatchVaultSectionResponse,
  VaultSearchMatch,
  VaultSearchResponse,
  TaskListResponse,
  WorkflowRunListResponse,
  EngramHealthResponse,
  EngramStatsResponse,
  SettingsResponse,
  PatchCommunicationResponse,
  PutProfileResponse,
} from "./api-types";

// ── request core ─────────────────────────────────────────────────────────────

/** Vault sections addressable through the vault endpoints. */
export type VaultSection = "stack" | "conventions" | "knowledge" | "gameplan";

/** Body accepted by `PATCH /api/tasks/:id`. */
export interface TaskPatchBody {
  status?: string;
  description?: string;
}

const JSON_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "application/json",
};

/** Shape of the `{ error }` body the server sends on any non-2xx response. */
interface ApiErrorBody {
  error: string;
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { error?: unknown }).error === "string"
  );
}

/**
 * Issue one request and parse the JSON body. A non-2xx response throws an
 * `Error` carrying the server's `{ error }` message, or `status statusText`
 * when the body is not parseable JSON.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(await failureMessage(response, raw));
  }
  return JSON.parse(raw) as T;
}

/** Derive a human-readable error message from a failed response. */
async function failureMessage(response: Response, raw: string): Promise<string> {
  try {
    const body: unknown = JSON.parse(raw);
    if (isErrorBody(body)) return body.error;
  } catch {
    // Body was not JSON — fall through to the status line.
  }
  return `${response.status} ${response.statusText}`;
}

/** Append `?project=<name>` to a path. */
function withProject(path: string, project: string): string {
  return `${path}?project=${encodeURIComponent(project)}`;
}

/** Build a query string from defined, non-null entries. */
function buildQuery(params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) search.set(key, value);
  }
  const query = search.toString();
  return query.length > 0 ? `?${query}` : "";
}

function jsonBody(value: unknown): RequestInit {
  return { headers: JSON_HEADERS, body: JSON.stringify(value) };
}

// ── projects (no project arg — routes are needsProject:false) ────────────────

export function getProjects(): Promise<ProjectListResponse> {
  return request<ProjectListResponse>("/api/projects");
}

export function createProject(path: string): Promise<Project> {
  return request<Project>("/api/projects", { method: "POST", ...jsonBody({ path }) });
}

export function getActiveProject(): Promise<ActiveProjectResponse> {
  return request<ActiveProjectResponse>("/api/projects/active");
}

export function putActiveProject(name: string): Promise<PutActiveProjectResponse> {
  return request<PutActiveProjectResponse>("/api/projects/active", {
    method: "PUT",
    ...jsonBody({ name }),
  });
}

// ── vault ────────────────────────────────────────────────────────────────────

export function getVaultSection(
  project: string,
  section: VaultSection,
): Promise<VaultSectionResponse> {
  return request<VaultSectionResponse>(withProject(`/api/vault/${section}`, project));
}

export function patchVaultSection(
  project: string,
  section: VaultSection,
  content: string,
): Promise<PatchVaultSectionResponse> {
  return request<PatchVaultSectionResponse>(withProject(`/api/vault/${section}`, project), {
    method: "PATCH",
    ...jsonBody({ content }),
  });
}

export function searchVault(project: string, query: string): Promise<VaultSearchResponse> {
  return request<VaultSearchResponse>(
    `/api/vault/search${buildQuery({ project, q: query })}`,
  );
}

// ── tasks ────────────────────────────────────────────────────────────────────

export function getTasks(
  project: string,
  filter?: { status?: string; priority?: string },
): Promise<TaskListResponse> {
  return request<TaskListResponse>(
    `/api/tasks${buildQuery({ project, status: filter?.status, priority: filter?.priority })}`,
  );
}

export function getTask(project: string, id: string): Promise<ApiTask> {
  return request<ApiTask>(withProject(`/api/tasks/${id}`, project));
}

export function createTask(
  project: string,
  task: { title: string; description?: string },
): Promise<ApiTask> {
  return request<ApiTask>(withProject("/api/tasks", project), {
    method: "POST",
    ...jsonBody(task),
  });
}

export function patchTask(
  project: string,
  id: string,
  patch: TaskPatchBody,
): Promise<ApiTask> {
  return request<ApiTask>(withProject(`/api/tasks/${id}`, project), {
    method: "PATCH",
    ...jsonBody(patch),
  });
}

// ── workflow ─────────────────────────────────────────────────────────────────

export function getWorkflowRuns(
  project: string,
  status?: string,
): Promise<WorkflowRunListResponse> {
  return request<WorkflowRunListResponse>(
    `/api/workflow/runs${buildQuery({ project, status })}`,
  );
}

export function getWorkflowRun(project: string, id: string): Promise<ApiWorkflowRun> {
  return request<ApiWorkflowRun>(withProject(`/api/workflow/runs/${id}`, project));
}

// ── engram ───────────────────────────────────────────────────────────────────

export function getEngramStats(
  project: string,
  runs?: number,
): Promise<EngramStatsResponse> {
  return request<EngramStatsResponse>(
    `/api/engram/stats${buildQuery({ project, runs: runs?.toString() })}`,
  );
}

export function getEngramHealth(project: string): Promise<EngramHealthResponse> {
  return request<EngramHealthResponse>(withProject("/api/engram/health", project));
}

// ── settings ─────────────────────────────────────────────────────────────────

export function getSettings(project: string): Promise<SettingsResponse> {
  return request<SettingsResponse>(withProject("/api/settings", project));
}

export function patchCommunication(
  project: string,
  content: string,
): Promise<PatchCommunicationResponse> {
  return request<PatchCommunicationResponse>(
    withProject("/api/settings/communication", project),
    { method: "PATCH", ...jsonBody({ content }) },
  );
}

export function putProfile(project: string, profile: string): Promise<PutProfileResponse> {
  return request<PutProfileResponse>(withProject("/api/settings/profile", project), {
    method: "PUT",
    ...jsonBody({ profile }),
  });
}
