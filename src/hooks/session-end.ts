#!/usr/bin/env node

/**
 * SessionEnd / PreCompact hook — auto-save.
 * Saves minimal session marker to daily log and updates branch status.
 * Full handover with detailed notes is done via /handover command.
 */

import { detectContext } from "../lib/context.js";
import { VaultReader } from "../lib/reader.js";
import { VaultWriter } from "../lib/writer.js";
import type { HookOutput } from "../lib/types.js";

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

  const marker = [
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
  ].join("\n");

  const dailyPath = writer.writeDailyLog(marker, today);

  output({
    status: "ok",
    message: `Session saved → ${dailyPath}`,
  });
}

function output(result: HookOutput): void {
  process.stdout.write(JSON.stringify(result));
}

run();
