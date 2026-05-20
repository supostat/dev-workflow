// REST route table + dispatcher for the web dashboard (task-055).
//
// `handleApi` matches `req.method` + `url.pathname` against an ordered regex
// table, resolves the `?project=` query param to a registered Project (with
// existence + directory validation), and invokes the matching handler. Any
// error thrown by a handler is mapped to a 500 by the caller's try/catch.

import { statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import type { Project } from "./types.js";
import type { EngramPool } from "./engram-pool.js";
import { loadRegistry, validateProjectName } from "./projects.js";
import {
  buildProjectScope, sendJson, NOT_A_GIT_REPO_ERROR,
  listProjects, createProject, deleteProject, getActiveProjectEndpoint, putActiveProject,
  getVaultSection, patchVaultSection, searchVault,
  getTasks, getTask, postTask, patchTask,
  getWorkflowRuns, getWorkflowRun,
} from "./api-handlers.js";
import { getSettings, patchCommunication, putProfile } from "./api-settings.js";
import { getEngramStats, getEngramHealth } from "./api-engram.js";
import { browseFilesystem } from "./api-fs.js";

/** Resolution result: a validated Project, or a `{ status, error }` rejection. */
type ProjectResolution =
  | { ok: true; project: Project }
  | { ok: false; status: number; error: string };

/**
 * Resolve `?project=<name>` to a registered Project whose path still exists
 * as a directory. AC#6: a missing or unknown project, and a registry-stored
 * path that no longer resolves to a directory, all yield a 400.
 */
function resolveProject(name: string | null): ProjectResolution {
  if (name === null || !validateProjectName(name)) {
    return { ok: false, status: 400, error: "missing or invalid project query parameter" };
  }
  const project = loadRegistry().projects[name];
  if (project === undefined) {
    return { ok: false, status: 400, error: `unknown project: ${name}` };
  }
  try {
    if (!statSync(project.path).isDirectory()) {
      return { ok: false, status: 400, error: `project path is not a directory: ${name}` };
    }
  } catch {
    return { ok: false, status: 400, error: `project path no longer exists: ${name}` };
  }
  return { ok: true, project };
}

/** Context handed to every route handler. */
interface ApiRequestContext {
  res: ServerResponse;
  method: string;
  url: URL;
  body: Record<string, unknown>;
  engramPool: EngramPool;
}

interface Route {
  method: string;
  pattern: RegExp;
  /** Whether the route requires a resolved `?project=` (everything but /projects). */
  needsProject: boolean;
  handle: (ctx: ApiRequestContext, params: string[], project: Project | null) => void | Promise<void>;
}

/** Ordered route table — first method+pattern match wins. */
const ROUTES: readonly Route[] = [
  {
    method: "GET", pattern: /^\/api\/projects$/, needsProject: false,
    handle: (ctx) => listProjects(ctx.res),
  },
  {
    method: "POST", pattern: /^\/api\/projects$/, needsProject: false,
    handle: (ctx) => createProject(ctx.res, ctx.body),
  },
  {
    method: "GET", pattern: /^\/api\/projects\/active$/, needsProject: false,
    handle: (ctx) => getActiveProjectEndpoint(ctx.res),
  },
  {
    method: "PUT", pattern: /^\/api\/projects\/active$/, needsProject: false,
    handle: (ctx) => putActiveProject(ctx.res, ctx.body),
  },
  {
    method: "DELETE", pattern: /^\/api\/projects\/([^/]+)$/, needsProject: false,
    handle: (ctx, params) => deleteProject(ctx.res, params[0]!),
  },
  {
    method: "GET", pattern: /^\/api\/fs\/browse$/, needsProject: false,
    handle: (ctx) => browseFilesystem(ctx.res, ctx.url.searchParams.get("path")),
  },
  {
    method: "GET", pattern: /^\/api\/vault\/search$/, needsProject: true,
    handle: (ctx, _p, project) =>
      searchVault(ctx.res, buildProjectScope(project!), ctx.url.searchParams.get("q")),
  },
  {
    method: "GET", pattern: /^\/api\/vault\/([^/]+)$/, needsProject: true,
    handle: (ctx, params, project) =>
      getVaultSection(ctx.res, buildProjectScope(project!), params[0]!),
  },
  {
    method: "PATCH", pattern: /^\/api\/vault\/([^/]+)$/, needsProject: true,
    handle: (ctx, params, project) =>
      patchVaultSection(ctx.res, buildProjectScope(project!), params[0]!, ctx.body),
  },
  {
    method: "GET", pattern: /^\/api\/tasks$/, needsProject: true,
    handle: (ctx, _p, project) =>
      getTasks(
        ctx.res, buildProjectScope(project!),
        ctx.url.searchParams.get("status"), ctx.url.searchParams.get("priority"),
      ),
  },
  {
    method: "POST", pattern: /^\/api\/tasks$/, needsProject: true,
    handle: (ctx, _p, project) => postTask(ctx.res, buildProjectScope(project!), ctx.body),
  },
  {
    method: "GET", pattern: /^\/api\/tasks\/([^/]+)$/, needsProject: true,
    handle: (ctx, params, project) => getTask(ctx.res, buildProjectScope(project!), params[0]!),
  },
  {
    method: "PATCH", pattern: /^\/api\/tasks\/([^/]+)$/, needsProject: true,
    handle: (ctx, params, project) =>
      patchTask(ctx.res, buildProjectScope(project!), params[0]!, ctx.body),
  },
  {
    method: "GET", pattern: /^\/api\/workflow\/runs$/, needsProject: true,
    handle: (ctx, _p, project) =>
      getWorkflowRuns(ctx.res, buildProjectScope(project!), ctx.url.searchParams.get("status")),
  },
  {
    method: "GET", pattern: /^\/api\/workflow\/runs\/([^/]+)$/, needsProject: true,
    handle: (ctx, params, project) =>
      getWorkflowRun(ctx.res, buildProjectScope(project!), params[0]!),
  },
  {
    method: "GET", pattern: /^\/api\/engram\/stats$/, needsProject: true,
    handle: (ctx, _p, project) =>
      getEngramStats(ctx.res, project!, ctx.engramPool, ctx.url.searchParams.get("runs")),
  },
  {
    method: "GET", pattern: /^\/api\/engram\/health$/, needsProject: true,
    handle: (ctx, _p, project) => getEngramHealth(ctx.res, project!, ctx.engramPool),
  },
  {
    method: "GET", pattern: /^\/api\/settings$/, needsProject: true,
    handle: (ctx, _p, project) => getSettings(ctx.res, buildProjectScope(project!)),
  },
  {
    method: "PATCH", pattern: /^\/api\/settings\/communication$/, needsProject: true,
    handle: (ctx, _p, project) =>
      patchCommunication(ctx.res, buildProjectScope(project!), ctx.body),
  },
  {
    method: "PUT", pattern: /^\/api\/settings\/profile$/, needsProject: true,
    handle: (ctx, _p, project) => putProfile(ctx.res, buildProjectScope(project!), ctx.body),
  },
];

/**
 * Dispatch one `/api/*` request. Resolves the route and the project, then
 * invokes the handler. A handler throwing `project path is not a git
 * repository` is mapped to a 400; any other throw propagates to the server's
 * 500 boundary.
 */
export async function handleApi(
  res: ServerResponse,
  method: string,
  url: URL,
  body: Record<string, unknown>,
  engramPool: EngramPool,
): Promise<void> {
  const pathname = url.pathname;
  const pathMatched = ROUTES.some((route) => route.pattern.test(pathname));
  for (const route of ROUTES) {
    const match = route.pattern.exec(pathname);
    if (match === null || route.method !== method) continue;
    let project: Project | null = null;
    if (route.needsProject) {
      const resolution = resolveProject(url.searchParams.get("project"));
      if (!resolution.ok) {
        sendJson(res, resolution.status, { error: resolution.error });
        return;
      }
      project = resolution.project;
    }
    try {
      await route.handle({ res, method, url, body, engramPool }, match.slice(1), project);
    } catch (error) {
      if (error instanceof Error && error.message === NOT_A_GIT_REPO_ERROR) {
        sendJson(res, 400, { error: NOT_A_GIT_REPO_ERROR });
        return;
      }
      throw error;
    }
    return;
  }
  sendJson(res, pathMatched ? 405 : 404, {
    error: pathMatched ? `method not allowed: ${method} ${pathname}` : `not found: ${pathname}`,
  });
}
