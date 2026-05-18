import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { createWebServer, type WebServerHandle } from "../src/web/server.js";
import { addProject } from "../src/web/projects.js";
import { EngramPool, resolveProjectSocketPath } from "../src/web/engram-pool.js";

function httpRequest(
  port: number,
  method: string,
  path: string,
  body?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const req = request(
      { host: "127.0.0.1", port, method, path, headers: { "Content-Type": "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString("utf-8")));
        res.on("end", () => resolvePromise({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Create a git-initialised project with a one-line stack.md marker. */
function makeProject(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `web-multi-${label}-`));
  execFileSync("git", ["init", "-q"], { cwd: root });
  mkdirSync(join(root, ".dev-vault"), { recursive: true });
  writeFileSync(join(root, ".dev-vault", "stack.md"), `# Stack of ${label}\n`, "utf-8");
  return root;
}

describe("web multi-project — routing + isolation", () => {
  let configHome: string;
  let originalConfigHome: string | undefined;
  let originalSocketPath: string | undefined;
  let rootA: string;
  let rootB: string;
  let nameA: string;
  let nameB: string;
  let handle: WebServerHandle;
  let port: number;

  beforeEach(async () => {
    originalConfigHome = process.env.XDG_CONFIG_HOME;
    originalSocketPath = process.env.ENGRAM_SOCKET_PATH;
    configHome = mkdtempSync(join(tmpdir(), "web-multi-cfg-"));
    process.env.XDG_CONFIG_HOME = configHome;
    delete process.env.ENGRAM_SOCKET_PATH;

    rootA = makeProject("alpha");
    rootB = makeProject("beta");
    nameA = addProject(rootA).name;
    nameB = addProject(rootB).name;

    handle = createWebServer();
    await handle.listen(0);
    port = (handle.server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await handle.close();
    if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalConfigHome;
    if (originalSocketPath === undefined) delete process.env.ENGRAM_SOCKET_PATH;
    else process.env.ENGRAM_SOCKET_PATH = originalSocketPath;
    rmSync(configHome, { recursive: true, force: true });
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  });

  it("lists both registered projects", async () => {
    const result = await httpRequest(port, "GET", "/api/projects");
    expect(JSON.parse(result.body).projects).toHaveLength(2);
  });

  it("vault read returns the content of the requested project", async () => {
    const a = await httpRequest(port, "GET", `/api/vault/stack?project=${nameA}`);
    const b = await httpRequest(port, "GET", `/api/vault/stack?project=${nameB}`);
    expect(JSON.parse(a.body).content).toContain("alpha");
    expect(JSON.parse(b.body).content).toContain("beta");
  });

  it("switching the active project does not change another project's read", async () => {
    const switched = await httpRequest(
      port, "PUT", "/api/projects/active", JSON.stringify({ name: nameA }),
    );
    expect(switched.status).toBe(200);
    const active = await httpRequest(port, "GET", "/api/projects/active");
    expect(JSON.parse(active.body).activeProject.name).toBe(nameA);
    // The B-scoped read still resolves B's vault despite A being active.
    const b = await httpRequest(port, "GET", `/api/vault/stack?project=${nameB}`);
    expect(JSON.parse(b.body).content).toContain("beta");
  });

  it("a write to one project's vault is invisible to the other", async () => {
    writeFileSync(join(rootA, ".dev-vault", "stack.md"), "# Stack of alpha\nMUTATED\n", "utf-8");
    const a = await httpRequest(port, "GET", `/api/vault/stack?project=${nameA}`);
    const b = await httpRequest(port, "GET", `/api/vault/stack?project=${nameB}`);
    expect(JSON.parse(a.body).content).toContain("MUTATED");
    expect(JSON.parse(b.body).content).not.toContain("MUTATED");
  });

  it("the engram pool resolves a distinct socket path per project", () => {
    const pool = new EngramPool();
    const projectA = { name: nameA, path: rootA, lastSeen: "" };
    const projectB = { name: nameB, path: rootB, lastSeen: "" };
    const socketA = pool.getConnection(projectA).socketPath;
    const socketB = pool.getConnection(projectB).socketPath;
    expect(socketA).not.toBe(socketB);
    expect(socketA).toBe(join(rootA, ".engram", "engram.sock"));
    expect(socketB).toBe(join(rootB, ".engram", "engram.sock"));
    pool.shutdown();
  });

  it("the engram pool reuses one entry per project across calls", () => {
    const pool = new EngramPool();
    const projectA = { name: nameA, path: rootA, lastSeen: "" };
    pool.getConnection(projectA);
    pool.getConnection(projectA);
    expect(pool.size()).toBe(1);
    pool.releaseConnection(projectA);
    expect(pool.size()).toBe(0);
    pool.shutdown();
  });

  it("ENGRAM_SOCKET_PATH override wins over per-project resolution", () => {
    process.env.ENGRAM_SOCKET_PATH = "/tmp/explicit-override.sock";
    try {
      expect(resolveProjectSocketPath(rootA)).toBe("/tmp/explicit-override.sock");
    } finally {
      delete process.env.ENGRAM_SOCKET_PATH;
    }
  });

  it("evicts a pooled project entry after the 10-min idle TTL (AC#5)", () => {
    // armIdleTimer schedules a setTimeout that drops the entry. Fake timers
    // advance past the 10-minute TTL so the eviction fires deterministically.
    vi.useFakeTimers();
    try {
      const pool = new EngramPool();
      const projectA = { name: nameA, path: rootA, lastSeen: "" };
      pool.getConnection(projectA);
      expect(pool.size()).toBe(1);
      // Before the TTL elapses the entry survives.
      vi.advanceTimersByTime(10 * 60 * 1000 - 1000);
      expect(pool.size()).toBe(1);
      // Crossing the 10-minute boundary fires the idle-eviction callback.
      vi.advanceTimersByTime(2000);
      expect(pool.size()).toBe(0);
      pool.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a fresh getConnection re-arms the idle timer, deferring eviction (AC#5)", () => {
    vi.useFakeTimers();
    try {
      const pool = new EngramPool();
      const projectA = { name: nameA, path: rootA, lastSeen: "" };
      pool.getConnection(projectA);
      // A touch at the 9-minute mark resets the 10-minute idle window.
      vi.advanceTimersByTime(9 * 60 * 1000);
      pool.getConnection(projectA);
      // 9 more minutes — would have evicted the original timer, but it was
      // cleared and re-armed, so the entry is still pooled.
      vi.advanceTimersByTime(9 * 60 * 1000);
      expect(pool.size()).toBe(1);
      // 2 more minutes crosses the re-armed TTL → eviction.
      vi.advanceTimersByTime(2 * 60 * 1000);
      expect(pool.size()).toBe(0);
      pool.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });
});
