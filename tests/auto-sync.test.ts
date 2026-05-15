import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { syncBundledArtifacts } from "../src/lib/auto-sync.js";
import { LOCK_FILENAME, type LockState, LOCK_SCHEMA_VERSION } from "../src/lib/migration-lock.js";

describe("syncBundledArtifacts", () => {
  let projectRoot: string;
  let packageRoot: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: string | undefined;

  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), "auto-sync-test-"));
    projectRoot = join(base, "project");
    packageRoot = join(base, "package");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(packageRoot, { recursive: true });
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    originalEnv = process.env["DEV_WORKFLOW_AUTO_SYNC"];
    delete process.env["DEV_WORKFLOW_AUTO_SYNC"];
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    if (originalEnv === undefined) {
      delete process.env["DEV_WORKFLOW_AUTO_SYNC"];
    } else {
      process.env["DEV_WORKFLOW_AUTO_SYNC"] = originalEnv;
    }
    rmSync(join(projectRoot, ".."), { recursive: true, force: true });
  });

  function writeTemplate(kind: string, rel: string, content: string): void {
    const full = join(packageRoot, "templates", "claude", kind, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }

  function writeTarget(kind: string, rel: string, content: string): void {
    const full = join(projectRoot, ".claude", kind, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }

  function targetPath(kind: string, rel: string): string {
    return join(projectRoot, ".claude", kind, rel);
  }

  function writeLockFile(state: Partial<LockState>): void {
    const full = join(projectRoot, ".claude", LOCK_FILENAME);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(
      full,
      JSON.stringify(
        { version: LOCK_SCHEMA_VERSION, updated_at: new Date().toISOString(), ...state },
        null,
        2,
      ),
      "utf-8",
    );
  }

  function readLockFile(): LockState {
    const full = join(projectRoot, ".claude", LOCK_FILENAME);
    return JSON.parse(readFileSync(full, "utf-8")) as LockState;
  }

  it("walks fully and reports zero changes when every target is byte-identical", () => {
    writeTemplate("skills", "alpha/SKILL.md", "# alpha\n");
    writeTemplate("agents", "beta.md", "# beta\n");
    writeTarget("skills", "alpha/SKILL.md", "# alpha\n");
    writeTarget("agents", "beta.md", "# beta\n");

    const result = syncBundledArtifacts(projectRoot, packageRoot);

    expect(result.synced).toBe(0);
    expect(result.preserved).toBe(0);
    expect(result.skipped).toBe(0);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("overwrites a drifted target when the lock records a prior sync version", () => {
    writeTemplate("skills", "alpha/SKILL.md", "# alpha — bundled\n");
    writeTarget("skills", "alpha/SKILL.md", "# alpha — stale\n");
    writeLockFile({ last_sync_version: "0.0.0-test" });

    const result = syncBundledArtifacts(projectRoot, packageRoot);

    expect(result.synced).toBe(1);
    expect(result.preserved).toBe(0);
    expect(readFileSync(targetPath("skills", "alpha/SKILL.md"), "utf-8")).toBe(
      "# alpha — bundled\n",
    );
  });

  it("preserves a user-modified target and emits a stderr notice when no prior sync recorded", () => {
    writeTemplate("skills", "alpha/SKILL.md", "# alpha — bundled\n");
    writeTarget("skills", "alpha/SKILL.md", "# alpha — user-edited\n");
    writeLockFile({ skills_version: "1.0.0" });

    const result = syncBundledArtifacts(projectRoot, packageRoot);

    expect(result.synced).toBe(0);
    expect(result.preserved).toBe(1);
    expect(readFileSync(targetPath("skills", "alpha/SKILL.md"), "utf-8")).toBe(
      "# alpha — user-edited\n",
    );
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const msg = String(stderrSpy.mock.calls[0]![0]);
    expect(msg).toContain("note: skipping user-modified skills");
    expect(msg).toContain("alpha/SKILL.md");
  });

  it("skips the sync entirely when DEV_WORKFLOW_AUTO_SYNC=0", () => {
    process.env["DEV_WORKFLOW_AUTO_SYNC"] = "0";
    writeTemplate("skills", "alpha/SKILL.md", "# alpha — bundled\n");
    writeTarget("skills", "alpha/SKILL.md", "# alpha — stale\n");

    const result = syncBundledArtifacts(projectRoot, packageRoot);

    expect(result.skipped).toBe(1);
    expect(result.synced).toBe(0);
    expect(result.preserved).toBe(0);
    expect(readFileSync(targetPath("skills", "alpha/SKILL.md"), "utf-8")).toBe(
      "# alpha — stale\n",
    );
  });

  it("skips the sync entirely when the lock sets auto_sync to false", () => {
    writeTemplate("skills", "alpha/SKILL.md", "# alpha — bundled\n");
    writeTarget("skills", "alpha/SKILL.md", "# alpha — stale\n");
    writeLockFile({ auto_sync: false });

    const result = syncBundledArtifacts(projectRoot, packageRoot);

    expect(result.skipped).toBe(1);
    expect(readFileSync(targetPath("skills", "alpha/SKILL.md"), "utf-8")).toBe(
      "# alpha — stale\n",
    );
  });

  it("preserves a drifted target when no lock file exists at all", () => {
    writeTemplate("skills", "alpha/SKILL.md", "# alpha — bundled\n");
    writeTarget("skills", "alpha/SKILL.md", "# alpha — user-edited\n");

    const result = syncBundledArtifacts(projectRoot, packageRoot);

    expect(result.preserved).toBe(1);
    expect(result.synced).toBe(0);
    expect(readFileSync(targetPath("skills", "alpha/SKILL.md"), "utf-8")).toBe(
      "# alpha — user-edited\n",
    );
  });

  it("re-merges the hooks block when settings.json is present", () => {
    writeTemplate("skills", "alpha/SKILL.md", "# alpha\n");
    writeTarget("skills", "alpha/SKILL.md", "# alpha\n");
    const settingsPath = join(projectRoot, ".claude", "settings.json");
    mkdirSync(join(settingsPath, ".."), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({ hooks: {}, customUserKey: "keep-me" }, null, 2),
      "utf-8",
    );

    syncBundledArtifacts(projectRoot, packageRoot);

    const merged = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
    expect(merged["customUserKey"]).toBe("keep-me");
    const hooks = merged["hooks"] as Record<string, unknown[]>;
    expect(Array.isArray(hooks["SessionStart"])).toBe(true);
    expect(hooks["SessionStart"]!.length).toBeGreaterThan(0);
  });

  it("restores a hand-deleted target file even when the lock records the current version", () => {
    writeTemplate("skills", "alpha/SKILL.md", "# alpha — bundled\n");
    writeLockFile({ last_sync_version: "0.0.0-test" });
    // Target file was hand-deleted by the user; only the template exists.
    expect(existsSync(targetPath("skills", "alpha/SKILL.md"))).toBe(false);

    const result = syncBundledArtifacts(projectRoot, packageRoot);

    expect(result.synced).toBe(1);
    expect(existsSync(targetPath("skills", "alpha/SKILL.md"))).toBe(true);
    expect(readFileSync(targetPath("skills", "alpha/SKILL.md"), "utf-8")).toBe(
      "# alpha — bundled\n",
    );
  });

  it("records last_sync_version and last_sync_at in the lock after a sync", () => {
    writeTemplate("skills", "alpha/SKILL.md", "# alpha\n");
    writeTarget("skills", "alpha/SKILL.md", "# alpha\n");

    const result = syncBundledArtifacts(projectRoot, packageRoot);

    const lock = readLockFile();
    expect(lock.last_sync_version).toBe(result.lastSyncVersion);
    expect(typeof lock.last_sync_at).toBe("string");
    expect(new Date(lock.last_sync_at!).getTime()).toBeGreaterThan(0);
  });

  it("skips the sync entirely when options.forceSkip is true, leaving a drifted target untouched", () => {
    writeTemplate("skills", "alpha/SKILL.md", "# alpha — bundled\n");
    writeTarget("skills", "alpha/SKILL.md", "# alpha — stale\n");

    const result = syncBundledArtifacts(projectRoot, packageRoot, { forceSkip: true });

    expect(result.skipped).toBe(1);
    expect(result.synced).toBe(0);
    expect(result.preserved).toBe(0);
    expect(readFileSync(targetPath("skills", "alpha/SKILL.md"), "utf-8")).toBe(
      "# alpha — stale\n",
    );
  });

  it("overwrites drifted skills AND agents files in one run when the lock records a prior sync", () => {
    writeTemplate("skills", "alpha/SKILL.md", "# alpha — bundled\n");
    writeTemplate("agents", "beta.md", "# beta — bundled\n");
    writeTarget("skills", "alpha/SKILL.md", "# alpha — stale\n");
    writeTarget("agents", "beta.md", "# beta — stale\n");
    writeLockFile({ last_sync_version: "0.0.0-test" });

    const result = syncBundledArtifacts(projectRoot, packageRoot);

    expect(result.synced).toBe(2);
    expect(result.preserved).toBe(0);
    expect(readFileSync(targetPath("skills", "alpha/SKILL.md"), "utf-8")).toBe(
      "# alpha — bundled\n",
    );
    expect(readFileSync(targetPath("agents", "beta.md"), "utf-8")).toBe(
      "# beta — bundled\n",
    );
  });

  it("emits a stderr notice naming agents when a drifted agents file has no prior sync", () => {
    writeTemplate("agents", "beta.md", "# beta — bundled\n");
    writeTarget("agents", "beta.md", "# beta — user-edited\n");
    writeLockFile({ agents_version: "1.0.0" });

    const result = syncBundledArtifacts(projectRoot, packageRoot);

    expect(result.preserved).toBe(1);
    expect(result.synced).toBe(0);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const msg = String(stderrSpy.mock.calls[0]![0]);
    expect(msg).toContain("note: skipping user-modified agents");
    expect(msg).toContain("beta.md");
  });

  it("does not create settings.json when none exists", () => {
    writeTemplate("skills", "alpha/SKILL.md", "# alpha\n");
    writeTarget("skills", "alpha/SKILL.md", "# alpha\n");
    const settingsPath = join(projectRoot, ".claude", "settings.json");

    expect(() => syncBundledArtifacts(projectRoot, packageRoot)).not.toThrow();

    expect(existsSync(settingsPath)).toBe(false);
  });

  it("succeeds with a skills template when the agents template dir is absent entirely", () => {
    writeTemplate("skills", "alpha/SKILL.md", "# alpha\n");
    // No agents template dir written at all.

    let result!: ReturnType<typeof syncBundledArtifacts>;
    expect(() => {
      result = syncBundledArtifacts(projectRoot, packageRoot);
    }).not.toThrow();

    expect(result.synced).toBe(1);
    expect(result.preserved).toBe(0);
    expect(existsSync(targetPath("skills", "alpha/SKILL.md"))).toBe(true);
  });
});
