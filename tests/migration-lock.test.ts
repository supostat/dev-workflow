import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  LOCK_FILENAME,
  LOCK_SCHEMA_VERSION,
  clearLockField,
  getPackageVersion,
  readLock,
  writeLock,
} from "../src/lib/migration-lock.js";

describe("migration-lock", () => {
  let projectRoot: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "migration-lock-test-"));
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function lockFilePath(): string {
    return join(projectRoot, ".claude", LOCK_FILENAME);
  }

  describe("getPackageVersion", () => {
    it("returns a non-empty semver-shaped string from package.json", () => {
      const version = getPackageVersion();
      expect(typeof version).toBe("string");
      expect(version.length).toBeGreaterThan(0);
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe("readLock", () => {
    it("returns null when lock file does not exist (no warning)", () => {
      const result = readLock(projectRoot);
      expect(result).toBeNull();
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it("returns LockState when valid lock exists", () => {
      mkdirSync(join(projectRoot, ".claude"), { recursive: true });
      writeFileSync(
        lockFilePath(),
        JSON.stringify({
          version: 1,
          commands_version: "1.2.3",
          skills_version: "1.2.3",
          updated_at: "2026-05-14T08:00:00.000Z",
        }, null, 2),
        "utf-8",
      );

      const result = readLock(projectRoot);
      expect(result).not.toBeNull();
      expect(result?.version).toBe(1);
      expect(result?.commands_version).toBe("1.2.3");
      expect(result?.skills_version).toBe("1.2.3");
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it("returns null AND emits stderr warning on malformed JSON", () => {
      mkdirSync(join(projectRoot, ".claude"), { recursive: true });
      writeFileSync(lockFilePath(), "{ not valid json", "utf-8");

      const result = readLock(projectRoot);
      expect(result).toBeNull();
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const message = String(stderrSpy.mock.calls[0]![0]);
      expect(message).toContain("note: failed to read .dev-workflow.lock");
    });

    it("returns null AND emits stderr warning on missing required fields", () => {
      mkdirSync(join(projectRoot, ".claude"), { recursive: true });
      writeFileSync(
        lockFilePath(),
        JSON.stringify({ commands_version: "1.0.0" }),
        "utf-8",
      );

      const result = readLock(projectRoot);
      expect(result).toBeNull();
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(String(stderrSpy.mock.calls[0]![0])).toContain("missing required fields");
    });
  });

  describe("writeLock", () => {
    it("creates .claude/ directory if missing and writes a fresh lock", () => {
      writeLock(projectRoot, {
        commands_version: "1.0.0",
        agents_version: "1.0.0",
        skills_version: "1.0.0",
      });

      expect(existsSync(lockFilePath())).toBe(true);
      const parsed = JSON.parse(readFileSync(lockFilePath(), "utf-8")) as Record<string, unknown>;
      expect(parsed["version"]).toBe(LOCK_SCHEMA_VERSION);
      expect(parsed["commands_version"]).toBe("1.0.0");
      expect(parsed["agents_version"]).toBe("1.0.0");
      expect(parsed["skills_version"]).toBe("1.0.0");
      expect(typeof parsed["updated_at"]).toBe("string");
      expect(new Date(parsed["updated_at"] as string).getTime()).toBeGreaterThan(0);
    });

    it("merges partial bump with existing lock — preserves untouched fields", () => {
      mkdirSync(join(projectRoot, ".claude"), { recursive: true });
      writeFileSync(
        lockFilePath(),
        JSON.stringify({
          version: 1,
          commands_version: "1.0.0",
          agents_version: "1.0.0",
          skills_version: "1.0.0",
          updated_at: "2026-01-01T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );

      writeLock(projectRoot, { skills_version: "2.0.0" });

      const parsed = readLock(projectRoot)!;
      expect(parsed.skills_version).toBe("2.0.0");
      expect(parsed.commands_version).toBe("1.0.0");
      expect(parsed.agents_version).toBe("1.0.0");
      expect(new Date(parsed.updated_at).getTime()).toBeGreaterThan(
        new Date("2026-01-01T00:00:00.000Z").getTime(),
      );
    });

    it("rebuilds from clean slate when existing lock is malformed", () => {
      mkdirSync(join(projectRoot, ".claude"), { recursive: true });
      writeFileSync(lockFilePath(), "garbage not json", "utf-8");

      writeLock(projectRoot, { commands_version: "1.0.0" });

      const parsed = readLock(projectRoot)!;
      expect(parsed.commands_version).toBe("1.0.0");
      expect(parsed.agents_version).toBeUndefined();
      expect(parsed.skills_version).toBeUndefined();
      // Malformed-read happens inside writeLock (which calls readLock) — warning emitted once.
      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });

    it("normalises version to LOCK_SCHEMA_VERSION even if existing lock has a different value", () => {
      mkdirSync(join(projectRoot, ".claude"), { recursive: true });
      writeFileSync(
        lockFilePath(),
        JSON.stringify({
          version: 99,
          commands_version: "1.0.0",
          updated_at: "2026-01-01T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );

      writeLock(projectRoot, { commands_version: "1.0.0" });

      const parsed = readLock(projectRoot)!;
      expect(parsed.version).toBe(LOCK_SCHEMA_VERSION);
    });

    it("refreshes updated_at on every write", async () => {
      writeLock(projectRoot, { commands_version: "1.0.0" });
      const first = readLock(projectRoot)!.updated_at;

      // Wait a tick so timestamps differ at millisecond precision.
      await new Promise((resolve) => setTimeout(resolve, 5));

      writeLock(projectRoot, { commands_version: "1.0.0" });
      const second = readLock(projectRoot)!.updated_at;

      expect(second).not.toBe(first);
      expect(new Date(second).getTime()).toBeGreaterThan(new Date(first).getTime());
    });
  });

  describe("clearLockField", () => {
    it("preserves last_sync_version / last_sync_at / auto_sync when clearing commands_version", () => {
      mkdirSync(join(projectRoot, ".claude"), { recursive: true });
      writeFileSync(
        lockFilePath(),
        JSON.stringify({
          version: 1,
          commands_version: "1.0.0",
          agents_version: "1.0.0",
          skills_version: "1.0.0",
          last_sync_version: "2.0.0",
          last_sync_at: "2026-05-14T08:00:00.000Z",
          auto_sync: false,
          updated_at: "2026-01-01T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );

      clearLockField(projectRoot, "commands_version");

      const parsed = readLock(projectRoot)!;
      expect(parsed.last_sync_version).toBe("2.0.0");
      expect(parsed.last_sync_at).toBe("2026-05-14T08:00:00.000Z");
      expect(parsed.auto_sync).toBe(false);
      expect(parsed.agents_version).toBe("1.0.0");
      expect(parsed.skills_version).toBe("1.0.0");
    });

    it("clears the targeted field so it becomes undefined", () => {
      mkdirSync(join(projectRoot, ".claude"), { recursive: true });
      writeFileSync(
        lockFilePath(),
        JSON.stringify({
          version: 1,
          commands_version: "1.0.0",
          agents_version: "1.0.0",
          skills_version: "1.0.0",
          updated_at: "2026-01-01T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );

      clearLockField(projectRoot, "commands_version");

      const parsed = readLock(projectRoot)!;
      expect(parsed.commands_version).toBeUndefined();
      expect(parsed.agents_version).toBe("1.0.0");
      expect(parsed.skills_version).toBe("1.0.0");
    });
  });
});
