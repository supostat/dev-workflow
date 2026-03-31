import { detectContext } from "../lib/context.js";
import { VaultReader } from "../lib/reader.js";
import { TaskManager } from "../tasks/manager.js";
import { TaskTracker } from "../tasks/tracker.js";
import { WorkflowState } from "../workflow/state.js";

export function status(): void {
  const context = detectContext();
  if (!context) {
    console.error("Not a git repository.");
    process.exitCode = 1;
    return;
  }

  const reader = new VaultReader(context);

  console.log(`Project:  ${context.projectName}`);
  console.log(`Branch:   ${context.branch}`);
  console.log(`Parent:   ${context.parentBranch}`);
  console.log(`Vault:    ${context.vaultPath}`);
  console.log(`Exists:   ${reader.exists() ? "yes" : "no"}`);

  if (!reader.exists()) {
    console.log(`\nRun 'dev-workflow init' to set up.`);
    return;
  }

  const files = {
    stack: reader.readStack(),
    conventions: reader.readConventions(),
    knowledge: reader.readKnowledge(),
    gameplan: reader.readGameplan(),
  };

  console.log(`\nFiles:`);
  for (const [name, content] of Object.entries(files)) {
    const fileStatus = content ? `${content.split("\n").length} lines` : "empty";
    console.log(`  ${name.padEnd(14)} ${fileStatus}`);
  }

  const branch = reader.readBranch(context.branch);
  console.log(`\nBranch context: ${branch ? branch.status : "none"}`);

  const logs = reader.readRecentDailyLogs(3);
  console.log(`Daily logs:     ${logs.length} recent`);
  for (const log of logs) {
    console.log(`  ${log.date}`);
  }

  const taskManager = new TaskManager(context.vaultPath);
  const allTasks = taskManager.list();

  if (allTasks.length > 0) {
    const statusCounts: Record<string, number> = {};
    for (const t of allTasks) {
      statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1;
    }

    console.log(`\nTasks:`);
    for (const [taskStatus, count] of Object.entries(statusCounts)) {
      console.log(`  ${taskStatus.padEnd(14)} ${count}`);
    }
  }

  const tracker = new TaskTracker(context.projectRoot, taskManager);
  const currentTask = tracker.findByBranch(context.branch);
  if (currentTask) {
    console.log(`\nCurrent task: ${currentTask.id} "${currentTask.title}" (${currentTask.status})`);
  }

  const workflowState = new WorkflowState(context.vaultPath);
  const currentRun = workflowState.loadCurrent();
  if (currentRun) {
    const totalSteps = Object.keys(currentRun.steps).length;
    const completedSteps = Object.values(currentRun.steps).filter((s) => s.status === "completed").length;
    console.log(`\nWorkflow:  ${currentRun.workflowName} (${currentRun.id})`);
    console.log(`  Step:    ${currentRun.currentStep} (${completedSteps}/${totalSteps})`);
    console.log(`  Status:  ${currentRun.status}`);
  }
}
