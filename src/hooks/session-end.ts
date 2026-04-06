#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { detectContext } from "../lib/context.js";
import { VaultReader } from "../lib/reader.js";
import { VaultWriter } from "../lib/writer.js";
import { WorkflowState } from "../workflow/state.js";
import { engramStore } from "../lib/engram.js";
import { readStdin, hookSuccess } from "./stdin.js";

function git(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

async function run(): Promise<void> {
  const input = await readStdin();

  const context = detectContext(input.cwd);
  if (!context) {
    hookSuccess("Not a git repository, skipping.");
    return;
  }

  const reader = new VaultReader(context);
  if (!reader.exists()) {
    hookSuccess("No vault found, skipping.");
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
  writer.writeDailyLog(marker, today);

  const changedFiles = statusShort
    ? statusShort.split("\n").map((line) => line.slice(3).trim()).filter(Boolean)
    : [];
  const fileCount = changedFiles.length;
  if (fileCount > 0) {
    await engramStore(
      `Session on ${context.branch}: ${fileCount} files changed`,
      `Changed: ${changedFiles.slice(0, 10).join(", ")}`,
      statusShort ? `Status: ${statusShort.split("\n").length} uncommitted` : "Clean",
      "context",
      `${context.projectName},${context.branch},session`,
      context.projectName,
    );
  }

  const workflowState = new WorkflowState(context.vaultPath);
  const currentRun = workflowState.loadCurrent();
  if (currentRun && currentRun.status === "running") {
    currentRun.status = "paused";
    workflowState.save(currentRun);
  }

  hookSuccess("Session saved.");
}

run().catch(() => {
  hookSuccess("Session end hook failed silently.");
});
