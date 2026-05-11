import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { serve } from "../src/cli/serve.js";

describe("serve CLI — E2E", () => {
  let projectRoot: string;
  let originalCwd: string;
  let stderrCaptured: string;
  let origStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    originalCwd = process.cwd();
    projectRoot = mkdtempSync(join(tmpdir(), "cli-serve-test-"));
    process.chdir(projectRoot);
    stderrCaptured = "";
    origStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrCaptured += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = origStderrWrite;
    process.chdir(originalCwd);
    rmSync(projectRoot, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it("not-in-git-repo: writes error to stderr + exitCode=1", () => {
    // projectRoot is fresh, no git init
    serve();
    expect(process.exitCode).toBe(1);
    expect(stderrCaptured).toContain("Not a git repository");
  });

  it("git repo present: wiring constructs handlers/server without throwing", () => {
    // Set up minimal git + package.json
    execFileSync("git", ["init", "-q"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: projectRoot });
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ name: "serve-test" }), "utf-8");

    // With stdin as TTY (default in tests), McpServer.start() prints
    // "expects piped input" + sets exitCode=1 without entering the
    // readline loop. This exercises the wiring without blocking on
    // an actual JSON-RPC session.
    serve();

    // We don't assert exitCode because TTY-ness varies by harness;
    // the key assertion is that wiring completes without throwing.
    // If wiring breaks (e.g. AgentRegistry can't find templates/agents/
    // or PACKAGE_ROOT resolves wrong), this test fails with an
    // uncaught exception.
    expect(true).toBe(true);
  });
});
