import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { update } from "../src/cli/update.js";
import { LOCK_FILENAME, LOCK_SCHEMA_VERSION, getPackageVersion } from "../src/lib/migration-lock.js";

interface LockInput {
  version?: number;
  commands_version?: string;
  agents_version?: string;
  skills_version?: string;
  updated_at?: string;
}

function writeLockFile(projectRoot: string, lock: LockInput): void {
  const lockPath = join(projectRoot, ".claude", LOCK_FILENAME);
  mkdirSync(join(projectRoot, ".claude"), { recursive: true });
  const body = {
    version: lock.version ?? LOCK_SCHEMA_VERSION,
    commands_version: lock.commands_version,
    agents_version: lock.agents_version,
    skills_version: lock.skills_version,
    updated_at: lock.updated_at ?? new Date().toISOString(),
  };
  writeFileSync(lockPath, JSON.stringify(body, null, 2) + "\n", "utf-8");
}

function setupProject(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "cli-update-"));
  execSync("git init -q", { cwd: projectRoot });
  mkdirSync(join(projectRoot, ".dev-vault"), { recursive: true });
  return projectRoot;
}

describe("dev-workflow update — legacy commands cleanup (task-042)", () => {
  let projectRoot: string;
  let cwdOrig: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    projectRoot = setupProject();
    cwdOrig = process.cwd();
    process.chdir(projectRoot);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    process.chdir(cwdOrig);
    logSpy.mockRestore();
    errSpy.mockRestore();
    stderrSpy.mockRestore();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("default mode: detection notice emitted when lock has commands_version + commands/ exists", () => {
    writeLockFile(projectRoot, { commands_version: "1.2.0" });
    mkdirSync(join(projectRoot, ".claude", "commands"), { recursive: true });
    writeFileSync(join(projectRoot, ".claude", "commands", "dummy.md"), "stub");

    update();

    const stderrCalls = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrCalls).toContain("legacy .claude/commands/ detected");
    expect(stderrCalls).toContain("commands_version=1.2.0");
    expect(stderrCalls).toContain("--cleanup-legacy-commands");
    expect(existsSync(join(projectRoot, ".claude", "commands"))).toBe(true);
  });

  it("default mode: no notice when commands_version absent from lock", () => {
    writeLockFile(projectRoot, { agents_version: "1.2.0" });
    mkdirSync(join(projectRoot, ".claude", "commands"), { recursive: true });

    update();

    const stderrCalls = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrCalls).not.toContain("legacy .claude/commands/ detected");
  });

  it("default mode: no notice when commands/ directory absent", () => {
    writeLockFile(projectRoot, { commands_version: "1.2.0" });

    update();

    const stderrCalls = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrCalls).not.toContain("legacy .claude/commands/ detected");
  });

  it("--cleanup-legacy-commands: renames directory to backup path and clears lock field", () => {
    writeLockFile(projectRoot, { commands_version: "1.2.0", agents_version: "1.2.0" });
    mkdirSync(join(projectRoot, ".claude", "commands"), { recursive: true });
    writeFileSync(join(projectRoot, ".claude", "commands", "marker.md"), "user content");

    update({ cleanupLegacyCommands: true });

    expect(existsSync(join(projectRoot, ".claude", "commands"))).toBe(false);
    const claudeDir = join(projectRoot, ".claude");
    const entries = execSync(`ls ${claudeDir}`, { encoding: "utf-8" }).split("\n");
    const backupEntry = entries.find((e) => e.startsWith("commands.legacy-bak-"));
    expect(backupEntry, "backup dir should be created").toBeDefined();
    expect(existsSync(join(claudeDir, backupEntry!, "marker.md"))).toBe(true);

    const lock = JSON.parse(readFileSync(join(claudeDir, LOCK_FILENAME), "utf-8")) as Record<string, unknown>;
    expect(lock["commands_version"]).toBeUndefined();
    expect(lock["agents_version"]).toBe(getPackageVersion());
  });

  it("--cleanup-legacy-commands: backup path timestamp matches ISO format without colons", () => {
    writeLockFile(projectRoot, { commands_version: "1.2.0" });
    mkdirSync(join(projectRoot, ".claude", "commands"), { recursive: true });

    update({ cleanupLegacyCommands: true });

    const entries = execSync(`ls ${join(projectRoot, ".claude")}`, { encoding: "utf-8" }).split("\n");
    const backupEntry = entries.find((e) => e.startsWith("commands.legacy-bak-"));
    expect(backupEntry).toMatch(/^commands\.legacy-bak-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/);
  });

  it("--no-interactive without --cleanup: suppresses detection notice silently", () => {
    writeLockFile(projectRoot, { commands_version: "1.2.0" });
    mkdirSync(join(projectRoot, ".claude", "commands"), { recursive: true });

    update({ noInteractive: true });

    const stderrCalls = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrCalls).not.toContain("legacy .claude/commands/ detected");
    expect(existsSync(join(projectRoot, ".claude", "commands"))).toBe(true);
  });

  it("--no-interactive --cleanup-legacy-commands: performs cleanup with minimal output", () => {
    writeLockFile(projectRoot, { commands_version: "1.2.0" });
    mkdirSync(join(projectRoot, ".claude", "commands"), { recursive: true });

    update({ noInteractive: true, cleanupLegacyCommands: true });

    expect(existsSync(join(projectRoot, ".claude", "commands"))).toBe(false);
    const entries = execSync(`ls ${join(projectRoot, ".claude")}`, { encoding: "utf-8" }).split("\n");
    expect(entries.some((e) => e.startsWith("commands.legacy-bak-"))).toBe(true);
  });

  it("--cleanup-legacy-commands: no-op when no legacy state detected", () => {
    writeLockFile(projectRoot, { agents_version: "1.2.0" });

    update({ cleanupLegacyCommands: true });

    const entries = execSync(`ls ${join(projectRoot, ".claude")}`, { encoding: "utf-8" }).split("\n");
    expect(entries.some((e) => e.startsWith("commands.legacy-bak-"))).toBe(false);
    const lock = JSON.parse(readFileSync(join(projectRoot, ".claude", LOCK_FILENAME), "utf-8")) as Record<string, unknown>;
    expect(lock["agents_version"]).toBe(getPackageVersion());
  });

  it("--cleanup-legacy-commands: emits success line via console.log", () => {
    writeLockFile(projectRoot, { commands_version: "1.2.0" });
    mkdirSync(join(projectRoot, ".claude", "commands"), { recursive: true });

    update({ cleanupLegacyCommands: true });

    const logCalls = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logCalls).toMatch(/legacy commands.+moved to.+commands\.legacy-bak-/);
    expect(logCalls).toMatch(/commands_version cleared/);
  });
});
