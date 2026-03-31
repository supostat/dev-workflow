#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { detectContext } from "../lib/context.js";
import { VaultReader } from "../lib/reader.js";
import { VaultWriter } from "../lib/writer.js";
import { WorkflowState } from "../workflow/state.js";
import { IntelligenceStore } from "../intelligence/store.js";
import { Collector } from "../intelligence/collector.js";
import type { HookOutput } from "../lib/types.js";

function git(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function run(): void {
  const context = detectContext();
  if (!context) {
    output({ status: "ok", message: "Not a git repository, skipping." });
    return;
  }

  const reader = new VaultReader(context);
  if (!reader.exists()) {
    output({ status: "ok", message: "No vault found, skipping." });
    return;
  }

  const writer = new VaultWriter(context);
  const today = new Date().toISOString().slice(0, 10);
  const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const markerLines = [
    `---`,
    `date: ${today}`,
    `projects: [${context.projectName}]`,
    `branches: [${context.branch}]`,
    `tags: [session-log, auto]`,
    `---`,
    `# Auto-save — ${today} ${time}`,
    ``,
    `**Project:** ${context.projectName}`,
    `**Branch:** ${context.branch}`,
    ``,
    `> Session auto-saved. Use /handover for detailed session notes.`,
  ];

  const diffStat = git(["diff", "--stat", "HEAD"], context.projectRoot);
  if (diffStat) {
    markerLines.push("", "## Changes", "```", diffStat, "```");
  }

  const statusShort = git(["status", "-s"], context.projectRoot);
  if (statusShort) {
    markerLines.push("", "## Uncommitted", "```", statusShort, "```");
  }

  const marker = markerLines.join("\n");
  const dailyPath = writer.writeDailyLog(marker, today);

  const intelligenceStore = new IntelligenceStore(context.vaultPath);
  const collector = new Collector(intelligenceStore);
  const changedFiles = statusShort
    ? statusShort.split("\n").map((line) => line.slice(3).trim()).filter(Boolean)
    : [];
  if (changedFiles.length > 0) {
    collector.recordSession(context.branch, changedFiles);
    collector.recordCoEditedFiles(changedFiles);
    intelligenceStore.save();
  }

  const workflowState = new WorkflowState(context.vaultPath);
  const currentRun = workflowState.loadCurrent();
  if (currentRun && currentRun.status === "running") {
    currentRun.status = "paused";
    workflowState.save(currentRun);
  }

  output({
    status: "ok",
    message: `Session saved → ${dailyPath}`,
  });
}

function output(result: HookOutput): void {
  process.stdout.write(JSON.stringify(result));
}

run();
