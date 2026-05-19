import { test as base } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Test-scoped Playwright fixture booting the real `dev-workflow web` CLI.
//
// Each test gets its own CLI subprocess + a hermetic `mkdtemp` fixture project
// + an empty `mkdtemp` XDG_CONFIG_HOME, all torn down after. The empty config
// home means the CLI's `registerCurrentProject()` has no prior registry —
// auto-registering the fixture dir IS the cold-start path the spec exercises.
//
// Per-test (not per-worker) scope is deliberate: the web server rate-limits
// `/api/*` to 60 requests per rolling minute per client IP, and the full suite
// issues well past 60 from one `127.0.0.1` browser. A shared worker subprocess
// would exhaust that budget and 429 the later specs. A fresh subprocess gives
// each test its own rate-limit bucket. `workers: 1` already serialises the
// suite, so per-test subprocesses still run one at a time with no overlap.

/** Repo root — `e2e/fixtures/` sits two levels under it. */
const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/**
 * How long `waitForReady` polls the child's stdout for the dashboard URL.
 * Generous: a cold CI runner's first `dist/cli/index.js` start is slow, and a
 * tight bound turns a slow boot into a spurious failure.
 */
const READY_TIMEOUT_MS = 15_000;

/** Grace period after SIGINT before `killWeb` escalates to SIGKILL. */
const SIGKILL_ESCALATION_MS = 5_000;

/** One entry of the `GET /api/projects` registry payload. */
export interface RegistryProject {
  name: string;
  path: string;
}

/** The `GET /api/projects` payload shape. */
export interface ProjectsPayload {
  projects: RegistryProject[];
  activeProject: string | null;
}

/** The booted dashboard surface handed to specs via the `dashboard` fixture. */
export interface DashboardServer {
  /** Base URL of the running dashboard, e.g. `http://127.0.0.1:54321`. */
  baseURL: string;
  /** Registry name of the auto-registered fixture project. */
  projectName: string;
  /**
   * The `GET /api/projects` payload fetched once at boot — captured here
   * because the server rate-limits to 60 requests/minute per client and a late
   * spec issuing its own call competes with the suite's request budget. This
   * snapshot is also the genuine cold-start state: auto-registration is a
   * boot-time fact.
   */
  bootProjects: ProjectsPayload;
}

/**
 * A dashboard booted from a NON-project directory with an empty config home —
 * nothing is or can be auto-registered, so the registry stays empty. This is
 * the genuine v3.0.0 cold-start the `emptyDashboard` fixture reproduces.
 */
export interface NoProjectDashboard {
  /** Base URL of the running dashboard. */
  baseURL: string;
  /** The `GET /api/projects` payload at boot — expected to be empty. */
  bootProjects: ProjectsPayload;
}

/** Open a throwaway listener and resolve its OS-assigned port (then close it). */
function allocateEphemeralPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolvePort(port));
    });
  });
}

/**
 * Create a hermetic fixture project with a populated `.dev-vault/`: one task,
 * one workflow run, and the four vault sections. The temp dir is canonicalised
 * — macOS `tmpdir()` is a `/var → /private/var` symlink and the spawned CLI
 * reports the resolved `process.cwd()`.
 */
function scaffoldFixtureProject(): string {
  const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "e2e-dashboard-")));
  execFileSync("git", ["init", "-q"], { cwd: projectRoot });
  const vaultPath = join(projectRoot, ".dev-vault");
  mkdirSync(join(vaultPath, "tasks"), { recursive: true });
  mkdirSync(join(vaultPath, "workflow-state", "runs"), { recursive: true });
  writeFileSync(join(vaultPath, "stack.md"), "# Stack\nNode + TypeScript\n", "utf-8");
  writeFileSync(join(vaultPath, "conventions.md"), "# Conventions\n## Patterns\n", "utf-8");
  writeFileSync(join(vaultPath, "knowledge.md"), "# Knowledge\nsearchable-token here\n", "utf-8");
  writeFileSync(join(vaultPath, "gameplan.md"), "# Gameplan\n", "utf-8");
  writeFileSync(
    join(vaultPath, "tasks", "task-001.md"),
    "---\nid: task-001\ntitle: First task\nstatus: pending\npriority: high\n---\nbody\n",
    "utf-8",
  );
  writeFileSync(
    join(vaultPath, "workflow-state", "runs", "run-aaaaaaaaaaaa.json"),
    JSON.stringify({
      id: "run-aaaaaaaaaaaa", workflowName: "dev", taskId: null, taskDescription: "t",
      phase: null, currentStep: "code", startedAt: "2026-05-18T00:00:00.000Z",
      completedAt: null, status: "running", steps: {},
    }),
    "utf-8",
  );
  return projectRoot;
}

/** Spawn the built `dev-workflow web` CLI with an isolated config + engram env. */
function spawnWebCli(port: number, cwd: string, configHome: string): ChildProcess {
  return spawn(
    process.execPath,
    [join(repoRoot, "dist/cli/index.js"), "web", "--port", String(port), "--no-open"],
    {
      cwd,
      env: {
        ...process.env,
        XDG_CONFIG_HOME: configHome,
        ENGRAM_SOCKET_PATH: "/tmp/no-such-engram-socket-e2e",
      },
    },
  );
}

/**
 * Poll the child's accumulated stdout for the printed dashboard URL and
 * resolve with the *bound* port parsed from it — never assume the requested
 * port was granted (the CLI falls back to base+1 when a port is occupied).
 * Rejects on an early child exit, surfacing the accumulated stderr.
 */
function waitForReady(child: ChildProcess): Promise<number> {
  return new Promise((resolvePort, reject) => {
    let stdoutText = "";
    let stderrText = "";
    child.stdout?.on("data", (chunk: Buffer) => (stdoutText += chunk.toString("utf-8")));
    child.stderr?.on("data", (chunk: Buffer) => (stderrText += chunk.toString("utf-8")));
    const timer = setTimeout(() => {
      clearInterval(poll);
      reject(
        new Error(
          `dashboard did not start in ${READY_TIMEOUT_MS}ms — stderr: ${stderrText}`,
        ),
      );
    }, READY_TIMEOUT_MS);
    const poll = setInterval(() => {
      const match = stdoutText.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearInterval(poll);
        clearTimeout(timer);
        resolvePort(Number(match[1]));
      }
    }, 50);
    child.once("exit", () => {
      clearInterval(poll);
      clearTimeout(timer);
      reject(new Error(`dashboard exited before printing a URL — stderr: ${stderrText}`));
    });
  });
}

/** Kill the dashboard process, escalating SIGINT to SIGKILL after a grace period. */
async function killWeb(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
  child.kill("SIGINT");
  const hardKill = setTimeout(() => child.kill("SIGKILL"), SIGKILL_ESCALATION_MS);
  await exited;
  clearTimeout(hardKill);
}

/** Fetch the `GET /api/projects` registry payload once at boot. */
async function fetchBootProjects(baseURL: string): Promise<ProjectsPayload> {
  const response = await fetch(`${baseURL}/api/projects`);
  if (!response.ok) {
    throw new Error(`GET /api/projects returned ${response.status}`);
  }
  return (await response.json()) as ProjectsPayload;
}

/** Return the registry name of the project whose `path` matches `projectRoot`. */
function projectNameForRoot(payload: ProjectsPayload, projectRoot: string): string {
  const registered = payload.projects.find((project) => project.path === projectRoot);
  if (registered === undefined) {
    throw new Error(`fixture project ${projectRoot} not auto-registered`);
  }
  return registered.name;
}

/**
 * A directory basename that `addProject`'s slugifier reduces to the empty
 * string — only dots, which it strips as leading punctuation. Launching the
 * CLI from such a directory makes `registerCurrentProject()` fail to register
 * anything, leaving the registry genuinely empty: the v3.0.0 cold start.
 */
const UNSLUGGABLE_BASENAME = "...";

/**
 * Create a launch directory the CLI CANNOT auto-register: a bare temp dir
 * (no `.dev-vault/`) whose basename slugifies to nothing. Spawning the web CLI
 * here leaves the project registry empty — the genuine cold-start state.
 * Returns the directory path; its parent is returned separately for cleanup.
 */
function scaffoldUnregistrableDir(): { launchDir: string; parent: string } {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "e2e-no-project-")));
  const launchDir = join(parent, UNSLUGGABLE_BASENAME);
  mkdirSync(launchDir);
  return { launchDir, parent };
}

export const test = base.extend<{
  dashboard: DashboardServer;
  emptyDashboard: NoProjectDashboard;
}>({
  dashboard: async ({}, use) => {
    const projectRoot = scaffoldFixtureProject();
    const configHome = realpathSync(mkdtempSync(join(tmpdir(), "e2e-config-")));
    const requestedPort = await allocateEphemeralPort();
    const child = spawnWebCli(requestedPort, projectRoot, configHome);
    try {
      const boundPort = await waitForReady(child);
      const baseURL = `http://127.0.0.1:${boundPort}`;
      const bootProjects = await fetchBootProjects(baseURL);
      const projectName = projectNameForRoot(bootProjects, projectRoot);
      await use({ baseURL, projectName, bootProjects });
    } finally {
      await killWeb(child);
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(configHome, { recursive: true, force: true });
    }
  },

  emptyDashboard: async ({}, use) => {
    const { launchDir, parent } = scaffoldUnregistrableDir();
    const configHome = realpathSync(mkdtempSync(join(tmpdir(), "e2e-config-")));
    const requestedPort = await allocateEphemeralPort();
    const child = spawnWebCli(requestedPort, launchDir, configHome);
    try {
      const boundPort = await waitForReady(child);
      const baseURL = `http://127.0.0.1:${boundPort}`;
      const bootProjects = await fetchBootProjects(baseURL);
      await use({ baseURL, bootProjects });
    } finally {
      await killWeb(child);
      rmSync(parent, { recursive: true, force: true });
      rmSync(configHome, { recursive: true, force: true });
    }
  },
});

export { expect } from "@playwright/test";
