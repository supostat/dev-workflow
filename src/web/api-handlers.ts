// Projects / vault / tasks / workflow REST handlers for the web dashboard
// (task-055). Settings handlers live in `api-settings.ts`.
//
// Each handler wraps an MCP handler / lib function for one project, never
// modifying their signatures. Per-request the caller resolves a Project, then
// `buildProjectScope` derives a fresh ProjectContext + VaultReader/Writer/
// TaskManager — no shared mutable per-project state, so concurrent requests
// for different projects cannot interfere.

import { existsSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { detectContext } from "../lib/context.js";
import type { ProjectContext } from "../lib/types.js";
import { VaultReader } from "../lib/reader.js";
import { VaultWriter } from "../lib/writer.js";
import { TaskManager } from "../tasks/manager.js";
import type { TaskStatus } from "../tasks/types.js";
import { vaultRead, vaultSearch } from "../mcp/handlers/vault.js";
import { taskCreate, taskUpdate } from "../mcp/handlers/task.js";
import { workflowList, workflowStatus } from "../mcp/handlers/workflow.js";
import {
  loadRegistry, addProject, removeProject, setActiveProject, validateProjectName,
} from "./projects.js";
import type { Project } from "./types.js";

/** A run identifier as minted by `workflowStart` — `run-` + 12 hex digits. */
const RUN_ID_PATTERN = /^run-[a-f0-9]{12}$/;
/** A task identifier — `task-` + 3+ digits. */
const TASK_ID_PATTERN = /^task-\d{3,}$/;
/** Vault sections readable through `GET /api/vault/:section`. */
const VAULT_SECTIONS: ReadonlySet<string> = new Set([
  "stack", "conventions", "knowledge", "gameplan",
]);
/** Valid task statuses accepted as the `?status=` task filter. */
const TASK_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  "pending", "in-progress", "review", "done", "blocked",
]);

/**
 * Error message thrown by {@link buildProjectScope} when a registered project
 * path is not a git repository. The router matches on this exact string to
 * map the failure to a 400 instead of letting it surface as a 500.
 */
export const NOT_A_GIT_REPO_ERROR = "project path is not a git repository";

/** Per-request bundle of vault accessors scoped to one project. */
export interface ProjectScope {
  context: ProjectContext;
  reader: VaultReader;
  writer: VaultWriter;
  tasks: TaskManager;
}

/** Send a JSON response with the given status code. */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

/**
 * Build the per-request vault scope for a project. Throws when the project
 * path is not a git repository — the caller maps that to a 400.
 */
export function buildProjectScope(project: Project): ProjectScope {
  const context = detectContext(project.path);
  if (context === null) {
    throw new Error(NOT_A_GIT_REPO_ERROR);
  }
  return {
    context,
    reader: new VaultReader(context),
    writer: new VaultWriter(context),
    tasks: new TaskManager(context.vaultPath),
  };
}

// ── projects ────────────────────────────────────────────────────────────────

/** `GET /api/projects` — registry list with the active marker. */
export function listProjects(res: ServerResponse): void {
  const registry = loadRegistry();
  const projects = Object.values(registry.projects).map((project) => ({
    ...project,
    active: project.name === registry.activeProject,
  }));
  sendJson(res, 200, { projects, activeProject: registry.activeProject });
}

/** `POST /api/projects` — register a path; `name` in the body is advisory. */
export function createProject(res: ServerResponse, body: Record<string, unknown>): void {
  const path = body["path"];
  if (typeof path !== "string" || path.length === 0) {
    sendJson(res, 400, { error: "body.path must be a non-empty string" });
    return;
  }
  if (!path.startsWith("/")) {
    sendJson(res, 400, { error: "body.path must be absolute" });
    return;
  }
  if (!existsSync(path)) {
    sendJson(res, 400, { error: "body.path does not exist" });
    return;
  }
  try {
    sendJson(res, 201, addProject(path));
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "registration failed" });
  }
}

/** `GET /api/projects/active` — the currently selected project, or null. */
export function getActiveProjectEndpoint(res: ServerResponse): void {
  const registry = loadRegistry();
  const active = registry.activeProject;
  sendJson(res, 200, {
    activeProject: active !== null ? (registry.projects[active] ?? null) : null,
  });
}

/**
 * `DELETE /api/projects/:name` — remove a project from the registry.
 * Registry-only: the project's files on disk are untouched. Clears
 * `activeProject` if the removed project was active — re-selection is the
 * caller's responsibility (the dashboard prompts the user; the CLI does
 * not auto-pick).
 *
 * Status codes: 204 on success, 400 on a name that fails validation or is
 * the reserved `active` sub-resource token (which is a different endpoint
 * handled by `putActiveProject`), 404 on a name not in the registry.
 */
export function deleteProject(res: ServerResponse, name: string): void {
  if (name === "active") {
    sendJson(res, 400, {
      error:
        "DELETE /api/projects/active is not allowed — `active` is a reserved sub-resource; use PUT /api/projects/active to change the active selection.",
    });
    return;
  }
  if (!validateProjectName(name)) {
    sendJson(res, 400, { error: "invalid project name" });
    return;
  }
  try {
    removeProject(name);
    res.writeHead(204);
    res.end();
  } catch (error) {
    sendJson(res, 404, {
      error: error instanceof Error ? error.message : "removal failed",
    });
  }
}

/** `PUT /api/projects/active` — switch the active project by name. */
export function putActiveProject(res: ServerResponse, body: Record<string, unknown>): void {
  const name = body["name"];
  if (typeof name !== "string" || !validateProjectName(name)) {
    sendJson(res, 400, { error: "body.name must be a valid project name" });
    return;
  }
  try {
    setActiveProject(name);
    sendJson(res, 200, { activeProject: name });
  } catch {
    sendJson(res, 400, { error: `unknown project: ${name}` });
  }
}

// ── vault ─────────────────────────────────────────────────────────────────────

/** `GET /api/vault/:section` — read one vault markdown file. */
export function getVaultSection(res: ServerResponse, scope: ProjectScope, section: string): void {
  if (!VAULT_SECTIONS.has(section)) {
    sendJson(res, 400, { error: `unknown vault section: ${section}` });
    return;
  }
  const content = vaultRead(scope.reader, section);
  if (content === null) {
    sendJson(res, 404, { error: `vault section not found: ${section}` });
    return;
  }
  sendJson(res, 200, { section, content });
}

/** `PATCH /api/vault/:section` — overwrite a vault file, backing up the old one. */
export function patchVaultSection(
  res: ServerResponse,
  scope: ProjectScope,
  section: string,
  body: Record<string, unknown>,
): void {
  if (!VAULT_SECTIONS.has(section)) {
    sendJson(res, 400, { error: `unknown vault section: ${section}` });
    return;
  }
  const content = body["content"];
  if (typeof content !== "string") {
    sendJson(res, 400, { error: "body.content must be a string" });
    return;
  }
  const result = scope.writer.writeSection(section, content);
  sendJson(res, 200, { section, backupPath: result.backupPath });
}

/** `GET /api/vault/search?q=...` — full-text vault search. */
export function searchVault(res: ServerResponse, scope: ProjectScope, query: string | null): void {
  if (query === null || query.trim() === "") {
    sendJson(res, 400, { error: "query parameter q is required" });
    return;
  }
  sendJson(res, 200, { matches: vaultSearch(scope.context.vaultPath, query) });
}

// ── tasks ─────────────────────────────────────────────────────────────────────

/** `GET /api/tasks?status=...&priority=...` — task list with filtering. */
export function getTasks(
  res: ServerResponse,
  scope: ProjectScope,
  status: string | null,
  priority: string | null,
): void {
  if (status !== null && !TASK_STATUSES.has(status as TaskStatus)) {
    sendJson(res, 400, { error: `invalid task status: ${status}` });
    return;
  }
  let tasks = scope.tasks.list(status !== null ? { status: status as TaskStatus } : undefined);
  if (priority !== null) tasks = tasks.filter((task) => task.priority === priority);
  sendJson(res, 200, { tasks });
}

/** `GET /api/tasks/:id` — single task detail. */
export function getTask(res: ServerResponse, scope: ProjectScope, id: string): void {
  if (!TASK_ID_PATTERN.test(id)) {
    sendJson(res, 400, { error: `invalid task id: ${id}` });
    return;
  }
  try {
    sendJson(res, 200, scope.tasks.get(id));
  } catch {
    sendJson(res, 404, { error: `task not found: ${id}` });
  }
}

/** `POST /api/tasks` — create a task from `{ title, description }`. */
export function postTask(res: ServerResponse, scope: ProjectScope, body: Record<string, unknown>): void {
  const title = body["title"];
  if (typeof title !== "string" || title.trim() === "") {
    sendJson(res, 400, { error: "body.title must be a non-empty string" });
    return;
  }
  const description = typeof body["description"] === "string" ? body["description"] : "";
  sendJson(res, 201, taskCreate(scope.tasks, title, description));
}

/** `PATCH /api/tasks/:id` — update task status / description / priority. */
export function patchTask(
  res: ServerResponse,
  scope: ProjectScope,
  id: string,
  body: Record<string, unknown>,
): void {
  if (!TASK_ID_PATTERN.test(id)) {
    sendJson(res, 400, { error: `invalid task id: ${id}` });
    return;
  }
  const status = typeof body["status"] === "string" ? body["status"] : undefined;
  const description = typeof body["description"] === "string" ? body["description"] : undefined;
  try {
    sendJson(res, 200, taskUpdate(scope.tasks, id, status, description));
  } catch {
    sendJson(res, 404, { error: `task not found: ${id}` });
  }
}

// ── workflow ──────────────────────────────────────────────────────────────────

/** `GET /api/workflow/runs?status=...` — read-only run list. */
export function getWorkflowRuns(res: ServerResponse, scope: ProjectScope, status: string | null): void {
  sendJson(res, 200, { runs: workflowList(scope.context.vaultPath, status ?? undefined) });
}

/** `GET /api/workflow/runs/:id` — read-only single run state. */
export function getWorkflowRun(res: ServerResponse, scope: ProjectScope, id: string): void {
  if (!RUN_ID_PATTERN.test(id)) {
    sendJson(res, 400, { error: `invalid run id: ${id}` });
    return;
  }
  sendJson(res, 200, workflowStatus(scope.context.vaultPath, id));
}
