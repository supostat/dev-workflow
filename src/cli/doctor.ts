import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { detectContext } from "../lib/context.js";
import { VaultReader } from "../lib/reader.js";
import { TaskManager } from "../tasks/manager.js";
import { AgentRegistry } from "../agents/registry.js";
import { getBuiltinWorkflows } from "../workflow/builtin.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function fileLineCount(filepath: string): number {
  if (!existsSync(filepath)) return 0;
  return readFileSync(filepath, "utf-8").split("\n").length;
}

function countCustomWorkflows(vaultPath: string): number {
  const workflowsDir = join(vaultPath, "workflows");
  if (!existsSync(workflowsDir)) return 0;
  return readdirSync(workflowsDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).length;
}

export function doctor(fix: boolean = false): void {
  const context = detectContext();
  if (!context) {
    console.error("Not a git repository.");
    process.exitCode = 1;
    return;
  }

  console.log("dev-workflow doctor\n");

  const issues: string[] = [];
  const reader = new VaultReader(context);

  if (reader.exists()) {
    console.log(`  Vault:         .dev-vault/ exists`);
  } else {
    console.log(`  Vault:         .dev-vault/ MISSING`);
    issues.push("Vault not initialized — run 'dev-workflow init'");
    printIssues(issues);
    return;
  }

  const vaultFiles: Array<[string, string]> = [
    ["stack.md", "stack"],
    ["conventions.md", "conventions"],
    ["knowledge.md", "knowledge"],
    ["gameplan.md", "gameplan"],
  ];

  for (const [filename, label] of vaultFiles) {
    const lines = fileLineCount(join(context.vaultPath, filename));
    const frontmatterOnly = lines <= 8;
    if (lines === 0) {
      console.log(`  ${label.padEnd(16)} missing`);
      issues.push(`${filename} is missing`);
    } else if (frontmatterOnly) {
      console.log(`  ${label.padEnd(16)} empty (${lines} lines, frontmatter only)`);
      issues.push(`${filename} is empty — fill it for better agent context`);
    } else {
      console.log(`  ${label.padEnd(16)} filled (${lines} lines)`);
    }
  }

  const agentsDir = join(PACKAGE_ROOT, "templates", "agents");
  const customAgentsDir = join(context.vaultPath, "agents");
  try {
    const registry = new AgentRegistry(agentsDir, customAgentsDir);
    const agents = registry.list();
    console.log(`  Agents:        ${agents.length} loaded (${agents.map((a) => a.name).join(", ")})`);
  } catch {
    console.log(`  Agents:        FAILED to load`);
    issues.push("Agent loading failed — check templates/agents/");
  }

  const taskManager = new TaskManager(context.vaultPath);
  const tasks = taskManager.list();
  if (tasks.length > 0) {
    const statusCounts: Record<string, number> = {};
    for (const t of tasks) {
      statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1;
    }
    const summary = Object.entries(statusCounts).map(([s, c]) => `${c} ${s}`).join(", ");
    console.log(`  Tasks:         ${tasks.length} total (${summary})`);
  } else {
    console.log(`  Tasks:         none`);
  }

  const builtinCount = getBuiltinWorkflows().length;
  const customCount = countCustomWorkflows(context.vaultPath);
  console.log(`  Workflows:     ${builtinCount} builtin${customCount > 0 ? ` + ${customCount} custom` : ""}`);

  const settingsPath = join(context.projectRoot, ".claude", "settings.json");
  if (existsSync(settingsPath)) {
    const settings = readFileSync(settingsPath, "utf-8");
    const hasMcp = settings.includes("dev-workflow");
    console.log(`  MCP config:    .claude/settings.json${hasMcp ? " — configured" : " — missing MCP config"}`);
    if (!hasMcp) issues.push("MCP server not configured in .claude/settings.json — re-run 'dev-workflow init --force'");
  } else {
    console.log(`  MCP config:    .claude/settings.json MISSING`);
    issues.push("Settings not found — run 'dev-workflow init'");
  }

  if (fix && issues.length > 0) {
    console.log("\n  Fixing...");
    const { init } = require("./init.js") as typeof import("./init.js");
    init({ force: true, detectOnly: false });
    console.log("  Fixed: re-ran init --force");
  } else {
    printIssues(issues);
  }
}

function printIssues(issues: string[]): void {
  if (issues.length > 0) {
    console.log("\n  Issues:");
    for (const issue of issues) {
      console.log(`    - ${issue}`);
    }
    console.log("\n  Run 'dev-workflow doctor --fix' to auto-fix.");
  } else {
    console.log("\n  All checks passed.");
  }
}
