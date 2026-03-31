#!/usr/bin/env node

/**
 * SessionStart hook — auto-resume.
 * Detects project context, loads vault data, outputs structured context
 * for Claude Code to consume as system prompt.
 */

import { detectContext } from "../lib/context.js";
import { VaultReader } from "../lib/reader.js";
import type { HookOutput } from "../lib/types.js";

function run(): void {
  const context = detectContext();
  if (!context) {
    output({ status: "ok", message: "Not a git repository, skipping vault resume." });
    return;
  }

  const reader = new VaultReader(context);
  if (!reader.exists()) {
    output({ status: "ok", message: `No .dev-vault/ found in ${context.projectName}. Run 'dev-vault init' to set up.` });
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
  }

  if (vaultData.recentDailyLogs.length > 0) {
    const latest = vaultData.recentDailyLogs[0];
    if (latest) {
      sections.push(
        `\n## Last Session (${latest.date})\n` + truncate(latest.content, 1500),
      );
    }
  }

  output({
    status: "ok",
    message: sections.join("\n"),
    context: vaultData,
  });
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "\n\n... (truncated)";
}

function output(result: HookOutput): void {
  process.stdout.write(JSON.stringify(result));
}

run();
