import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runVaultCommand } from "../src/cli/vault.js";

describe("runVaultCommand", () => {
  let logOutput: string[];
  let errOutput: string[];
  let origLog: typeof console.log;
  let origErr: typeof console.error;
  let projectRoot: string;
  let originalCwd: string;
  let originalSocket: string | undefined;

  beforeEach(() => {
    originalCwd = process.cwd();
    projectRoot = mkdtempSync(join(tmpdir(), "cli-vault-diff-test-"));
    execSync("git init", { cwd: projectRoot, stdio: "ignore" });
    mkdirSync(join(projectRoot, ".dev-vault"), { recursive: true });
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

  function writeSpec(content: string, name = "SPEC.md"): void {
    writeFileSync(join(projectRoot, name), content);
  }

  function writeVault(filename: string, content: string): void {
    writeFileSync(join(projectRoot, ".dev-vault", filename), content);
  }

  describe("happy path", () => {
    it("diff with matching SPEC and vault — exit 0, 'All sections match'", () => {
      writeSpec("# Stack\n- TypeScript 5.4\n\n# Gameplan\n- phase 1\n");
      writeVault("stack.md", "# Stack\n- TypeScript 5.4\n");
      writeVault("gameplan.md", "# Gameplan\n- phase 1\n");
      runVaultCommand(["diff"]);
      expect(process.exitCode).toBe(0);
      expect(joinedLog()).toContain("All sections match");
    });

    it("diff with drift in stack section — exit 1, contains 'DRIFT'", () => {
      writeSpec("# Stack\n- TypeScript 5.4\n- Bun\n");
      writeVault("stack.md", "# Stack\n- TypeScript 5.4\n");
      runVaultCommand(["diff"]);
      expect(process.exitCode).toBe(1);
      const out = joinedLog();
      expect(out).toContain("stack");
      expect(out).toContain("DRIFT");
    });

    it("diff with custom spec path argument", () => {
      writeSpec("# Stack\n- TS\n", "custom.md");
      writeVault("stack.md", "# Stack\n- TS\n");
      runVaultCommand(["diff", "custom.md"]);
      expect(process.exitCode).toBe(0);
      expect(joinedLog()).toContain("SPEC drift report: custom.md");
    });
  });

  describe("error cases", () => {
    it("no args — exit 1 with Usage line", () => {
      runVaultCommand([]);
      expect(process.exitCode).toBe(1);
      expect(joinedErr()).toContain("Usage: dev-workflow vault");
    });

    it("unknown subcommand — exit 1 with 'Unknown subcommand'", () => {
      runVaultCommand(["bogus"]);
      expect(process.exitCode).toBe(1);
      expect(joinedErr()).toContain("Unknown subcommand: bogus");
    });

    it("diff without SPEC.md — exit 1 with 'SPEC.md not found'", () => {
      runVaultCommand(["diff"]);
      expect(process.exitCode).toBe(1);
      expect(joinedErr()).toContain("SPEC.md not found");
    });

    it("diff without .dev-vault directory — exit 1 with 'Vault not initialized'", () => {
      writeSpec("# Stack\n- TS\n");
      rmSync(join(projectRoot, ".dev-vault"), { recursive: true, force: true });
      runVaultCommand(["diff"]);
      expect(process.exitCode).toBe(1);
      expect(joinedErr()).toContain("Vault not initialized");
    });

    it("diff outside git repository — exit 1 with 'Not a git repository'", () => {
      rmSync(join(projectRoot, ".git"), { recursive: true, force: true });
      runVaultCommand(["diff"]);
      expect(process.exitCode).toBe(1);
      expect(joinedErr()).toContain("Not a git repository");
    });

    it("rejects path traversal in spec argument", () => {
      writeSpec("# Stack\n- TS\n");
      runVaultCommand(["diff", "../../etc/passwd"]);
      expect(process.exitCode).toBe(1);
      expect(joinedErr()).toMatch(/path traversal|not allowed/i);
    });
  });
});
