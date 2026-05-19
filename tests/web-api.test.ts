import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("../src/lib/engram.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/engram.js")>(
    "../src/lib/engram.js",
  );
  return {
    ...actual,
    engramSearch: vi.fn(async () => []),
    engramHealth: vi.fn(async () => ({ pendingJudgments: 3, modelsStale: false })),
  };
});

import { createWebServer, type WebServerHandle } from "../src/web/server.js";
import { addProject, setActiveProject } from "../src/web/projects.js";
import { resolveStaticPath } from "../src/web/static.js";

interface HttpResult {
  status: number;
  body: string;
}

function httpRequest(
  port: number,
  method: string,
  path: string,
  body?: string,
): Promise<HttpResult> {
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

describe("web API — 17 endpoints, mutations, traversal", () => {
  let configHome: string;
  let originalConfigHome: string | undefined;
  let originalSocketPath: string | undefined;
  let projectRoot: string;
  let projectName: string;
  let vaultPath: string;
  let handle: WebServerHandle;
  let port: number;

  beforeEach(async () => {
    originalConfigHome = process.env.XDG_CONFIG_HOME;
    originalSocketPath = process.env.ENGRAM_SOCKET_PATH;
    configHome = mkdtempSync(join(tmpdir(), "web-api-cfg-"));
    process.env.XDG_CONFIG_HOME = configHome;
    process.env.ENGRAM_SOCKET_PATH = "/tmp/no-such-engram-socket-isolated-test";

    projectRoot = mkdtempSync(join(tmpdir(), "web-api-proj-"));
    execFileSync("git", ["init", "-q"], { cwd: projectRoot });
    vaultPath = join(projectRoot, ".dev-vault");
    mkdirSync(join(vaultPath, "tasks"), { recursive: true });
    mkdirSync(join(vaultPath, "workflow-state", "runs"), { recursive: true });
    writeFileSync(join(vaultPath, "stack.md"), "# Stack\nNode + TypeScript\n", "utf-8");
    writeFileSync(join(vaultPath, "conventions.md"), "# Conventions\n## Patterns\n", "utf-8");
    writeFileSync(join(vaultPath, "knowledge.md"), "# Knowledge\nsearchable-token here\n", "utf-8");
    writeFileSync(join(vaultPath, "gameplan.md"), "# Gameplan\n", "utf-8");
    writeFileSync(
      join(vaultPath, "tasks", "task-001.md"),
      "---\nid: task-001\ntitle: First\nstatus: pending\npriority: high\n---\nbody\n",
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

    projectName = addProject(projectRoot).name;
    setActiveProject(projectName);

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
    rmSync(projectRoot, { recursive: true, force: true });
  });

  const q = (path: string): string =>
    path.includes("?") ? `${path}&project=${projectName}` : `${path}?project=${projectName}`;

  // ── projects ────────────────────────────────────────────────────────────────

  it("GET /api/projects lists projects with active marker", async () => {
    const result = await httpRequest(port, "GET", "/api/projects");
    const parsed = JSON.parse(result.body);
    expect(result.status).toBe(200);
    expect(parsed.projects[0].active).toBe(true);
  });

  it("GET /api/projects/active returns the active project", async () => {
    const result = await httpRequest(port, "GET", "/api/projects/active");
    expect(JSON.parse(result.body).activeProject.name).toBe(projectName);
  });

  it("POST /api/projects registers a new path", async () => {
    const other = mkdtempSync(join(tmpdir(), "web-api-extra-"));
    const result = await httpRequest(
      port, "POST", "/api/projects", JSON.stringify({ path: other }),
    );
    expect(result.status).toBe(201);
    rmSync(other, { recursive: true, force: true });
  });

  it("POST /api/projects rejects a non-absolute path", async () => {
    const result = await httpRequest(
      port, "POST", "/api/projects", JSON.stringify({ path: "relative" }),
    );
    expect(result.status).toBe(400);
  });

  it("PUT /api/projects/active switches the active project", async () => {
    const result = await httpRequest(
      port, "PUT", "/api/projects/active", JSON.stringify({ name: projectName }),
    );
    expect(result.status).toBe(200);
  });

  it("PUT /api/projects/active rejects an unknown name", async () => {
    const result = await httpRequest(
      port, "PUT", "/api/projects/active", JSON.stringify({ name: "ghost" }),
    );
    expect(result.status).toBe(400);
  });

  // ── vault ─────────────────────────────────────────────────────────────────────

  it("GET /api/vault/:section reads a vault file", async () => {
    const result = await httpRequest(port, "GET", q("/api/vault/stack"));
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body).content).toContain("Node + TypeScript");
  });

  it("PATCH /api/vault/:section persists and creates a backup", async () => {
    const patch = await httpRequest(
      port, "PATCH", q("/api/vault/knowledge"), JSON.stringify({ content: "# Knowledge\nrewritten\n" }),
    );
    expect(patch.status).toBe(200);
    expect(JSON.parse(patch.body).backupPath).toMatch(/knowledge\.md\.bak-/);

    const reread = await httpRequest(port, "GET", q("/api/vault/knowledge"));
    expect(JSON.parse(reread.body).content).toContain("rewritten");
    const backups = readdirSync(vaultPath).filter((f) => f.startsWith("knowledge.md.bak-"));
    expect(backups).toHaveLength(1);
  });

  it("GET /api/vault/search returns matches", async () => {
    const result = await httpRequest(port, "GET", q("/api/vault/search?q=searchable-token"));
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body).matches.length).toBeGreaterThan(0);
  });

  it("GET /api/vault/:section rejects an unknown section", async () => {
    const result = await httpRequest(port, "GET", q("/api/vault/secrets"));
    expect(result.status).toBe(400);
  });

  // ── tasks ─────────────────────────────────────────────────────────────────────

  it("GET /api/tasks lists tasks and filters by status", async () => {
    const all = await httpRequest(port, "GET", q("/api/tasks"));
    expect(JSON.parse(all.body).tasks).toHaveLength(1);
    const filtered = await httpRequest(port, "GET", q("/api/tasks?status=done"));
    expect(JSON.parse(filtered.body).tasks).toHaveLength(0);
  });

  it("GET /api/tasks/:id reads a single task", async () => {
    const result = await httpRequest(port, "GET", q("/api/tasks/task-001"));
    expect(JSON.parse(result.body).title).toBe("First");
  });

  it("GET /api/tasks/:id rejects a malformed id", async () => {
    const result = await httpRequest(port, "GET", q("/api/tasks/not-a-task"));
    expect(result.status).toBe(400);
  });

  it("POST /api/tasks creates a task", async () => {
    const result = await httpRequest(
      port, "POST", q("/api/tasks"), JSON.stringify({ title: "Created via API" }),
    );
    expect(result.status).toBe(201);
    expect(JSON.parse(result.body).title).toBe("Created via API");
  });

  it("PATCH /api/tasks/:id updates a task", async () => {
    const result = await httpRequest(
      port, "PATCH", q("/api/tasks/task-001"), JSON.stringify({ status: "done" }),
    );
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body).status).toBe("done");
  });

  it("GET /api/tasks/:id returns 404 for an unknown task", async () => {
    const result = await httpRequest(port, "GET", q("/api/tasks/task-999"));
    expect(result.status).toBe(404);
  });

  it("POST /api/tasks rejects a missing title", async () => {
    const result = await httpRequest(port, "POST", q("/api/tasks"), JSON.stringify({}));
    expect(result.status).toBe(400);
  });

  it("PATCH /api/tasks/:id rejects a malformed id", async () => {
    const result = await httpRequest(
      port, "PATCH", q("/api/tasks/nope"), JSON.stringify({ status: "done" }),
    );
    expect(result.status).toBe(400);
  });

  it("PATCH /api/tasks/:id returns 404 for an unknown task", async () => {
    const result = await httpRequest(
      port, "PATCH", q("/api/tasks/task-888"), JSON.stringify({ status: "done" }),
    );
    expect(result.status).toBe(404);
  });

  it("GET /api/tasks rejects an invalid status filter", async () => {
    const result = await httpRequest(port, "GET", q("/api/tasks?status=bogus"));
    expect(result.status).toBe(400);
  });

  it("GET /api/vault/search rejects a missing query", async () => {
    const result = await httpRequest(port, "GET", q("/api/vault/search"));
    expect(result.status).toBe(400);
  });

  // ── workflow ──────────────────────────────────────────────────────────────────

  it("GET /api/workflow/runs lists runs", async () => {
    const result = await httpRequest(port, "GET", q("/api/workflow/runs"));
    const runs = JSON.parse(result.body).runs;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ workflowName: "dev" });
    expect(runs[0].workflow).toBeUndefined();
    expect(runs[0].updatedAt).toBeUndefined();
  });

  it("GET /api/workflow/runs/:id reads a single run", async () => {
    const result = await httpRequest(port, "GET", q("/api/workflow/runs/run-aaaaaaaaaaaa"));
    expect(JSON.parse(result.body).workflowName).toBe("dev");
  });

  it("GET /api/workflow/runs/:id rejects a malformed run id", async () => {
    const result = await httpRequest(port, "GET", q("/api/workflow/runs/bad-id"));
    expect(result.status).toBe(400);
  });

  // ── engram ────────────────────────────────────────────────────────────────────

  it("GET /api/engram/stats returns aggregated stats", async () => {
    const result = await httpRequest(port, "GET", q("/api/engram/stats?runs=5"));
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body).scope.runCount).toBe(1);
  });

  it("GET /api/engram/health reports daemon health", async () => {
    const result = await httpRequest(port, "GET", q("/api/engram/health"));
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body).healthy).toBe(true);
  });

  // ── settings ──────────────────────────────────────────────────────────────────

  it("GET /api/settings returns profile + lock info", async () => {
    const result = await httpRequest(port, "GET", q("/api/settings"));
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toHaveProperty("lockFilePresent");
  });

  it("PATCH /api/settings/communication writes valid YAML", async () => {
    const yaml = "active_profile: senior_fast\nprofiles:\n  senior_fast:\n    language: en\n";
    const result = await httpRequest(
      port, "PATCH", q("/api/settings/communication"), JSON.stringify({ content: yaml }),
    );
    expect(result.status).toBe(200);
    expect(existsSync(join(vaultPath, "communication.yaml"))).toBe(true);
  });

  it("PATCH /api/settings/communication rejects malformed YAML", async () => {
    const result = await httpRequest(
      port, "PATCH", q("/api/settings/communication"), JSON.stringify({ content: "active_profile:\n" }),
    );
    expect(result.status).toBe(400);
    expect(existsSync(join(vaultPath, "communication.yaml"))).toBe(false);
  });

  it("PUT /api/settings/profile writes the profile state", async () => {
    const result = await httpRequest(
      port, "PUT", q("/api/settings/profile"), JSON.stringify({ profile: "senior_fast" }),
    );
    expect(result.status).toBe(200);
    expect(existsSync(join(vaultPath, ".profile-state"))).toBe(true);
  });

  // ── multi-project routing guards (AC#6) ──────────────────────────────────────

  it("request with no project param returns 400", async () => {
    const result = await httpRequest(port, "GET", "/api/vault/stack");
    expect(result.status).toBe(400);
  });

  it("request with an unknown project returns 400", async () => {
    const result = await httpRequest(port, "GET", "/api/vault/stack?project=ghost");
    expect(result.status).toBe(400);
  });

  it("request to a registered non-git directory returns 400", async () => {
    const nonGit = mkdtempSync(join(tmpdir(), "web-api-nongit-"));
    const name = addProject(nonGit).name;
    const result = await httpRequest(port, "GET", `/api/vault/stack?project=${name}`);
    expect(result.status).toBe(400);
    rmSync(nonGit, { recursive: true, force: true });
  });

  // ── path traversal (AC#7 — ≥5 cases) ─────────────────────────────────────────

  it("static path resolver rejects ../ traversal", () => {
    expect(resolveStaticPath("/../../etc/passwd")).toBeNull();
  });

  it("static path resolver rejects encoded %2e%2e traversal", () => {
    expect(resolveStaticPath("/%2e%2e/%2e%2e/etc/passwd")).toBeNull();
  });

  it("static path resolver rejects a NUL byte", () => {
    expect(resolveStaticPath("/index%00.html")).toBeNull();
  });

  it("static path resolver confines a leading-slash path inside the root", () => {
    // Leading slashes are stripped; the path is re-rooted under dist/dashboard
    // rather than resolving to the real filesystem root — never escapes.
    const resolved = resolveStaticPath("//etc/passwd");
    expect(resolved).not.toBeNull();
    expect(resolved!.includes("dist/dashboard")).toBe(true);
  });

  it("static path resolver rejects a backslash-disguised traversal", () => {
    expect(resolveStaticPath("/..%2f..%2f..%2fetc%2fpasswd")).toBeNull();
  });

  it("static path resolver rejects a malformed percent-encoding", () => {
    expect(resolveStaticPath("/%zz")).toBeNull();
  });

  it("static path resolver keeps a legitimate path inside the root", () => {
    const resolved = resolveStaticPath("/assets/app.js");
    expect(resolved).not.toBeNull();
    expect(resolved!.endsWith("assets/app.js")).toBe(true);
  });

  it("vault PATCH cannot escape the whitelist via a hostile section", async () => {
    const result = await httpRequest(
      port, "PATCH", q("/api/vault/..%2f..%2fpasswd"), JSON.stringify({ content: "x" }),
    );
    expect(result.status).toBe(400);
  });

  // ── error boundary + validation branches ─────────────────────────────────────

  it("a handler throwing a non-NOT_A_GIT_REPO error yields a 500", async () => {
    // Replacing a vault section file with a directory makes writeSection's
    // copyFileSync (the backup step) throw EISDIR. patchVaultSection does not
    // catch it, so the throw — not the NOT_A_GIT_REPO sentinel — propagates to
    // the server's 500 boundary.
    rmSync(join(vaultPath, "gameplan.md"), { force: true });
    mkdirSync(join(vaultPath, "gameplan.md"), { recursive: true });
    const result = await httpRequest(
      port, "PATCH", q("/api/vault/gameplan"), JSON.stringify({ content: "x" }),
    );
    expect(result.status).toBe(500);
    expect(JSON.parse(result.body)).toHaveProperty("error");
  });

  it("POST /api/projects rejects a missing path", async () => {
    const result = await httpRequest(port, "POST", "/api/projects", JSON.stringify({}));
    expect(result.status).toBe(400);
  });

  it("POST /api/projects rejects an empty path", async () => {
    const result = await httpRequest(
      port, "POST", "/api/projects", JSON.stringify({ path: "" }),
    );
    expect(result.status).toBe(400);
  });

  it("POST /api/projects rejects a non-existent path", async () => {
    const result = await httpRequest(
      port, "POST", "/api/projects", JSON.stringify({ path: "/no/such/path/web-api-test" }),
    );
    expect(result.status).toBe(400);
  });

  it("PATCH /api/vault/:section rejects an unknown section", async () => {
    const result = await httpRequest(
      port, "PATCH", q("/api/vault/secrets"), JSON.stringify({ content: "x" }),
    );
    expect(result.status).toBe(400);
  });

  it("PATCH /api/vault/:section rejects a non-string content", async () => {
    const result = await httpRequest(
      port, "PATCH", q("/api/vault/knowledge"), JSON.stringify({ content: 42 }),
    );
    expect(result.status).toBe(400);
  });

  it("PUT /api/settings/profile rejects an empty profile name", async () => {
    const result = await httpRequest(
      port, "PUT", q("/api/settings/profile"), JSON.stringify({ profile: "   " }),
    );
    expect(result.status).toBe(400);
  });

  it("PUT /api/settings/profile rejects a missing profile name", async () => {
    const result = await httpRequest(
      port, "PUT", q("/api/settings/profile"), JSON.stringify({}),
    );
    expect(result.status).toBe(400);
  });

  it("PATCH /api/settings/communication rejects an empty content", async () => {
    const result = await httpRequest(
      port, "PATCH", q("/api/settings/communication"), JSON.stringify({ content: "" }),
    );
    expect(result.status).toBe(400);
  });
});
