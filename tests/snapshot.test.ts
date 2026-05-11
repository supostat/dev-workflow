import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createSnapshot, listSnapshots, loadSnapshotMeta, deleteSnapshot,
  rollbackSnapshot, validateSnapshotName,
  SNAPSHOTS_DIRNAME, MANIFEST_FILENAME, DEFAULT_EXCLUDED,
} from "../src/lib/snapshot.js";

describe("snapshot lib", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "snapshot-lib-test-"));
    // Seed minimal vault
    writeFileSync(join(vaultPath, "stack.md"), "# Stack\n\nNode.js\n", "utf-8");
    writeFileSync(join(vaultPath, "knowledge.md"), "# Knowledge\n", "utf-8");
    mkdirSync(join(vaultPath, "architecture"), { recursive: true });
    writeFileSync(join(vaultPath, "architecture", "adr-001.md"), "ADR\n", "utf-8");
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  // ── validateSnapshotName ──────────────────────────────────────────────────

  it("validateSnapshotName accepts alphanumeric + dash/dot/underscore", () => {
    expect(() => validateSnapshotName("snap-2026-05-11")).not.toThrow();
    expect(() => validateSnapshotName("v1.0.0-baseline")).not.toThrow();
    expect(() => validateSnapshotName("my_backup")).not.toThrow();
    expect(() => validateSnapshotName("a")).not.toThrow();
  });

  it("validateSnapshotName rejects path separators (traversal guard)", () => {
    expect(() => validateSnapshotName("../etc/passwd")).toThrow(/Invalid snapshot name/);
    expect(() => validateSnapshotName("foo/bar")).toThrow(/Invalid snapshot name/);
    expect(() => validateSnapshotName("/absolute")).toThrow(/Invalid snapshot name/);
  });

  it("validateSnapshotName rejects empty / too long / special chars", () => {
    expect(() => validateSnapshotName("")).toThrow(/Invalid snapshot name/);
    expect(() => validateSnapshotName("x".repeat(81))).toThrow(/Invalid snapshot name/);
    expect(() => validateSnapshotName("name with spaces")).toThrow(/Invalid snapshot name/);
    expect(() => validateSnapshotName("a*b")).toThrow(/Invalid snapshot name/);
  });

  // ── createSnapshot ────────────────────────────────────────────────────────

  it("createSnapshot copies all vault files under <vault>/snapshots/<name>", () => {
    const { path, manifest } = createSnapshot(vaultPath, {
      name: "test1", projectName: "demo", branch: "main",
    });
    expect(existsSync(path)).toBe(true);
    expect(existsSync(join(path, "stack.md"))).toBe(true);
    expect(existsSync(join(path, "knowledge.md"))).toBe(true);
    expect(existsSync(join(path, "architecture", "adr-001.md"))).toBe(true);
    expect(manifest.name).toBe("test1");
    expect(manifest.fileCount).toBe(3);
    expect(manifest.totalBytes).toBeGreaterThan(0);
    expect(manifest.projectName).toBe("demo");
    expect(manifest.branch).toBe("main");
  });

  it("createSnapshot writes manifest.json into the snapshot directory", () => {
    const { path } = createSnapshot(vaultPath, {
      name: "test2", projectName: "demo", branch: "main",
    });
    const manifestPath = join(path, MANIFEST_FILENAME);
    expect(existsSync(manifestPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(parsed.name).toBe("test2");
    expect(parsed.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("createSnapshot excludes .edit-log.json and .profile-state", () => {
    writeFileSync(join(vaultPath, ".edit-log.json"), "log data", "utf-8");
    writeFileSync(join(vaultPath, ".profile-state"), "onboarding", "utf-8");
    const { path } = createSnapshot(vaultPath, {
      name: "test3", projectName: "demo", branch: "main",
    });
    expect(existsSync(join(path, ".edit-log.json"))).toBe(false);
    expect(existsSync(join(path, ".profile-state"))).toBe(false);
  });

  it("createSnapshot excludes engram-trace.jsonl files (regenerable)", () => {
    mkdirSync(join(vaultPath, "workflow-state", "runs"), { recursive: true });
    writeFileSync(join(vaultPath, "workflow-state", "runs", "run-x.engram-trace.jsonl"),
      '{"ts":"x","method":"y"}\n', "utf-8");
    writeFileSync(join(vaultPath, "workflow-state", "runs", "run-x.json"),
      '{"id":"run-x"}', "utf-8");
    const { path } = createSnapshot(vaultPath, {
      name: "test4", projectName: "demo", branch: "main",
    });
    // .json copied
    expect(existsSync(join(path, "workflow-state", "runs", "run-x.json"))).toBe(true);
    // .engram-trace.jsonl skipped
    expect(existsSync(join(path, "workflow-state", "runs", "run-x.engram-trace.jsonl"))).toBe(false);
  });

  it("createSnapshot excludes existing snapshots/ (no recursive growth)", () => {
    // First snapshot
    createSnapshot(vaultPath, { name: "first", projectName: "demo", branch: "main" });
    // Add another vault file
    writeFileSync(join(vaultPath, "conventions.md"), "# Conv\n", "utf-8");
    // Second snapshot — should NOT include the first
    const { path } = createSnapshot(vaultPath, { name: "second", projectName: "demo", branch: "main" });
    expect(existsSync(join(path, "snapshots"))).toBe(false);
    expect(existsSync(join(path, "stack.md"))).toBe(true);
    expect(existsSync(join(path, "conventions.md"))).toBe(true);
  });

  it("createSnapshot uses default name when not provided", () => {
    const { manifest } = createSnapshot(vaultPath, { projectName: "demo", branch: "main" });
    expect(manifest.name).toMatch(/^snap-\d{4}-\d{2}-\d{2}T/);
  });

  it("createSnapshot throws if snapshot with same name already exists", () => {
    createSnapshot(vaultPath, { name: "dup", projectName: "demo", branch: "main" });
    expect(() => createSnapshot(vaultPath, { name: "dup", projectName: "demo", branch: "main" }))
      .toThrow(/already exists/);
  });

  it("createSnapshot throws on missing vault", () => {
    rmSync(vaultPath, { recursive: true });
    expect(() => createSnapshot(vaultPath, { name: "x", projectName: "demo", branch: "main" }))
      .toThrow(/Vault does not exist/);
    // restore for afterEach
    mkdirSync(vaultPath, { recursive: true });
  });

  it("DEFAULT_EXCLUDED set contains expected entries", () => {
    expect(DEFAULT_EXCLUDED.has(SNAPSHOTS_DIRNAME)).toBe(true);
    expect(DEFAULT_EXCLUDED.has(".edit-log.json")).toBe(true);
    expect(DEFAULT_EXCLUDED.has(".profile-state")).toBe(true);
  });

  // ── listSnapshots ─────────────────────────────────────────────────────────

  it("listSnapshots returns empty array when no snapshots dir", () => {
    expect(listSnapshots(vaultPath)).toEqual([]);
  });

  it("listSnapshots returns all snapshots, newest first by createdAt", async () => {
    createSnapshot(vaultPath, { name: "alpha", projectName: "demo", branch: "main" });
    // Sleep tiny bit so timestamps differ
    await new Promise((r) => setTimeout(r, 10));
    createSnapshot(vaultPath, { name: "beta", projectName: "demo", branch: "main" });
    const list = listSnapshots(vaultPath);
    expect(list.length).toBe(2);
    // newest first
    expect(list[0]!.name).toBe("beta");
    expect(list[1]!.name).toBe("alpha");
  });

  it("listSnapshots ignores directories without manifest.json", () => {
    mkdirSync(join(vaultPath, SNAPSHOTS_DIRNAME, "orphan"), { recursive: true });
    writeFileSync(join(vaultPath, SNAPSHOTS_DIRNAME, "orphan", "stuff.txt"), "data", "utf-8");
    createSnapshot(vaultPath, { name: "valid", projectName: "demo", branch: "main" });
    const list = listSnapshots(vaultPath);
    expect(list.length).toBe(1);
    expect(list[0]!.name).toBe("valid");
  });

  it("listSnapshots ignores corrupt manifest.json (safe-fail)", () => {
    mkdirSync(join(vaultPath, SNAPSHOTS_DIRNAME, "broken"), { recursive: true });
    writeFileSync(join(vaultPath, SNAPSHOTS_DIRNAME, "broken", MANIFEST_FILENAME),
      "not json {{{", "utf-8");
    createSnapshot(vaultPath, { name: "ok", projectName: "demo", branch: "main" });
    const list = listSnapshots(vaultPath);
    expect(list.length).toBe(1);
    expect(list[0]!.name).toBe("ok");
  });

  // ── loadSnapshotMeta ──────────────────────────────────────────────────────

  it("loadSnapshotMeta returns manifest for existing snapshot", () => {
    createSnapshot(vaultPath, { name: "meta-test", projectName: "demo", branch: "main" });
    const meta = loadSnapshotMeta(vaultPath, "meta-test");
    expect(meta.name).toBe("meta-test");
    expect(meta.projectName).toBe("demo");
    expect(meta.branch).toBe("main");
  });

  it("loadSnapshotMeta throws if snapshot missing", () => {
    expect(() => loadSnapshotMeta(vaultPath, "nonexistent")).toThrow(/not found/);
  });

  it("loadSnapshotMeta validates name (rejects ../)", () => {
    expect(() => loadSnapshotMeta(vaultPath, "../escape")).toThrow(/Invalid snapshot name/);
  });

  // ── deleteSnapshot ────────────────────────────────────────────────────────

  it("deleteSnapshot removes the snapshot directory", () => {
    const { path } = createSnapshot(vaultPath, { name: "to-del", projectName: "demo", branch: "main" });
    expect(existsSync(path)).toBe(true);
    deleteSnapshot(vaultPath, "to-del");
    expect(existsSync(path)).toBe(false);
  });

  it("deleteSnapshot throws if snapshot does not exist", () => {
    expect(() => deleteSnapshot(vaultPath, "phantom")).toThrow(/not found/);
  });

  it("deleteSnapshot validates name (no traversal)", () => {
    expect(() => deleteSnapshot(vaultPath, "..")).toThrow(/Invalid snapshot name/);
  });

  // ── rollbackSnapshot ──────────────────────────────────────────────────────

  it("rollbackSnapshot restores file content + creates pre-rollback snapshot", () => {
    // Initial state
    createSnapshot(vaultPath, { name: "v1", projectName: "demo", branch: "main" });
    // Modify vault
    writeFileSync(join(vaultPath, "stack.md"), "# Stack\n\nMODIFIED\n", "utf-8");
    writeFileSync(join(vaultPath, "new-file.md"), "added after snapshot\n", "utf-8");

    const result = rollbackSnapshot(vaultPath, "v1", { projectName: "demo", branch: "main" });

    // Original file restored
    expect(readFileSync(join(vaultPath, "stack.md"), "utf-8")).toBe("# Stack\n\nNode.js\n");
    // File added after snapshot is gone
    expect(existsSync(join(vaultPath, "new-file.md"))).toBe(false);
    // Pre-rollback snapshot created
    expect(result.preRollbackName).toMatch(/^pre-rollback-/);
    const preRollback = loadSnapshotMeta(vaultPath, result.preRollbackName);
    expect(preRollback.name).toBe(result.preRollbackName);
  });

  it("rollbackSnapshot is reversible via the pre-rollback snapshot", () => {
    // initial state: 2 files
    createSnapshot(vaultPath, { name: "original", projectName: "demo", branch: "main" });
    // modify: add file
    writeFileSync(join(vaultPath, "extra.md"), "extra content\n", "utf-8");

    // rollback to "original" — extra.md should disappear
    const result = rollbackSnapshot(vaultPath, "original", { projectName: "demo", branch: "main" });
    expect(existsSync(join(vaultPath, "extra.md"))).toBe(false);

    // now rollback to pre-rollback — extra.md should reappear
    rollbackSnapshot(vaultPath, result.preRollbackName, { projectName: "demo", branch: "main" });
    expect(existsSync(join(vaultPath, "extra.md"))).toBe(true);
    expect(readFileSync(join(vaultPath, "extra.md"), "utf-8")).toBe("extra content\n");
  });

  it("rollbackSnapshot throws if target snapshot missing", () => {
    expect(() => rollbackSnapshot(vaultPath, "nonexistent", { projectName: "demo", branch: "main" }))
      .toThrow(/not found/);
  });

  // ── REVIEW iter2 additions ─────────────────────────────────────────────────

  it("createSnapshot deliberately skips symlinks (security: prevents outward refs)", () => {
    // Create a symlink in the vault pointing outside
    symlinkSync("/etc/passwd", join(vaultPath, "link-out.md"));
    const { path, manifest } = createSnapshot(vaultPath, {
      name: "no-symlinks", projectName: "demo", branch: "main",
    });
    // Regular files still copied
    expect(existsSync(join(path, "stack.md"))).toBe(true);
    // Symlink NOT copied — neither as link nor as resolved content
    expect(existsSync(join(path, "link-out.md"))).toBe(false);
    // Manifest fileCount reflects only regular files
    expect(manifest.fileCount).toBe(3); // stack.md, knowledge.md, architecture/adr-001.md
  });

  it("loadSnapshotMeta throws on corrupt JSON manifest", () => {
    mkdirSync(join(vaultPath, "snapshots", "corrupt"), { recursive: true });
    writeFileSync(join(vaultPath, "snapshots", "corrupt", "manifest.json"),
      "not valid json {{{", "utf-8");
    expect(() => loadSnapshotMeta(vaultPath, "corrupt")).toThrow();
  });

  it("createSnapshot honors custom namePrefix", () => {
    const { manifest } = createSnapshot(vaultPath, {
      projectName: "demo", branch: "main", namePrefix: "custom-prefix",
    });
    expect(manifest.name).toMatch(/^custom-prefix-\d{4}-\d{2}-\d{2}T/);
  });

  it("createSnapshot preserves deeply nested directory structure", () => {
    mkdirSync(join(vaultPath, "a", "b", "c", "d"), { recursive: true });
    writeFileSync(join(vaultPath, "a", "b", "c", "d", "deep.md"), "nested file", "utf-8");
    const { path, manifest } = createSnapshot(vaultPath, {
      name: "deep", projectName: "demo", branch: "main",
    });
    expect(existsSync(join(path, "a", "b", "c", "d", "deep.md"))).toBe(true);
    expect(manifest.fileCount).toBe(4); // 3 seeded + 1 deep
  });

  it("rollbackSnapshot preserves snapshots/ directory during restore", () => {
    createSnapshot(vaultPath, { name: "a", projectName: "demo", branch: "main" });
    createSnapshot(vaultPath, { name: "b", projectName: "demo", branch: "main" });

    rollbackSnapshot(vaultPath, "a", { projectName: "demo", branch: "main" });

    // After rollback, both original snapshots should still exist
    expect(existsSync(join(vaultPath, SNAPSHOTS_DIRNAME, "a"))).toBe(true);
    expect(existsSync(join(vaultPath, SNAPSHOTS_DIRNAME, "b"))).toBe(true);
    // Plus the auto pre-rollback
    const list = listSnapshots(vaultPath);
    expect(list.some((s) => s.name.startsWith("pre-rollback-"))).toBe(true);
  });
});
