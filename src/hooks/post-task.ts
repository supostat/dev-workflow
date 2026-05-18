#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { detectContext } from "../lib/context.js";
import { VaultWriter } from "../lib/writer.js";
import { engramStore } from "../lib/engram.js";
import { existsSync } from "node:fs";
import { readStdin, hookSuccess } from "./stdin.js";

export async function run(): Promise<void> {
  const input = await readStdin();

  const context = detectContext(input.cwd);
  if (!context) {
    hookSuccess("Skipping post-task.");
    return;
  }

  if (!existsSync(context.vaultPath)) {
    hookSuccess("No vault.");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const subject = input.task_subject ?? "unknown task";

  const writer = new VaultWriter(context);
  writer.writeDailyLog(
    `> Task completed at ${time} on branch ${context.branch}: ${subject}`,
    today,
  );

  await engramStore(
    `Task completed: ${subject}`,
    `Branch: ${context.branch}`,
    `Completed at ${time}`,
    "context",
    [context.projectName, context.branch, "task"],
    context.projectName,
  );

  hookSuccess("Post-task recorded.");
}

const isMain = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  run().catch(() => {
    hookSuccess("Post-task hook failed silently.");
  });
}
