import { execSync } from "node:child_process";
import type { TaskManager } from "./manager.js";
import type { Task } from "./types.js";

function git(command: string, cwd: string): string {
  try {
    return execSync(`git ${command}`, { cwd, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

export class TaskTracker {
  private readonly projectRoot: string;
  private readonly taskManager: TaskManager;

  constructor(projectRoot: string, taskManager: TaskManager) {
    this.projectRoot = projectRoot;
    this.taskManager = taskManager;
  }

  linkBranch(taskId: string, branch: string): void {
    this.taskManager.update(taskId, { branch, status: "in-progress" });
  }

  findByBranch(branch: string): Task | null {
    const tasks = this.taskManager.list({ branch });
    return tasks[0] ?? null;
  }

  currentTask(): Task | null {
    const branch = git("branch --show-current", this.projectRoot);
    if (!branch) return null;
    return this.findByBranch(branch);
  }
}
