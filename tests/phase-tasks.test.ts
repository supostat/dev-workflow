import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseTasksFromPhase, createTasksFromPhase } from "../src/tasks/phase-tasks.js";
import { TaskManager } from "../src/tasks/manager.js";

describe("phase-tasks", () => {
  let projectRoot: string;
  let vaultPath: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "phase-tasks-test-"));
    vaultPath = join(projectRoot, ".dev-vault");
    mkdirSync(join(vaultPath, "tasks"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  // ── parseTasksFromPhase ───────────────────────────────────────────────────

  it("parseTasksFromPhase: throws on nonexistent file", () => {
    expect(() => parseTasksFromPhase(join(projectRoot, "nope.md"))).toThrow(/Phase file not found/);
  });

  it("parseTasksFromPhase: returns [] when no ## Tasks section", () => {
    const path = join(projectRoot, "no-tasks.md");
    writeFileSync(path, "# Just a heading\n\nNo tasks here.\n", "utf-8");
    expect(parseTasksFromPhase(path)).toEqual([]);
  });

  it("parseTasksFromPhase: extracts task lines from ## Tasks section before next ##", () => {
    const path = join(projectRoot, "phase.md");
    writeFileSync(path,
      "## Tasks\n\n- [ ] First task\n- [ ] Second task\n- [ ] Third task\n\n## Notes\n\nUnrelated.\n",
      "utf-8");
    const tasks = parseTasksFromPhase(path);
    expect(tasks).toEqual([
      "- [ ] First task",
      "- [ ] Second task",
      "- [ ] Third task",
    ]);
  });

  it("parseTasksFromPhase: strips numbered prefix (1. 2. 3.)", () => {
    const path = join(projectRoot, "numbered.md");
    writeFileSync(path,
      "## Tasks\n\n1. First numbered\n2. Second numbered\n\n## End\n",
      "utf-8");
    expect(parseTasksFromPhase(path)).toEqual([
      "First numbered",
      "Second numbered",
    ]);
  });

  it("parseTasksFromPhase: filters out lines starting with # within section", () => {
    const path = join(projectRoot, "filtered.md");
    // Note: any `## ` line terminates the section per the regex, so we use
    // `# `-prefixed comment lines only — inner `## ` would close the section.
    writeFileSync(path,
      "## Tasks\n\n- [ ] Real task\n# Comment line\n- [ ] Another real task\n\n## End\n",
      "utf-8");
    const tasks = parseTasksFromPhase(path);
    expect(tasks).toContain("- [ ] Real task");
    expect(tasks).toContain("- [ ] Another real task");
    expect(tasks).not.toContain("# Comment line");
  });

  it("parseTasksFromPhase: KNOWN-BUG — regex uses \\Z (no JS support) — terminator section required", () => {
    // Document the existing behavior: a phase file with ## Tasks but no
    // subsequent ## section or --- separator parses as empty. Logged in
    // gameplan backlog as LOW bug 2026-05-11 to be fixed separately.
    const path = join(projectRoot, "no-terminator.md");
    writeFileSync(path,
      "## Tasks\n\n- [ ] Lonely task\n", // no closing section, no ---
      "utf-8");
    expect(parseTasksFromPhase(path)).toEqual([]);
  });

  it("parseTasksFromPhase: --- separator works as terminator (frontmatter close)", () => {
    const path = join(projectRoot, "frontmatter-term.md");
    writeFileSync(path,
      "## Tasks\n\n- [ ] Task one\n- [ ] Task two\n\n---\n\nMore content after.\n",
      "utf-8");
    expect(parseTasksFromPhase(path).length).toBe(2);
  });

  // ── createTasksFromPhase ──────────────────────────────────────────────────

  it("createTasksFromPhase: creates new tasks, returns titles in `created`", () => {
    const path = join(projectRoot, "create.md");
    writeFileSync(path,
      "## Tasks\n\n- [ ] Build feature X\n- [ ] Add tests for X\n\n## End\n",
      "utf-8");
    const manager = new TaskManager(vaultPath);
    const result = createTasksFromPhase(path, manager);
    expect(result.created.length).toBe(2);
    expect(result.skipped).toEqual([]);
    expect(manager.list().length).toBe(2);
  });

  it("createTasksFromPhase: skips tasks whose titles already exist (substring match)", () => {
    const path = join(projectRoot, "dup.md");
    writeFileSync(path,
      "## Tasks\n\n- [ ] Duplicate item\n\n## End\n", "utf-8");
    const manager = new TaskManager(vaultPath);
    // First run creates it
    createTasksFromPhase(path, manager);
    // Second run should skip it
    const second = createTasksFromPhase(path, manager);
    expect(second.created).toEqual([]);
    expect(second.skipped.length).toBe(1);
  });

  it("createTasksFromPhase: empty Tasks section returns {created:[], skipped:[]}", () => {
    const path = join(projectRoot, "empty.md");
    writeFileSync(path, "# Phase\n\nNo task list here.\n", "utf-8");
    const manager = new TaskManager(vaultPath);
    const result = createTasksFromPhase(path, manager);
    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("createTasksFromPhase: mix of new + existing tasks reports both lists", () => {
    const manager = new TaskManager(vaultPath);
    // Pre-create one
    manager.create("Existing similar task", "");

    const path = join(projectRoot, "mix.md");
    writeFileSync(path,
      "## Tasks\n\n- [ ] Existing similar task\n- [ ] Brand new task\n\n## End\n",
      "utf-8");
    const result = createTasksFromPhase(path, manager);
    expect(result.created.length).toBe(1);
    expect(result.skipped.length).toBe(1);
  });
});
