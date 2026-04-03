#!/usr/bin/env node

import { detectContext } from "../lib/context.js";
import { VaultReader } from "../lib/reader.js";
import { VaultWriter } from "../lib/writer.js";
import { engramStore } from "../lib/engram.js";
import { readStdin, hookSuccess } from "./stdin.js";

async function run(): Promise<void> {
  const input = await readStdin();

  const context = detectContext(input.cwd);
  if (!context) {
    hookSuccess("Skipping pre-compact save.");
    return;
  }

  const reader = new VaultReader(context);
  if (!reader.exists()) {
    hookSuccess("No vault, skipping.");
    return;
  }

  const writer = new VaultWriter(context);
  const today = new Date().toISOString().slice(0, 10);
  const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const trigger = input.compaction_trigger ?? "unknown";

  const marker = [
    `> [!note] Pre-compact auto-save — ${time} (${trigger})`,
    `> Context was compressed. Use /resume to reload full vault context.`,
  ].join("\n");

  writer.writeDailyLog(marker, today);

  await engramStore(
    `Pre-compact snapshot on ${context.branch} (${trigger})`,
    `Context compressed at ${time}`,
    `Project: ${context.projectName}, branch: ${context.branch}`,
    "context",
    `${context.projectName},${context.branch},pre-compact`,
    context.projectName,
  );

  hookSuccess("Pre-compact save done.");
}

run().catch(() => {
  hookSuccess("Pre-compact hook failed silently.");
});
