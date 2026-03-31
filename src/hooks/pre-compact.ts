#!/usr/bin/env node

/**
 * PreCompact hook — save context before Claude Code compresses history.
 * Delegates to session-end logic.
 */

import { detectContext } from "../lib/context.js";
import { VaultReader } from "../lib/reader.js";
import { VaultWriter } from "../lib/writer.js";
import type { HookOutput } from "../lib/types.js";

function run(): void {
  const context = detectContext();
  if (!context) {
    output({ status: "ok", message: "Skipping pre-compact save." });
    return;
  }

  const reader = new VaultReader(context);
  if (!reader.exists()) {
    output({ status: "ok", message: "No vault, skipping." });
    return;
  }

  const writer = new VaultWriter(context);
  const today = new Date().toISOString().slice(0, 10);
  const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const marker = [
    `> [!note] Pre-compact auto-save — ${time}`,
    `> Context was compressed. Use /resume to reload full vault context.`,
  ].join("\n");

  writer.writeDailyLog(marker, today);

  output({ status: "ok", message: "Pre-compact save done." });
}

function output(result: HookOutput): void {
  process.stdout.write(JSON.stringify(result));
}

run();
