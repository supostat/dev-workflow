#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { detectContext } from "../lib/context.js";
import { writeFileSafe } from "../lib/fs-helpers.js";
import { IntelligenceStore } from "../intelligence/store.js";
import { Collector } from "../intelligence/collector.js";
import { readStdin, hookSuccess } from "./stdin.js";

async function run(): Promise<void> {
  const input = await readStdin();

  const context = detectContext(input.cwd);
  if (!context) {
    hookSuccess("Skipping post-edit.");
    return;
  }

  if (!existsSync(context.vaultPath)) {
    hookSuccess("No vault.");
    return;
  }

  const editLogPath = join(context.vaultPath, ".edit-log.json");

  let editLog: string[] = [];
  if (existsSync(editLogPath)) {
    try {
      editLog = JSON.parse(readFileSync(editLogPath, "utf-8")) as string[];
    } catch {
      editLog = [];
    }
  }

  const filePath = (input.tool_input?.["file_path"] as string) ?? "unknown";
  if (!editLog.includes(filePath)) {
    editLog.push(filePath);
  }

  writeFileSafe(editLogPath, JSON.stringify(editLog, null, 2));

  const intelligenceStore = new IntelligenceStore(context.vaultPath);
  const collector = new Collector(intelligenceStore);
  collector.recordFileEdit(filePath);
  intelligenceStore.save();

  hookSuccess(`Tracked: ${filePath} (${editLog.length} files this session)`);
}

run().catch(() => {
  hookSuccess("Post-edit hook failed silently.");
});
