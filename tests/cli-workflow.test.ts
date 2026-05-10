import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runWorkflowCommand } from "../src/cli/workflow.js";

describe("runWorkflowCommand", () => {
  let logOutput: string[];
  let errOutput: string[];
  let origLog: typeof console.log;
  let origErr: typeof console.error;
  let projectRoot: string;
  let originalCwd: string;
  let originalSocket: string | undefined;

  beforeEach(() => {
    originalCwd = process.cwd();
    projectRoot = mkdtempSync(join(tmpdir(), "cli-workflow-test-"));
    execSync("git init", { cwd: projectRoot, stdio: "ignore" });
    mkdirSync(join(projectRoot, ".dev-vault", "workflows"), { recursive: true });
    process.chdir(projectRoot);

    originalSocket = process.env.ENGRAM_SOCKET_PATH;
    process.env.ENGRAM_SOCKET_PATH = "/tmp/no-such-engram-socket-isolated-test";

    logOutput = [];
    errOutput = [];
    origLog = console.log;
    origErr = console.error;
    console.log = ((msg: string) => {
      logOutput.push(String(msg));
      return true;
    }) as typeof console.log;
    console.error = ((msg: string) => {
      errOutput.push(String(msg));
      return true;
    }) as typeof console.error;

    process.exitCode = 0;
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origErr;
    process.chdir(originalCwd);
    rmSync(projectRoot, { recursive: true, force: true });
    if (originalSocket === undefined) {
      delete process.env.ENGRAM_SOCKET_PATH;
    } else {
      process.env.ENGRAM_SOCKET_PATH = originalSocket;
    }
    process.exitCode = 0;
  });

  function joinedLog(): string {
    return logOutput.join("\n");
  }
  function joinedErr(): string {
    return errOutput.join("\n");
  }

  describe("happy path", () => {
    it("show dev — renders workflow name and 11 steps", () => {
      runWorkflowCommand(["show", "dev"]);
      expect(process.exitCode).not.toBe(1);
      const out = joinedLog();
      expect(out).toContain("Workflow: dev");
      expect(out).toContain("Steps (11):");
    });

    it("graph dev — defaults to Mermaid (flowchart TD)", () => {
      runWorkflowCommand(["graph", "dev"]);
      expect(process.exitCode).not.toBe(1);
      expect(joinedLog()).toContain("flowchart TD");
    });

    it("graph dev --mermaid — emits Mermaid with onFail edge", () => {
      runWorkflowCommand(["graph", "dev", "--mermaid"]);
      expect(process.exitCode).not.toBe(1);
      const out = joinedLog();
      expect(out).toContain("flowchart TD");
      expect(out).toContain("-.->|onFail|");
    });

    it("graph dev --ascii — emits ASCII with Legend", () => {
      runWorkflowCommand(["graph", "dev", "--ascii"]);
      expect(process.exitCode).not.toBe(1);
      expect(joinedLog()).toContain("Legend:");
    });

    it("effective dev — renders resolved step file and effective config", () => {
      runWorkflowCommand(["effective", "dev"]);
      expect(process.exitCode).not.toBe(1);
      const out = joinedLog();
      expect(out).toContain("Resolved step file:");
      expect(out).toContain("Effective config:");
    });
  });

  describe("error cases", () => {
    it("no args — exits 1 with Usage line", () => {
      runWorkflowCommand([]);
      expect(process.exitCode).toBe(1);
      expect(joinedErr()).toContain("Usage: dev-workflow workflow");
    });

    it("show without name — exits 1 with workflow name required message", () => {
      runWorkflowCommand(["show"]);
      expect(process.exitCode).toBe(1);
      expect(joinedErr()).toContain("workflow name required");
    });

    it("show no-such-workflow — exits 1 with Unknown workflow + Available list", () => {
      runWorkflowCommand(["show", "no-such-workflow"]);
      expect(process.exitCode).toBe(1);
      const err = joinedErr();
      expect(err).toContain("Unknown workflow: no-such-workflow");
      expect(err).toContain("Available:");
    });

    it("unknown subcommand — exits 1 with Unknown subcommand message", () => {
      runWorkflowCommand(["unknown-subcmd", "dev"]);
      expect(process.exitCode).toBe(1);
      expect(joinedErr()).toContain("Unknown subcommand: unknown-subcmd");
    });

    it("exits with error when not in a git repository", () => {
      // Tear down the .git folder to simulate detectContext() returning null.
      rmSync(join(projectRoot, ".git"), { recursive: true, force: true });
      runWorkflowCommand(["show", "dev"]);
      expect(process.exitCode).toBe(1);
      expect(joinedErr()).toContain("Not a git repository");
    });
  });

  describe("show --bodies", () => {
    it("renders body separator and line-numbered content for builtin step", () => {
      runWorkflowCommand(["show", "dev", "--bodies"]);
      expect(process.exitCode).not.toBe(1);
      const out = joinedLog();
      expect(out).toContain("Step file bodies:");
      expect(out).toContain("▼ [");
      // Line numbers begin at 1 in body
      expect(out).toMatch(/\n\s*1 /);
    });
  });
});
