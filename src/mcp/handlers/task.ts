import { join } from "node:path";
import type { TaskManager } from "../../tasks/manager.js";
import { TaskTracker } from "../../tasks/tracker.js";
import type { TaskStatus } from "../../tasks/types.js";
import { createTasksFromPhase } from "../../tasks/phase-tasks.js";
import type { ProjectContext } from "../../lib/types.js";
import { slugifyTitle } from "./helpers.js";

export function taskCreate(manager: TaskManager, title: string, description?: string): unknown {
  return manager.create(title, description ?? "");
}

export function taskList(manager: TaskManager, status?: string): unknown {
  const filter = status ? { status: status as TaskStatus } : undefined;
  return manager.list(filter);
}

export function taskUpdate(
  manager: TaskManager,
  id: string,
  status?: string,
  description?: string,
): unknown {
  const patch: Record<string, unknown> = {};
  if (status) patch["status"] = status;
  if (description) patch["description"] = description;
  return manager.update(id, patch as { status?: TaskStatus; description?: string });
}

export function taskStart(
  manager: TaskManager,
  taskTracker: TaskTracker,
  id: string,
): unknown {
  const task = manager.get(id);
  const branchName = `task/${slugifyTitle(task.title)}`;
  taskTracker.linkBranch(id, branchName);
  return {
    id: task.id,
    title: task.title,
    status: "in-progress",
    branch: branchName,
  };
}

export function taskCreateFromPhase(
  manager: TaskManager,
  context: ProjectContext,
  phaseFile: string,
): unknown {
  const fullPath = phaseFile.startsWith("/") ? phaseFile : join(context.projectRoot, phaseFile);
  return createTasksFromPhase(fullPath, manager);
}
