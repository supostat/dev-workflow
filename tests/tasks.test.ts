import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskManager } from "../src/tasks/manager.js";
import { TaskTracker } from "../src/tasks/tracker.js";

function createTempVault(): string {
  const vaultPath = join(tmpdir(), `dev-vault-tasks-test-${Date.now()}`, ".dev-vault");
  mkdirSync(join(vaultPath, "tasks"), { recursive: true });
  return vaultPath;
}

describe("TaskManager", () => {
  let vaultPath: string;
  let manager: TaskManager;

  beforeEach(() => {
    vaultPath = createTempVault();
    manager = new TaskManager(vaultPath);
  });

  afterEach(() => {
    rmSync(join(vaultPath, ".."), { recursive: true, force: true });
  });

  it("creates task with correct frontmatter", () => {
    const task = manager.create("Add authentication", "JWT with refresh tokens");

    expect(task.id).toBe("task-001");
    expect(task.title).toBe("Add authentication");
    expect(task.description).toBe("JWT with refresh tokens");
    expect(task.status).toBe("pending");
    expect(task.branch).toBeNull();
    expect(task.workflowRun).toBeNull();

    const filepath = join(vaultPath, "tasks", "task-001.md");
    expect(existsSync(filepath)).toBe(true);

    const content = readFileSync(filepath, "utf-8");
    expect(content).toContain("id: task-001");
    expect(content).toContain("title: Add authentication");
    expect(content).toContain("status: pending");
    expect(content).toContain("JWT with refresh tokens");
  });

  it("auto-increments ID", () => {
    const first = manager.create("First task");
    const second = manager.create("Second task");
    const third = manager.create("Third task");

    expect(first.id).toBe("task-001");
    expect(second.id).toBe("task-002");
    expect(third.id).toBe("task-003");
  });

  it("gets task by ID", () => {
    manager.create("Test task", "Description here");
    const task = manager.get("task-001");

    expect(task.title).toBe("Test task");
    expect(task.description).toBe("Description here");
  });

  it("throws error for nonexistent task", () => {
    expect(() => manager.get("task-999")).toThrow("Task not found: task-999");
  });

  it("lists all tasks", () => {
    manager.create("Task A");
    manager.create("Task B");
    manager.create("Task C");

    const tasks = manager.list();

    expect(tasks).toHaveLength(3);
  });

  it("filters by status", () => {
    manager.create("Pending task");
    const second = manager.create("Done task");
    manager.update(second.id, { status: "done" });

    const pending = manager.list({ status: "pending" });
    const done = manager.list({ status: "done" });

    expect(pending).toHaveLength(1);
    expect(pending[0]!.title).toBe("Pending task");
    expect(done).toHaveLength(1);
    expect(done[0]!.title).toBe("Done task");
  });

  it("filters by branch", () => {
    const task = manager.create("Branch task");
    manager.update(task.id, { branch: "feature/auth" });
    manager.create("No branch task");

    const filtered = manager.list({ branch: "feature/auth" });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.title).toBe("Branch task");
  });

  it("updates fields and updated date", () => {
    const task = manager.create("Original title");
    const updated = manager.update(task.id, {
      status: "in-progress",
      branch: "feature/test",
    });

    expect(updated.status).toBe("in-progress");
    expect(updated.branch).toBe("feature/test");
    expect(updated.title).toBe("Original title");

    const reloaded = manager.get(task.id);
    expect(reloaded.status).toBe("in-progress");
    expect(reloaded.branch).toBe("feature/test");
  });

  it("deletes task file", () => {
    const task = manager.create("To delete");
    const filepath = join(vaultPath, "tasks", `${task.id}.md`);

    expect(existsSync(filepath)).toBe(true);

    manager.delete(task.id);

    expect(existsSync(filepath)).toBe(false);
  });

  it("delete throws for nonexistent task", () => {
    expect(() => manager.delete("task-999")).toThrow("Task not found: task-999");
  });

  it("rejects task IDs with path traversal", () => {
    expect(() => manager.get("../../../etc/passwd")).toThrow("Invalid task ID");
    expect(() => manager.update("..\\windows", { status: "done" })).toThrow("Invalid task ID");
    expect(() => manager.delete("not-a-task")).toThrow("Invalid task ID");
  });

  it("roundtrips task through create and get", () => {
    const created = manager.create("Roundtrip task", "Full description");
    manager.update(created.id, { branch: "feature/rt", workflowRun: "run-001" });

    const reloaded = manager.get(created.id);

    expect(reloaded.id).toBe(created.id);
    expect(reloaded.title).toBe("Roundtrip task");
    expect(reloaded.description).toBe("Full description");
    expect(reloaded.branch).toBe("feature/rt");
    expect(reloaded.workflowRun).toBe("run-001");
  });
});

describe("TaskTracker", () => {
  let vaultPath: string;
  let projectRoot: string;
  let manager: TaskManager;
  let tracker: TaskTracker;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `dev-vault-tracker-test-${Date.now()}`);
    vaultPath = join(projectRoot, ".dev-vault");
    mkdirSync(join(vaultPath, "tasks"), { recursive: true });
    manager = new TaskManager(vaultPath);
    tracker = new TaskTracker(projectRoot, manager);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("links branch to task and sets in-progress", () => {
    const task = manager.create("Test task");
    tracker.linkBranch(task.id, "feature/auth");

    const updated = manager.get(task.id);
    expect(updated.branch).toBe("feature/auth");
    expect(updated.status).toBe("in-progress");
  });

  it("finds task by branch", () => {
    const task = manager.create("Auth task");
    manager.update(task.id, { branch: "feature/auth" });

    const found = tracker.findByBranch("feature/auth");

    expect(found).not.toBeNull();
    expect(found!.id).toBe(task.id);
  });

  it("returns null when no task for branch", () => {
    const found = tracker.findByBranch("feature/nonexistent");

    expect(found).toBeNull();
  });
});
