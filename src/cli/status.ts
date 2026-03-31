import { detectContext } from "../lib/context.js";
import { VaultReader } from "../lib/reader.js";
import { TaskManager } from "../tasks/manager.js";
import { TaskTracker } from "../tasks/tracker.js";
import { WorkflowState } from "../workflow/state.js";
import { icon, progressBar, statusIcon } from "../lib/output.js";

function contentScore(content: string | null): { label: string; filled: number } {
  if (!content) return { label: "missing", filled: 0 };
  const lines = content.split("\n").length;
  if (lines <= 8) return { label: "empty", filled: 0 };
  return { label: `${lines} lines`, filled: 1 };
}

export function status(): void {
  const context = detectContext();
  if (!context) {
    console.error(`${icon.error} Not a git repository.`);
    process.exitCode = 1;
    return;
  }

  const reader = new VaultReader(context);

  console.log(`\n\u250C\u2500 ${context.projectName} ${ "\u2500".repeat(Math.max(0, 30 - context.projectName.length))} ${context.branch} \u2500\u2510`);

  if (!reader.exists()) {
    console.log(`\u2502  ${icon.warning} No vault. Run 'dev-workflow init'`);
    console.log(`\u2514${ "\u2500".repeat(45)}\u2518`);
    return;
  }

  const files = {
    stack: reader.readStack(),
    conventions: reader.readConventions(),
    knowledge: reader.readKnowledge(),
    gameplan: reader.readGameplan(),
  };

  const scores = Object.entries(files).map(([name, content]) => {
    const score = contentScore(content);
    return { name, ...score };
  });

  console.log(`\u2502`);
  for (const s of scores) {
    const bar = progressBar(s.filled, 1, 10);
    const pad = s.name.padEnd(16);
    console.log(`\u2502  ${pad}${bar}  ${s.label}`);
  }

  const logs = reader.readRecentDailyLogs(3);

  console.log(`\u2502`);

  const taskManager = new TaskManager(context.vaultPath);
  const allTasks = taskManager.list();

  if (allTasks.length > 0) {
    const statusCounts: Record<string, number> = {};
    for (const t of allTasks) {
      statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1;
    }
    const summary = Object.entries(statusCounts)
      .map(([s, c]) => `${statusIcon(s)} ${s}: ${c}`)
      .join("  ");
    console.log(`\u2502  ${icon.task} Tasks        ${allTasks.length} total`);
    console.log(`\u2502     ${summary}`);
  } else {
    console.log(`\u2502  ${icon.task} Tasks        none`);
  }

  const tracker = new TaskTracker(context.projectRoot, taskManager);
  const currentTask = tracker.findByBranch(context.branch);
  if (currentTask) {
    console.log(`\u2502`);
    console.log(`\u2502  ${statusIcon(currentTask.status)} Current: ${currentTask.id} "${currentTask.title}"`);
  }

  const workflowState = new WorkflowState(context.vaultPath);
  const currentRun = workflowState.loadCurrent();
  if (currentRun) {
    const totalSteps = Object.keys(currentRun.steps).length;
    const completedSteps = Object.values(currentRun.steps).filter((s) => s.status === "completed").length;
    console.log(`\u2502`);
    console.log(`\u2502  ${icon.workflow} Workflow     ${currentRun.workflowName} (${currentRun.id})`);
    console.log(`\u2502     Step: ${currentRun.currentStep} (${completedSteps}/${totalSteps})`);
    console.log(`\u2502     Status: ${statusIcon(currentRun.status)} ${currentRun.status}`);
  }

  if (logs.length > 0) {
    console.log(`\u2502`);
    console.log(`\u2502  \uD83D\uDCC5 Sessions     ${logs.length} recent`);
    for (const log of logs) {
      console.log(`\u2502     ${log.date}`);
    }
  }

  console.log(`\u2502`);
  console.log(`\u2514${ "\u2500".repeat(45)}\u2518`);
}
