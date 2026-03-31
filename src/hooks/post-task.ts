#!/usr/bin/env node

import { detectContext } from "../lib/context.js";
import { VaultWriter } from "../lib/writer.js";
import type { HookOutput } from "../lib/types.js";
import { existsSync } from "node:fs";

function run(): void {
  const context = detectContext();
  if (!context) {
    output({ status: "ok", message: "Skipping post-task." });
    return;
  }

  if (!existsSync(context.vaultPath)) {
    output({ status: "ok", message: "No vault." });
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const writer = new VaultWriter(context);
  writer.writeDailyLog(
    `> Task completed at ${time} on branch ${context.branch}`,
    today,
  );

  output({ status: "ok", message: "Post-task recorded." });
}

function output(result: HookOutput): void {
  process.stdout.write(JSON.stringify(result));
}

run();
