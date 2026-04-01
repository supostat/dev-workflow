#!/usr/bin/env node

import { detectContext } from "../lib/context.js";
import { VaultReader } from "../lib/reader.js";
import { TaskManager } from "../tasks/manager.js";
import { TaskTracker } from "../tasks/tracker.js";
import { WorkflowState } from "../workflow/state.js";
import { IntelligenceStore } from "../intelligence/store.js";
import { syncFromVault } from "../intelligence/sync.js";
import { topN, formatRelevantContext } from "../intelligence/ranker.js";
import { readStdin, hookSuccess } from "./stdin.js";

async function run(): Promise<void> {
  const input = await readStdin();

  const context = detectContext(input.cwd);
  if (!context) {
    hookSuccess("Not a git repository, skipping vault resume.");
    return;
  }

  const reader = new VaultReader(context);
  if (!reader.exists()) {
    hookSuccess(`No .dev-vault/ found in ${context.projectName}. Run 'dev-workflow init' to set up.`);
    return;
  }

  const vaultData = reader.readAll(context.branch);
  const sections: string[] = [];

  sections.push(`# Dev Vault: ${context.projectName}`);
  sections.push(`**Branch:** ${context.branch} (parent: ${context.parentBranch})`);

  if (vaultData.stack) {
    sections.push("\n## Stack\n" + truncate(vaultData.stack, 2000));
  }

  if (vaultData.knowledge) {
    sections.push("\n## Knowledge\n" + truncate(vaultData.knowledge, 3000));
  }

  if (vaultData.gameplan) {
    sections.push("\n## Gameplan\n" + truncate(vaultData.gameplan, 2000));
  }

  if (vaultData.conventions) {
    sections.push("\n## Conventions\n" + truncate(vaultData.conventions, 1500));
  }

  if (vaultData.branch) {
    sections.push(
      `\n## Branch Context: ${vaultData.branch.branch}\n` +
      `Status: ${vaultData.branch.status}\n\n` +
      truncate(vaultData.branch.raw, 2000),
    );
  } else if (context.branch !== context.parentBranch) {
    const { VaultWriter } = await import("../lib/writer.js");
    const { renderTemplate } = await import("../lib/templates.js");
    const writer = new VaultWriter(context);
    const branchContent = renderTemplate("records/branch", {
      projectName: context.projectName,
      branch: context.branch,
      parent: context.parentBranch,
      goal: "",
    });
    writer.writeBranch(context.branch, branchContent);
    sections.push(`\n## Branch Context: ${context.branch}\n> Auto-created. Fill in the goal.`);
  }

  if (vaultData.recentDailyLogs.length > 0) {
    const latest = vaultData.recentDailyLogs[0];
    if (latest) {
      sections.push(
        `\n## Last Session (${latest.date})\n` + truncate(latest.content, 1500),
      );
    }
  }

  const taskManager = new TaskManager(context.vaultPath);
  const tracker = new TaskTracker(context.projectRoot, taskManager);
  const currentTask = tracker.findByBranch(context.branch);
  if (currentTask) {
    sections.push(
      `\n## Current Task: ${currentTask.title}\n` +
      `Status: ${currentTask.status}\n` +
      `ID: ${currentTask.id}\n\n` +
      currentTask.description,
    );
  }

  const workflowState = new WorkflowState(context.vaultPath);
  const pausedRun = workflowState.loadCurrent();
  if (pausedRun && pausedRun.status === "paused") {
    sections.push(
      `\n## Paused Workflow: ${pausedRun.workflowName}\n` +
      `Step: ${pausedRun.currentStep}\n` +
      `Run: ${pausedRun.id}\n\n` +
      `> Resume with: dev-workflow resume`,
    );
  }

  const intelligenceStore = new IntelligenceStore(context.vaultPath);
  syncFromVault(intelligenceStore, context.vaultPath);

  const scoringContext = {
    branch: context.branch,
    taskTitle: currentTask?.title ?? null,
    recentFiles: [],
    query: null,
  };

  const ranked = topN(intelligenceStore.allNodes(), scoringContext, 15);
  const relevantContext = formatRelevantContext(ranked);
  if (relevantContext) {
    sections.push("\n" + relevantContext);
  }

  const message = sections.join("\n");

  const output = {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: message,
    },
  };

  process.stdout.write(JSON.stringify(output));
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "\n\n... (truncated)";
}

run().catch(() => {
  process.stdout.write(JSON.stringify({ continue: true }));
});
