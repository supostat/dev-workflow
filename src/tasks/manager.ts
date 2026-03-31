import { readdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter, serializeFrontmatter } from "../lib/frontmatter.js";
import { readFileOrNull, writeFileSafe, todayDate } from "../lib/fs-helpers.js";
import type { Task, TaskStatus, TaskPriority, TaskFilter } from "./types.js";

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "pending", "in-progress", "review", "done", "blocked",
]);

const VALID_PRIORITIES: ReadonlySet<string> = new Set(["high", "medium", "low"]);

type TaskPatch = Partial<Pick<Task, "status" | "priority" | "description" | "branch" | "workflowRun">>;

const TASK_ID_PATTERN = /^task-\d{3,}$/;

function validateTaskId(id: string): void {
  if (!TASK_ID_PATTERN.test(id)) {
    throw new Error(`Invalid task ID: ${id}`);
  }
}

function parseTaskFile(filepath: string): Task | null {
  const raw = readFileOrNull(filepath);
  if (!raw) return null;

  const { fields, body } = parseFrontmatter(raw);

  const id = fields["id"];
  const title = fields["title"];
  if (typeof id !== "string" || typeof title !== "string") return null;

  const status = typeof fields["status"] === "string" && VALID_STATUSES.has(fields["status"])
    ? fields["status"] as TaskStatus
    : "pending";

  const priority = typeof fields["priority"] === "string" && VALID_PRIORITIES.has(fields["priority"])
    ? fields["priority"] as TaskPriority
    : "medium";

  return {
    id,
    title,
    description: body.trim(),
    status,
    priority,
    branch: typeof fields["branch"] === "string" ? fields["branch"] : null,
    workflowRun: typeof fields["workflowRun"] === "string" ? fields["workflowRun"] : null,
    created: typeof fields["created"] === "string" ? fields["created"] : todayDate(),
    updated: typeof fields["updated"] === "string" ? fields["updated"] : todayDate(),
  };
}

function serializeTask(task: Task): string {
  const fields: Record<string, unknown> = {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    created: task.created,
    updated: task.updated,
  };

  if (task.branch) fields["branch"] = task.branch;
  if (task.workflowRun) fields["workflowRun"] = task.workflowRun;

  return serializeFrontmatter(fields, task.description);
}

export class TaskManager {
  private readonly tasksDir: string;

  constructor(vaultPath: string) {
    this.tasksDir = join(vaultPath, "tasks");
  }

  create(title: string, description: string = ""): Task {
    const id = this.nextId();
    const today = todayDate();

    const task: Task = {
      id,
      title,
      description,
      status: "pending",
      priority: "medium",
      branch: null,
      workflowRun: null,
      created: today,
      updated: today,
    };

    writeFileSafe(join(this.tasksDir, `${id}.md`), serializeTask(task));
    return task;
  }

  get(id: string): Task {
    validateTaskId(id);
    const filepath = join(this.tasksDir, `${id}.md`);
    const task = parseTaskFile(filepath);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }
    return task;
  }

  list(filter?: TaskFilter): Task[] {
    if (!existsSync(this.tasksDir)) return [];

    const files = readdirSync(this.tasksDir)
      .filter((file) => file.startsWith("task-") && file.endsWith(".md"));

    const tasks: Task[] = [];
    for (const file of files) {
      const task = parseTaskFile(join(this.tasksDir, file));
      if (!task) continue;

      if (filter?.status && task.status !== filter.status) continue;
      if (filter?.priority && task.priority !== filter.priority) continue;
      if (filter?.branch && task.branch !== filter.branch) continue;

      tasks.push(task);
    }

    return tasks.sort((a, b) => b.updated.localeCompare(a.updated));
  }

  update(id: string, patch: TaskPatch): Task {
    validateTaskId(id);
    const task = this.get(id);

    if (patch.status !== undefined) task.status = patch.status;
    if (patch.priority !== undefined) task.priority = patch.priority;
    if (patch.description !== undefined) task.description = patch.description;
    if (patch.branch !== undefined) task.branch = patch.branch;
    if (patch.workflowRun !== undefined) task.workflowRun = patch.workflowRun;
    task.updated = todayDate();

    writeFileSafe(join(this.tasksDir, `${id}.md`), serializeTask(task));
    return task;
  }

  delete(id: string): void {
    validateTaskId(id);
    const filepath = join(this.tasksDir, `${id}.md`);
    if (!existsSync(filepath)) {
      throw new Error(`Task not found: ${id}`);
    }
    unlinkSync(filepath);
  }

  private nextId(): string {
    if (!existsSync(this.tasksDir)) {
      return "task-001";
    }

    const files = readdirSync(this.tasksDir)
      .filter((file) => file.startsWith("task-") && file.endsWith(".md"));

    let maxNumber = 0;
    for (const file of files) {
      const match = file.match(/^task-(\d+)\.md$/);
      if (match) {
        const number = parseInt(match[1]!, 10);
        if (number > maxNumber) maxNumber = number;
      }
    }

    return `task-${String(maxNumber + 1).padStart(3, "0")}`;
  }
}
