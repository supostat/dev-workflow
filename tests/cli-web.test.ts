import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type AddressInfo, type Server } from "node:net";
import { request } from "node:http";
import { PACKAGE_ROOT } from "../src/lib/package-root.js";
import {
  parseWebArgs,
  parsePortValue,
  browserOpenCommand,
  webHelpText,
  listenWithFallback,
  registerCurrentProject,
} from "../src/cli/web.js";
import { createWebServer, type WebServerHandle } from "../src/web/server.js";

// ---------------------------------------------------------------------------
// Group A — parseWebArgs / parsePortValue (pure)
// ---------------------------------------------------------------------------
describe("parseWebArgs", () => {
  it("defaults to port 3737 and TTY-driven open", () => {
    expect(parseWebArgs([], true)).toEqual({ port: 3737, open: true });
    expect(parseWebArgs([], false)).toEqual({ port: 3737, open: false });
  });

  it("parses an explicit --port", () => {
    expect(parseWebArgs(["--port", "8080"], false).port).toBe(8080);
  });

  it("--open forces open even in non-TTY", () => {
    expect(parseWebArgs(["--open"], false).open).toBe(true);
  });

  it("--no-open disables open and overrides the TTY default", () => {
    expect(parseWebArgs(["--no-open"], true).open).toBe(false);
    expect(parseWebArgs(["--no-open"], false).open).toBe(false);
  });

  it("rejects --host with an ADR-citing message", () => {
    expect(() => parseWebArgs(["--host", "0.0.0.0"], false)).toThrow(
      'unknown flag "--host" — dashboard binds 127.0.0.1 only by design (see ADR)',
    );
  });

  it("rejects --unsafe-public with an ADR-citing message", () => {
    expect(() => parseWebArgs(["--unsafe-public"], false)).toThrow(/see ADR/);
  });

  it("rejects a non-integer --port value", () => {
    expect(() => parseWebArgs(["--port", "abc"], false)).toThrow(/invalid --port/);
  });

  it("rejects a --port without a value", () => {
    expect(() => parseWebArgs(["--port"], false)).toThrow(/--port requires a value/);
  });
});

describe("parsePortValue", () => {
  it("accepts an integer in range", () => {
    expect(parsePortValue("3737")).toBe(3737);
    expect(parsePortValue("1")).toBe(1);
    expect(parsePortValue("65535")).toBe(65535);
  });

  it("rejects out-of-range, zero, fractional and non-numeric values", () => {
    expect(() => parsePortValue("0")).toThrow(/invalid --port/);
    expect(() => parsePortValue("65536")).toThrow(/invalid --port/);
    expect(() => parsePortValue("80.5")).toThrow(/invalid --port/);
    expect(() => parsePortValue("xyz")).toThrow(/invalid --port/);
  });
});

// ---------------------------------------------------------------------------
// Group B — browserOpenCommand (pure, per-platform)
// ---------------------------------------------------------------------------
describe("browserOpenCommand", () => {
  it("resolves the macOS open command", () => {
    expect(browserOpenCommand("darwin", "http://127.0.0.1:3737")).toEqual({
      command: "open",
      args: ["http://127.0.0.1:3737"],
    });
  });

  it("resolves the Windows start command", () => {
    expect(browserOpenCommand("win32", "http://127.0.0.1:3737")).toEqual({
      command: "cmd",
      args: ["/c", "start", "", "http://127.0.0.1:3737"],
    });
  });

  it("resolves xdg-open on Linux", () => {
    expect(browserOpenCommand("linux", "http://127.0.0.1:3737")).toEqual({
      command: "xdg-open",
      args: ["http://127.0.0.1:3737"],
    });
  });
});

// ---------------------------------------------------------------------------
// Group C — webHelpText (pure)
// ---------------------------------------------------------------------------
describe("webHelpText", () => {
  const help = webHelpText();

  it("lists the four supported flags", () => {
    expect(help).toContain("--port");
    expect(help).toContain("--open");
    expect(help).toContain("--no-open");
    expect(help).toContain("--help");
  });

  it("does not advertise any hidden flag", () => {
    expect(help).not.toContain("--host");
    expect(help).not.toContain("--unsafe-public");
    expect(help).not.toContain("--detach");
  });
});

// ---------------------------------------------------------------------------
// Group D — listenWithFallback (in-process)
// ---------------------------------------------------------------------------

/** Open a throwaway listener and return its OS-assigned port (then closed). */
function allocateEphemeralPort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolvePromise(port));
    });
  });
}

/** Hold a raw TCP listener on `port` until `close()` is called. */
function occupyPort(port: number): Promise<Server> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolvePromise(server));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise) => server.close(() => resolvePromise()));
}

describe("listenWithFallback", () => {
  it("falls back to base+1 when the base port is occupied", async () => {
    const base = await allocateEphemeralPort();
    const blocker = await occupyPort(base);
    const handle = createWebServer();
    try {
      const bound = await listenWithFallback(handle, base);
      expect(bound).toBe(base + 1);
    } finally {
      await handle.close();
      await closeServer(blocker);
    }
  });

  it("rejects with the range message when the whole block is busy", async () => {
    const base = await allocateEphemeralPort();
    const blockers: Server[] = [];
    for (let offset = 0; offset < 5; offset += 1) {
      blockers.push(await occupyPort(base + offset));
    }
    const handle = createWebServer();
    try {
      await expect(listenWithFallback(handle, base)).rejects.toThrow(
        `Port range ${base}-${base + 4} all busy. Specify another via --port`,
      );
    } finally {
      await handle.close();
      for (const blocker of blockers) await closeServer(blocker);
    }
  });
});

// ---------------------------------------------------------------------------
// Group E — subprocess E2E against the built CLI
// ---------------------------------------------------------------------------

const CLI_PATH = join(PACKAGE_ROOT, "dist/cli/index.js");

interface SpawnedWeb {
  child: ChildProcess;
  /** Resolves with the bound port once the dashboard prints its URL. */
  port: Promise<number>;
  /** Accumulated stderr text. */
  stderr: () => string;
  /** Resolves with the process exit code once it terminates. */
  exited: Promise<number | null>;
}

/** Optional overrides for {@link spawnWeb} beyond the CLI arguments. */
interface SpawnWebOptions {
  /** Extra environment entries layered over the isolated defaults. */
  extraEnv?: NodeJS.ProcessEnv;
  /** Working directory for the spawned process (defaults to the runner cwd). */
  cwd?: string;
}

/** Spawn the built `dev-workflow web` CLI with isolated config + engram env. */
function spawnWeb(args: string[], options: SpawnWebOptions = {}): SpawnedWeb {
  const { extraEnv = {}, cwd } = options;
  const child = spawn(process.execPath, [CLI_PATH, "web", ...args], {
    cwd,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(PACKAGE_ROOT, "dist"),
      ENGRAM_SOCKET_PATH: "/tmp/no-such-engram-socket-cli-web-test",
      ...extraEnv,
    },
  });

  let stdoutText = "";
  let stderrText = "";
  child.stdout?.on("data", (chunk: Buffer) => (stdoutText += chunk.toString("utf-8")));
  child.stderr?.on("data", (chunk: Buffer) => (stderrText += chunk.toString("utf-8")));

  const port = new Promise<number>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error("dashboard did not start in time")), 8000);
    const poll = setInterval(() => {
      const match = stdoutText.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearInterval(poll);
        clearTimeout(timer);
        resolvePromise(Number(match[1]));
      }
    }, 50);
    child.once("exit", () => {
      clearInterval(poll);
      clearTimeout(timer);
      reject(new Error(`process exited before printing a URL — stderr: ${stderrText}`));
    });
  });

  // Swallow the rejection when a test only awaits `exited` (port exhaustion):
  // the process can exit before printing a URL, and an unobserved rejection
  // would otherwise surface as an unhandled error.
  port.catch(() => undefined);

  const exited = new Promise<number | null>((resolvePromise) => {
    child.once("exit", (code) => resolvePromise(code));
  });

  return { child, port, stderr: () => stderrText, exited };
}

/** Kill `child`, escalating to SIGKILL if it does not exit within 5s. */
async function killWeb(spawned: SpawnedWeb): Promise<void> {
  if (spawned.child.exitCode !== null || spawned.child.signalCode !== null) return;
  spawned.child.kill("SIGINT");
  const hardKill = setTimeout(() => spawned.child.kill("SIGKILL"), 5000);
  await spawned.exited;
  clearTimeout(hardKill);
}

/** Issue a GET and resolve with the status code and body. */
function httpGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const req = request({ host: "127.0.0.1", port, method: "GET", path }, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => (data += chunk.toString("utf-8")));
      res.on("end", () => resolvePromise({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("dev-workflow web — subprocess E2E", () => {
  let activeChild: SpawnedWeb | undefined;
  const heldServers: Server[] = [];

  beforeAll(() => {
    expect(
      existsSync(CLI_PATH),
      `${CLI_PATH} not found — run \`pnpm build\` before the E2E suite`,
    ).toBe(true);
  });

  afterEach(async () => {
    if (activeChild) {
      await killWeb(activeChild);
      activeChild = undefined;
    }
    while (heldServers.length > 0) {
      await closeServer(heldServers.pop()!);
    }
  });

  it("starts, serves /api/projects on 127.0.0.1, and shuts down on SIGINT", async () => {
    const base = await allocateEphemeralPort();
    const spawned = spawnWeb(["--port", String(base), "--no-open"]);
    activeChild = spawned;

    const port = await spawned.port;
    expect(port).toBe(base);

    const response = await httpGet(port, "/api/projects");
    expect(response.status).toBe(200);
    expect(() => JSON.parse(response.body)).not.toThrow();

    spawned.child.kill("SIGINT");
    const code = await spawned.exited;
    expect(code).toBe(0);
    expect(spawned.stderr()).toContain("Stopping dashboard server...");
    activeChild = undefined;
  }, 20000);

  it("falls back to base+1 when the base port is occupied", async () => {
    const base = await allocateEphemeralPort();
    heldServers.push(await occupyPort(base));

    const spawned = spawnWeb(["--port", String(base), "--no-open"]);
    activeChild = spawned;

    const port = await spawned.port;
    expect(port).toBe(base + 1);
    expect(spawned.stderr()).toContain(`Port ${base} in use, trying ${base + 1}...`);
  }, 20000);

  it("exits 1 with the range message when all 5 ports are busy", async () => {
    const base = await allocateEphemeralPort();
    for (let offset = 0; offset < 5; offset += 1) {
      heldServers.push(await occupyPort(base + offset));
    }

    const spawned = spawnWeb(["--port", String(base), "--no-open"]);
    activeChild = spawned;

    const code = await spawned.exited;
    expect(code).toBe(1);
    expect(spawned.stderr()).toContain(`Port range ${base}-${base + 4} all busy`);
    activeChild = undefined;
  }, 20000);

  it("keeps running when the browser-open command is unavailable", async () => {
    const base = await allocateEphemeralPort();
    // Strip PATH so neither `open`/`xdg-open` nor `cmd` resolves — the spawn
    // fails into the swallow path and the server must stay up.
    const spawned = spawnWeb(["--port", String(base), "--open"], { extraEnv: { PATH: "" } });
    activeChild = spawned;

    const port = await spawned.port;
    const response = await httpGet(port, "/api/projects");
    expect(response.status).toBe(200);
  }, 20000);
});

// ---------------------------------------------------------------------------
// Group E2 — cold-start project registration (subprocess + unit)
// ---------------------------------------------------------------------------

describe("dev-workflow web — cold-start project registration", () => {
  let activeChild: SpawnedWeb | undefined;
  const tempDirs: string[] = [];

  beforeAll(() => {
    expect(existsSync(CLI_PATH)).toBe(true);
  });

  afterEach(async () => {
    if (activeChild) {
      await killWeb(activeChild);
      activeChild = undefined;
    }
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  /**
   * Create an isolated temp dir, tracked for afterEach cleanup. The path is
   * canonicalised — macOS `tmpdir()` is a `/var → /private/var` symlink, and
   * the spawned process's `process.cwd()` reports the resolved path.
   */
  function makeTempDir(prefix: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    tempDirs.push(dir);
    return dir;
  }

  /** Spawn the CLI from `projectDir` with a fresh isolated registry home. */
  function spawnFromProject(port: number, projectDir: string, configHome: string): SpawnedWeb {
    return spawnWeb(["--port", String(port), "--no-open"], {
      cwd: projectDir,
      extraEnv: { XDG_CONFIG_HOME: configHome },
    });
  }

  it("registers the launch directory as the active project", async () => {
    const base = await allocateEphemeralPort();
    const configHome = makeTempDir("cli-web-config-");
    const projectDir = makeTempDir("cli-web-myproject-");

    const spawned = spawnFromProject(base, projectDir, configHome);
    activeChild = spawned;

    const port = await spawned.port;
    const response = await httpGet(port, "/api/projects");
    expect(response.status).toBe(200);
    const payload = JSON.parse(response.body) as {
      projects: Array<{ name: string; path: string; active: boolean }>;
      activeProject: string | null;
    };
    const registered = payload.projects.find((project) => project.path === projectDir);
    expect(registered).toBeDefined();
    expect(registered?.active).toBe(true);
    expect(payload.activeProject).toBe(registered?.name);
  }, 20000);

  it("is idempotent across two serialized launches from the same directory", async () => {
    const configHome = makeTempDir("cli-web-config-");
    const projectDir = makeTempDir("cli-web-idem-");

    const firstPort = await allocateEphemeralPort();
    const first = spawnFromProject(firstPort, projectDir, configHome);
    await first.port;
    first.child.kill("SIGINT");
    await first.exited;

    const secondPort = await allocateEphemeralPort();
    const second = spawnFromProject(secondPort, projectDir, configHome);
    activeChild = second;
    const port = await second.port;

    const response = await httpGet(port, "/api/projects");
    const payload = JSON.parse(response.body) as { projects: Array<{ path: string }> };
    const matching = payload.projects.filter((project) => project.path === projectDir);
    expect(matching).toHaveLength(1);
  }, 30000);

  it("starts and warns when the directory basename yields no valid name", async () => {
    const base = await allocateEphemeralPort();
    const configHome = makeTempDir("cli-web-config-");
    // A basename of only separators/dots slugifies to an empty, invalid name.
    const unsluggableDir = join(makeTempDir("cli-web-bad-"), "---");
    mkdirSync(unsluggableDir, { recursive: true });

    const spawned = spawnFromProject(base, unsluggableDir, configHome);
    activeChild = spawned;

    const port = await spawned.port;
    const response = await httpGet(port, "/api/projects");
    expect(response.status).toBe(200);
    expect(spawned.stderr()).toContain("Could not register the current project");
  }, 20000);
});

describe("registerCurrentProject", () => {
  it("keeps an already-active project rather than reclaiming the active slot", () => {
    const configHome = mkdtempSync(join(tmpdir(), "register-unit-"));
    const firstDir = mkdtempSync(join(tmpdir(), "register-first-"));
    const secondDir = mkdtempSync(join(tmpdir(), "register-second-"));
    const previousConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = configHome;
    const cwdSpy = vi.spyOn(process, "cwd");

    try {
      cwdSpy.mockReturnValue(firstDir);
      registerCurrentProject();

      cwdSpy.mockReturnValue(secondDir);
      registerCurrentProject();

      const registryPath = join(configHome, "dev-workflow", "projects.json");
      const registry = JSON.parse(readFileSync(registryPath, "utf-8")) as {
        projects: Record<string, { path: string }>;
        activeProject: string | null;
      };
      expect(Object.keys(registry.projects)).toHaveLength(2);
      const active = registry.activeProject;
      expect(active).not.toBeNull();
      expect(registry.projects[active!].path).toBe(firstDir);
    } finally {
      cwdSpy.mockRestore();
      if (previousConfigHome === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = previousConfigHome;
      }
      rmSync(configHome, { recursive: true, force: true });
      rmSync(firstDir, { recursive: true, force: true });
      rmSync(secondDir, { recursive: true, force: true });
    }
  });
});
