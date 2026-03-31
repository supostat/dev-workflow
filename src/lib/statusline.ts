#!/usr/bin/env node

import { detectContext } from "./context.js";
import { VaultReader } from "./reader.js";
import { TaskManager } from "../tasks/manager.js";
import { TaskTracker } from "../tasks/tracker.js";
import { WorkflowState } from "../workflow/state.js";

function run(): void {
  const context = detectContext();
  if (!context) {
    process.stdout.write("");
    return;
  }

  const reader = new VaultReader(context);
  const parts: string[] = [];

  parts.push(context.projectName);
  parts.push(context.branch);

  if (reader.exists()) {
    const branch = reader.readBranch(context.branch);
    if (branch) {
      parts.push(branch.status);
    }

    const taskManager = new TaskManager(context.vaultPath);
    const tracker = new TaskTracker(context.projectRoot, taskManager);
    const currentTask = tracker.findByBranch(context.branch);
    if (currentTask) {
      parts.push(currentTask.id);
    }

    const workflowState = new WorkflowState(context.vaultPath);
    const currentRun = workflowState.loadCurrent();
    if (currentRun && (currentRun.status === "running" || currentRun.status === "paused")) {
      parts.push(`${currentRun.currentStep}:${currentRun.status}`);
    }
  } else {
    parts.push("no vault");
  }

  process.stdout.write(parts.join(" | "));
}

run();
