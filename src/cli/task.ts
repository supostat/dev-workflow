import { detectContext } from "../lib/context.js";
import { TaskManager } from "../tasks/manager.js";
import { TaskTracker } from "../tasks/tracker.js";
import type { TaskStatus } from "../tasks/types.js";

function parseFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index >= args.length - 1) return undefined;
  return args[index + 1];
}

export function task(args: string[]): void {
  const context = detectContext();
  if (!context) {
    console.error("Not a git repository.");
    process.exitCode = 1;
    return;
  }

  const manager = new TaskManager(context.vaultPath);
  const subcommand = args[0];

  switch (subcommand) {
    case "create":
      taskCreate(manager, args.slice(1));
      break;
    case "list":
      taskList(manager, args.slice(1));
      break;
    case "show":
      taskShow(manager, args[1]);
      break;
    case "start":
      taskStart(manager, context.projectRoot, args[1]);
      break;
    case "done":
      taskDone(manager, args[1]);
      break;
    case "block":
      taskBlock(manager, args[1]);
      break;
    default:
      console.error("Usage: dev-workflow task create|list|show|start|done|block");
      console.error("  task create \"title\" [\"description\"]");
      console.error("  task list [--status <status>]");
      console.error("  task show <id>");
      console.error("  task start <id>");
      console.error("  task done <id>");
      console.error("  task block <id>");
      process.exitCode = 1;
  }
}

function taskCreate(manager: TaskManager, args: string[]): void {
  const title = args[0];
  if (!title) {
    console.error("Usage: dev-workflow task create \"title\" [\"description\"]");
    process.exitCode = 1;
    return;
  }

  const description = args[1] ?? "";
  const created = manager.create(title, description);
  console.log(`Created ${created.id}: ${created.title}`);
}

function taskList(manager: TaskManager, args: string[]): void {
  const status = parseFlag(args, "--status") as TaskStatus | undefined;
  const tasks = manager.list(status ? { status } : undefined);

  if (tasks.length === 0) {
    console.log("No tasks found.");
    return;
  }

  console.log("ID".padEnd(12) + "Status".padEnd(14) + "Title");
  console.log("-".repeat(56));

  for (const t of tasks) {
    console.log(t.id.padEnd(12) + t.status.padEnd(14) + t.title);
  }
}

function taskShow(manager: TaskManager, id: string | undefined): void {
  if (!id) {
    console.error("Usage: dev-workflow task show <id>");
    process.exitCode = 1;
    return;
  }

  try {
    const t = manager.get(id);
    console.log(`ID:          ${t.id}`);
    console.log(`Title:       ${t.title}`);
    console.log(`Status:      ${t.status}`);
    console.log(`Branch:      ${t.branch ?? "none"}`);
    console.log(`Workflow:    ${t.workflowRun ?? "none"}`);
    console.log(`Created:     ${t.created}`);
    console.log(`Updated:     ${t.updated}`);
    if (t.description) {
      console.log(`\n${t.description}`);
    }
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "Task not found");
    process.exitCode = 1;
  }
}

function taskStart(manager: TaskManager, projectRoot: string, id: string | undefined): void {
  if (!id) {
    console.error("Usage: dev-workflow task start <id>");
    process.exitCode = 1;
    return;
  }

  try {
    const t = manager.get(id);
    const slug = t.title
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    const branchName = `task/${slug}`;

    const tracker = new TaskTracker(projectRoot, manager);
    tracker.linkBranch(id, branchName);

    console.log(`Task ${id} started on branch ${branchName}`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "Task not found");
    process.exitCode = 1;
  }
}

function taskDone(manager: TaskManager, id: string | undefined): void {
  if (!id) {
    console.error("Usage: dev-workflow task done <id>");
    process.exitCode = 1;
    return;
  }

  try {
    manager.update(id, { status: "done" });
    console.log(`Task ${id} marked as done`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "Task not found");
    process.exitCode = 1;
  }
}

function taskBlock(manager: TaskManager, id: string | undefined): void {
  if (!id) {
    console.error("Usage: dev-workflow task block <id>");
    process.exitCode = 1;
    return;
  }

  try {
    manager.update(id, { status: "blocked" });
    console.log(`Task ${id} marked as blocked`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "Task not found");
    process.exitCode = 1;
  }
}
