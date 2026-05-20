import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { createWebServer, type WebServerHandle } from "../src/web/server.js";
import { addProject, setActiveProject } from "../src/web/projects.js";
import { staticRoot } from "../src/web/static.js";

interface HttpResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** Issue one HTTP request against `port` and collect the full response. */
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
        res.on("end", () =>
          resolvePromise({ status: res.statusCode ?? 0, headers: res.headers, body: data }),
        );
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe("web server — lifecycle, security, dispatch", () => {
  let configHome: string;
  let originalConfigHome: string | undefined;
  let originalSocketPath: string | undefined;
  let projectRoot: string;
  let projectName: string;
  let handle: WebServerHandle;
  let port: number;

  beforeEach(async () => {
    originalConfigHome = process.env.XDG_CONFIG_HOME;
    originalSocketPath = process.env.ENGRAM_SOCKET_PATH;
    configHome = mkdtempSync(join(tmpdir(), "web-server-cfg-"));
    process.env.XDG_CONFIG_HOME = configHome;
    process.env.ENGRAM_SOCKET_PATH = "/tmp/no-such-engram-socket-isolated-test";

    projectRoot = mkdtempSync(join(tmpdir(), "web-server-proj-"));
    execFileSync("git", ["init", "-q"], { cwd: projectRoot });
    mkdirSync(join(projectRoot, ".dev-vault"), { recursive: true });
    writeFileSync(join(projectRoot, ".dev-vault", "stack.md"), "# Stack\n", "utf-8");
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

  it("binds to 127.0.0.1 and serves the projects endpoint", async () => {
    const result = await httpRequest(port, "GET", "/api/projects");
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body).projects).toHaveLength(1);
  });

  it("server address family is IPv4 loopback (AC#12)", () => {
    const address = handle.server.address() as AddressInfo;
    expect(address.address).toBe("127.0.0.1");
  });

  it("unknown route returns 404", async () => {
    const result = await httpRequest(port, "GET", "/api/nonexistent");
    expect(result.status).toBe(404);
  });

  it("known path with wrong method returns 405", async () => {
    const result = await httpRequest(port, "DELETE", "/api/projects");
    expect(result.status).toBe(405);
  });

  it("OPTIONS preflight returns 204 (AC#11)", async () => {
    const result = await httpRequest(port, "OPTIONS", "/api/projects");
    expect(result.status).toBe(204);
  });

  it("CORS header is the narrow loopback origin (AC#11)", async () => {
    const result = await httpRequest(port, "GET", "/api/projects");
    expect(result.headers["access-control-allow-origin"]).toBe(`http://127.0.0.1:${port}`);
  });

  it("body over 1MB returns 413 (AC#9)", async () => {
    const oversized = JSON.stringify({ content: "x".repeat(1024 * 1024 + 100) });
    const result = await httpRequest(
      port, "PATCH", `/api/vault/knowledge?project=${projectName}`, oversized,
    );
    expect(result.status).toBe(413);
  });

  it("body just under 1MB is accepted", async () => {
    const payload = JSON.stringify({ content: "y".repeat(500 * 1024) });
    const result = await httpRequest(
      port, "PATCH", `/api/vault/knowledge?project=${projectName}`, payload,
    );
    expect(result.status).toBe(200);
  });

  it("61st request within the window returns 429 (AC#10)", async () => {
    let sawRateLimit = false;
    for (let i = 0; i < 65; i++) {
      const result = await httpRequest(port, "GET", "/api/projects");
      if (result.status === 429) {
        sawRateLimit = true;
        break;
      }
    }
    expect(sawRateLimit).toBe(true);
  });

  it("malformed JSON body returns 400", async () => {
    const result = await httpRequest(
      port, "POST", "/api/projects", "{not json",
    );
    expect(result.status).toBe(400);
  });

  it("non-object JSON body returns 400", async () => {
    const result = await httpRequest(port, "POST", "/api/projects", "[1,2,3]");
    expect(result.status).toBe(400);
  });

  it("a malformed request URL returns 400", async () => {
    // `http.request` validates paths client-side, so the malformed request
    // target is written over a raw socket. A bare `%` is not valid percent-
    // encoding — `new URL` throws and the server maps it to 400.
    const responseLine = await new Promise<string>((resolvePromise, reject) => {
      const socket = connect(port, "127.0.0.1", () => {
        socket.write("GET /%api HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
      });
      let data = "";
      socket.setEncoding("utf-8");
      socket.on("data", (chunk: string) => (data += chunk));
      socket.on("end", () => resolvePromise(data.split("\r\n")[0] ?? ""));
      socket.on("error", reject);
    });
    expect(responseLine).toContain("400");
  });

  it("a request aborted mid-body does not crash the server", async () => {
    // Announce a 200-byte body, send 10, then destroy the socket — exercising
    // readBody's `req.on("error")` path. The server must stay up afterwards.
    await new Promise<void>((resolvePromise) => {
      const socket = connect(port, "127.0.0.1", () => {
        socket.write(
          "POST /api/projects HTTP/1.1\r\nHost: 127.0.0.1\r\n" +
            "Content-Type: application/json\r\nContent-Length: 200\r\n\r\n",
        );
        socket.write('{"path":"/tm');
        setTimeout(() => {
          socket.destroy();
          resolvePromise();
        }, 50);
      });
      socket.on("error", () => resolvePromise());
    });
    // The server is still responsive after the aborted request.
    const followUp = await httpRequest(port, "GET", "/api/projects");
    expect(followUp.status).toBe(200);
  });

  it("close() shuts down — subsequent request is refused", async () => {
    await handle.close();
    await expect(httpRequest(port, "GET", "/api/projects")).rejects.toThrow();
    // re-open so afterEach close() is a no-op-safe second call
    handle = createWebServer();
    await handle.listen(0);
    port = (handle.server.address() as AddressInfo).port;
  });
});

describe("web server — static dashboard serving", () => {
  let configHome: string;
  let originalConfigHome: string | undefined;
  let originalSocketPath: string | undefined;
  let originalStaticRoot: string | undefined;
  let staticFixtureRoot: string;
  let handle: WebServerHandle;
  let port: number;

  beforeEach(async () => {
    originalConfigHome = process.env.XDG_CONFIG_HOME;
    originalSocketPath = process.env.ENGRAM_SOCKET_PATH;
    originalStaticRoot = process.env.DEV_WORKFLOW_STATIC_ROOT;
    configHome = mkdtempSync(join(tmpdir(), "web-static-cfg-"));
    process.env.XDG_CONFIG_HOME = configHome;
    process.env.ENGRAM_SOCKET_PATH = "/tmp/no-such-engram-socket-isolated-test";

    // Redirect the static root into a hermetic fixture so this suite can
    // never overwrite a real dist/dashboard build (which `publish.yml`
    // runs between build and publish — release-integrity hazard).
    staticFixtureRoot = mkdtempSync(join(tmpdir(), "web-static-root-"));
    process.env.DEV_WORKFLOW_STATIC_ROOT = staticFixtureRoot;
    // Sanity check — the function the server uses must resolve to our fixture.
    expect(staticRoot()).toBe(staticFixtureRoot);

    mkdirSync(join(staticFixtureRoot, "assets"), { recursive: true });
    writeFileSync(join(staticFixtureRoot, "index.html"), "<!doctype html><title>dash</title>", "utf-8");
    writeFileSync(join(staticFixtureRoot, "assets", "app.js"), "console.error('x');", "utf-8");
    mkdirSync(join(staticFixtureRoot, "vault"), { recursive: true });
    writeFileSync(
      join(staticFixtureRoot, "vault", "index.html"),
      "<!doctype html><title>vault page</title>",
      "utf-8",
    );
    writeFileSync(
      join(staticFixtureRoot, "404.html"),
      "<!doctype html><title>not found</title>",
      "utf-8",
    );

    handle = createWebServer();
    await handle.listen(0);
    port = (handle.server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await handle.close();
    rmSync(staticFixtureRoot, { recursive: true, force: true });
    if (originalStaticRoot === undefined) delete process.env.DEV_WORKFLOW_STATIC_ROOT;
    else process.env.DEV_WORKFLOW_STATIC_ROOT = originalStaticRoot;
    if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalConfigHome;
    if (originalSocketPath === undefined) delete process.env.ENGRAM_SOCKET_PATH;
    else process.env.ENGRAM_SOCKET_PATH = originalSocketPath;
    rmSync(configHome, { recursive: true, force: true });
  });

  it("serves index.html at the root", async () => {
    const result = await httpRequest(port, "GET", "/");
    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toContain("text/html");
    expect(result.body).toContain("dash");
  });

  it("serves a JS asset with the JS content type", async () => {
    const result = await httpRequest(port, "GET", "/assets/app.js");
    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toContain("javascript");
  });

  it("serves a directory's index.html for a trailing-slash route", async () => {
    const result = await httpRequest(port, "GET", "/vault/");
    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toContain("text/html");
    expect(result.body).toContain("vault page");
  });

  it("serves a directory's index.html without a trailing slash", async () => {
    const result = await httpRequest(port, "GET", "/vault");
    expect(result.status).toBe(200);
    expect(result.body).toContain("vault page");
  });

  it("serves 404.html with status 404 for a genuine miss", async () => {
    const result = await httpRequest(port, "GET", "/projects/some/deep/route");
    expect(result.status).toBe(404);
    expect(result.body).toContain("not found");
  });

  it("rejects a traversal path with 400", async () => {
    const result = await httpRequest(port, "GET", "/%2e%2e%2f%2e%2e%2fetc%2fpasswd");
    expect(result.status).toBe(400);
  });

  it("rejects a non-GET method on a static path with 405", async () => {
    const result = await httpRequest(port, "POST", "/index.html");
    expect(result.status).toBe(405);
  });
});
