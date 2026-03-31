#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { detectContext } from "../lib/context.js";
import { writeFileSafe } from "../lib/fs-helpers.js";
import type { HookOutput } from "../lib/types.js";

function run(): void {
  const context = detectContext();
  if (!context) {
    output({ status: "ok", message: "Skipping post-edit." });
    return;
  }

  if (!existsSync(context.vaultPath)) {
    output({ status: "ok", message: "No vault." });
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

  const filePath = process.env["CLAUDE_FILE_PATH"] ?? "unknown";
  if (!editLog.includes(filePath)) {
    editLog.push(filePath);
  }

  writeFileSafe(editLogPath, JSON.stringify(editLog, null, 2));

  output({ status: "ok", message: `Tracked: ${filePath} (${editLog.length} files this session)` });
}

function output(result: HookOutput): void {
  process.stdout.write(JSON.stringify(result));
}

run();
