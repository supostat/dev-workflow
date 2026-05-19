"use client";

// Active-project React context for the dashboard.
//
// `ProjectProvider` loads the active project from `GET /api/projects/active`
// on mount and subscribes to the `/events/projects` SSE topic so a switch in
// another browser tab is picked up here too. `useActiveProject` exposes the
// current project, the load `error` (null on success), and a `setActiveProject`
// action; `useApi` binds the project-scoped REST wrappers to the active project.
//
// A failed active-project fetch settles `loading` to false and surfaces the
// reason through `error` — the provider never hangs on a network failure.
//
// `useApi` returns a 4-state DISCRIMINATED value so pages can tell the
// non-ready cases apart instead of hanging on a single "loading" branch:
//   - `{ ready: true, api }`                    — a project is active;
//   - `{ ready: false, reason: "loading" }`     — the mount fetch is in flight;
//   - `{ ready: false, reason: "no-project" }`  — the fetch settled with no
//                                                 registered/active project;
//   - `{ ready: false, reason: "error", message }` — the fetch failed; the
//                                                 message surfaces the cause.
// Pages gate on `ready` instead of calling a project-scoped wrapper with no
// project — there is no bare throw during the fetch-on-mount window (R5).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  getActiveProject,
  getProjects,
  putActiveProject,
  getVaultSection,
  patchVaultSection,
  searchVault,
  getTasks,
  getTask,
  createTask,
  patchTask,
  getWorkflowRuns,
  getWorkflowRun,
  getEngramStats,
  getEngramHealth,
  getSettings,
  patchCommunication,
  putProfile,
} from "./api";
import { useEventSource } from "./sse";

const PROJECTS_EVENT_URL = "/events/projects";

/** Project-scoped REST wrappers with the active project pre-bound. */
export interface BoundApi {
  getVaultSection: OmitProject<typeof getVaultSection>;
  patchVaultSection: OmitProject<typeof patchVaultSection>;
  searchVault: OmitProject<typeof searchVault>;
  getTasks: OmitProject<typeof getTasks>;
  getTask: OmitProject<typeof getTask>;
  createTask: OmitProject<typeof createTask>;
  patchTask: OmitProject<typeof patchTask>;
  getWorkflowRuns: OmitProject<typeof getWorkflowRuns>;
  getWorkflowRun: OmitProject<typeof getWorkflowRun>;
  getEngramStats: OmitProject<typeof getEngramStats>;
  getEngramHealth: OmitProject<typeof getEngramHealth>;
  getSettings: OmitProject<typeof getSettings>;
  patchCommunication: OmitProject<typeof patchCommunication>;
  putProfile: OmitProject<typeof putProfile>;
}

/** Drop the leading `project: string` parameter from a wrapper signature. */
type OmitProject<Fn> = Fn extends (project: string, ...rest: infer R) => infer T
  ? (...args: R) => T
  : never;

/** 4-state discriminated `useApi()` result — see the file header. */
export type ApiBinding =
  | { ready: true; api: BoundApi }
  | { ready: false; reason: "loading" }
  | { ready: false; reason: "no-project" }
  | { ready: false; reason: "error"; message: string };

/** Value carried by the project context. */
interface ProjectContextValue {
  activeProject: string | null;
  /** Names of every registered project, kept live by the `projects` SSE topic. */
  projects: string[];
  loading: boolean;
  /** The active-project fetch failure, or null while the load succeeded. */
  error: string | null;
  setActiveProject: (name: string) => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

/** Provide the active-project context to the dashboard subtree. */
export function ProjectProvider({ children }: { children: ReactNode }): ReactElement {
  const [activeProject, setActiveProjectState] = useState<string | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await getActiveProject();
      setActiveProjectState(response.activeProject?.name ?? null);
      setError(null);
    } catch (reason: unknown) {
      setActiveProjectState(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
    try {
      const registry = await getProjects();
      setProjects(registry.projects.map((project) => project.name));
    } catch {
      // The navbar switcher list is non-critical: on a failed registry fetch
      // it keeps its last-known list, while the active-project branch above
      // owns the user-facing error surface.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEventSource(PROJECTS_EVENT_URL, "projects", () => {
    void refresh();
  });

  const setActiveProject = useCallback(async (name: string): Promise<void> => {
    await putActiveProject(name);
    setActiveProjectState(name);
  }, []);

  const value = useMemo<ProjectContextValue>(
    () => ({ activeProject, projects, loading, error, setActiveProject }),
    [activeProject, projects, loading, error, setActiveProject],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

/** Read the active-project context. Throws when used outside `ProjectProvider`. */
export function useActiveProject(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (value === null) {
    throw new Error("useActiveProject must be used within a ProjectProvider");
  }
  return value;
}

/**
 * Bind the project-scoped REST wrappers to the active project. While no
 * project is resolved it returns one of three non-ready discriminants —
 * `loading`, `no-project`, or `error` — so pages can render the right notice;
 * `api` is available only once `ready` is true.
 */
export function useApi(): ApiBinding {
  const { activeProject, loading, error } = useActiveProject();
  return useMemo<ApiBinding>(() => {
    if (activeProject !== null) return { ready: true, api: bindApi(activeProject) };
    if (error !== null) return { ready: false, reason: "error", message: error };
    if (loading) return { ready: false, reason: "loading" };
    return { ready: false, reason: "no-project" };
  }, [activeProject, loading, error]);
}

/** Partially apply every project-scoped wrapper with `project`. */
function bindApi(project: string): BoundApi {
  return {
    getVaultSection: (...args) => getVaultSection(project, ...args),
    patchVaultSection: (...args) => patchVaultSection(project, ...args),
    searchVault: (...args) => searchVault(project, ...args),
    getTasks: (...args) => getTasks(project, ...args),
    getTask: (...args) => getTask(project, ...args),
    createTask: (...args) => createTask(project, ...args),
    patchTask: (...args) => patchTask(project, ...args),
    getWorkflowRuns: (...args) => getWorkflowRuns(project, ...args),
    getWorkflowRun: (...args) => getWorkflowRun(project, ...args),
    getEngramStats: (...args) => getEngramStats(project, ...args),
    getEngramHealth: (...args) => getEngramHealth(project, ...args),
    getSettings: (...args) => getSettings(project, ...args),
    patchCommunication: (...args) => patchCommunication(project, ...args),
    putProfile: (...args) => putProfile(project, ...args),
  };
}
