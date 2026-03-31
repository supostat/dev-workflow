#!/usr/bin/env node

/**
 * StatusLine — shows current project, branch, and vault status in Claude Code.
 */

import { detectContext } from "./context.js";
import { VaultReader } from "./reader.js";

function run(): void {
  const context = detectContext();
  if (!context) {
    process.stdout.write("");
    return;
  }

  const reader = new VaultReader(context);
  const parts: string[] = [];

  parts.push(context.projectName);
  parts.push(context.branch);

  if (reader.exists()) {
    const branch = reader.readBranch(context.branch);
    if (branch) {
      parts.push(branch.status);
    }
  } else {
    parts.push("no vault");
  }

  process.stdout.write(parts.join(" | "));
}

run();
