import { detectContext } from "../lib/context.js";
import { VaultReader } from "../lib/reader.js";
import { TaskManager } from "../tasks/manager.js";
import { TaskTracker } from "../tasks/tracker.js";
import { WorkflowState } from "../workflow/state.js";
import { icon, progressBar, statusIcon } from "../lib/output.js";

/**
 * Snapshot of dev-workflow project state, emitted both by the
 * pretty-print path and by `--json` for tooling integration (CI
 * dashboards, status bars, scripts).
 *
 * Stable contract for `--json` consumers: field shape is locked
 * post-1.0.x. Additive changes only; removals/renames require a major
 * version bump.
 */
export interface StatusSnapshot {
  project: string;
  branch: string;
  parentBranch: string;
  vault: {
    exists: boolean;
    sections: Record<"stack" | "conventions" | "knowledge" | "gameplan", {
      label: string;
      filled: boolean;
      lines: number;
    }>;
  };
  tasks: {
    total: number;
    byStatus: Record<string, number>;
  };
  currentTask: { id: string; title: string; status: string } | null;
  workflow: {
    name: string;
    id: string;
    currentStep: string;
    status: string;
    completedSteps: number;
    totalSteps: number;
  } | null;
  recentSessions: Array<{ date: string }>;
}

function sectionInfo(content: string | null): { label: string; filled: boolean; lines: number } {
  if (!content) return { label: "missing", filled: false, lines: 0 };
  const lines = content.split("\n").length;
  if (lines <= 8) return { label: "empty", filled: false, lines };
  return { label: `${lines} lines`, filled: true, lines };
}

function collectStatus(args: string[]): { snapshot: StatusSnapshot | null; error?: string } {
  const context = detectContext();
  if (!context) {
    return { snapshot: null, error: "Not a git repository." };
  }

  const reader = new VaultReader(context);

  if (!reader.exists()) {
    return {
      snapshot: {
        project: context.projectName,
        branch: context.branch,
        parentBranch: context.parentBranch,
        vault: {
          exists: false,
          sections: {
            stack: sectionInfo(null),
            conventions: sectionInfo(null),
            knowledge: sectionInfo(null),
            gameplan: sectionInfo(null),
          },
        },
        tasks: { total: 0, byStatus: {} },
        currentTask: null,
        workflow: null,
        recentSessions: [],
      },
    };
  }

  const taskManager = new TaskManager(context.vaultPath);
  const allTasks = taskManager.list();
  const byStatus: Record<string, number> = {};
  for (const t of allTasks) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  }

  const tracker = new TaskTracker(context.projectRoot, taskManager);
  const currentTaskRaw = tracker.findByBranch(context.branch);
  const currentTask = currentTaskRaw
    ? { id: currentTaskRaw.id, title: currentTaskRaw.title, status: currentTaskRaw.status }
    : null;

  const workflowState = new WorkflowState(context.vaultPath);
  const currentRun = workflowState.loadCurrent();
  const workflow = currentRun
    ? {
      name: currentRun.workflowName,
      id: currentRun.id,
      currentStep: currentRun.currentStep,
      status: currentRun.status,
      completedSteps: Object.values(currentRun.steps).filter((s) => s.status === "completed").length,
      totalSteps: Object.keys(currentRun.steps).length,
    }
    : null;

  const logs = reader.readRecentDailyLogs(3);
  const recentSessions = logs.map((log) => ({ date: log.date }));

  // Silence unused-arg warning when --json is consumed by caller, not here
  void args;

  return {
    snapshot: {
      project: context.projectName,
      branch: context.branch,
      parentBranch: context.parentBranch,
      vault: {
        exists: true,
        sections: {
          stack: sectionInfo(reader.readStack()),
          conventions: sectionInfo(reader.readConventions()),
          knowledge: sectionInfo(reader.readKnowledge()),
          gameplan: sectionInfo(reader.readGameplan()),
        },
      },
      tasks: { total: allTasks.length, byStatus },
      currentTask,
      workflow,
      recentSessions,
    },
  };
}

function renderJson(snapshot: StatusSnapshot): void {
  console.log(JSON.stringify(snapshot, null, 2));
}

function renderPretty(snapshot: StatusSnapshot): void {
  console.log(`\n┌─ ${snapshot.project} ${ "─".repeat(Math.max(0, 30 - snapshot.project.length))} ${snapshot.branch} ─┐`);

  if (!snapshot.vault.exists) {
    console.log(`│  ${icon.warning} No vault. Run 'dev-workflow init'`);
    console.log(`└${ "─".repeat(45)}┘`);
    return;
  }

  console.log(`│`);
  for (const [name, info] of Object.entries(snapshot.vault.sections)) {
    const bar = progressBar(info.filled ? 1 : 0, 1, 10);
    const pad = name.padEnd(16);
    console.log(`│  ${pad}${bar}  ${info.label}`);
  }

  console.log(`│`);

  if (snapshot.tasks.total > 0) {
    const summary = Object.entries(snapshot.tasks.byStatus)
      .map(([s, c]) => `${statusIcon(s)} ${s}: ${c}`)
      .join("  ");
    console.log(`│  ${icon.task} Tasks        ${snapshot.tasks.total} total`);
    console.log(`│     ${summary}`);
  } else {
    console.log(`│  ${icon.task} Tasks        none`);
  }

  if (snapshot.currentTask) {
    console.log(`│`);
    console.log(`│  ${statusIcon(snapshot.currentTask.status)} Current: ${snapshot.currentTask.id} "${snapshot.currentTask.title}"`);
  }

  if (snapshot.workflow) {
    console.log(`│`);
    console.log(`│  ${icon.workflow} Workflow     ${snapshot.workflow.name} (${snapshot.workflow.id})`);
    console.log(`│     Step: ${snapshot.workflow.currentStep} (${snapshot.workflow.completedSteps}/${snapshot.workflow.totalSteps})`);
    console.log(`│     Status: ${statusIcon(snapshot.workflow.status)} ${snapshot.workflow.status}`);
  }

  if (snapshot.recentSessions.length > 0) {
    console.log(`│`);
    console.log(`│  📅 Sessions     ${snapshot.recentSessions.length} recent`);
    for (const session of snapshot.recentSessions) {
      console.log(`│     ${session.date}`);
    }
  }

  console.log(`│`);
  console.log(`└${ "─".repeat(45)}┘`);
}

export function status(args: string[] = []): void {
  const { snapshot, error } = collectStatus(args);
  if (error || !snapshot) {
    console.error(`${icon.error} ${error ?? "Failed to collect status."}`);
    process.exitCode = 1;
    return;
  }

  const wantJson = args.includes("--json");
  if (wantJson) {
    renderJson(snapshot);
  } else {
    renderPretty(snapshot);
  }
}
