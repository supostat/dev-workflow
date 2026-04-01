import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { detectContext } from "../lib/context.js";
import { VaultReader } from "../lib/reader.js";
import { TaskManager } from "../tasks/manager.js";
import { AgentRegistry } from "../agents/registry.js";
import { getBuiltinWorkflows } from "../workflow/builtin.js";
import { icon } from "../lib/output.js";

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

const VALID_HOOK_EVENTS = new Set([
  "PreToolUse", "PostToolUse", "PostToolUseFailure", "Notification",
  "UserPromptSubmit", "SessionStart", "SessionEnd", "Stop", "StopFailure",
  "SubagentStart", "SubagentStop", "PreCompact", "PostCompact",
  "PermissionRequest", "PermissionDenied", "Setup", "TeammateIdle",
  "TaskCreated", "TaskCompleted", "Elicitation", "ElicitationResult",
  "ConfigChange", "WorktreeCreate", "WorktreeRemove",
  "InstructionsLoaded", "CwdChanged", "FileChanged",
]);

export function doctor(fix: boolean = false): void {
  const context = detectContext();
  if (!context) {
    console.error("Not a git repository.");
    process.exitCode = 1;
    return;
  }

  console.log(`\n${icon.doctor} dev-workflow doctor\n`);

  const issues: string[] = [];
  const reader = new VaultReader(context);

  // Vault
  if (reader.exists()) {
    console.log(`  ${icon.success} Vault           .dev-vault/ exists`);
  } else {
    console.log(`  ${icon.error} Vault           .dev-vault/ MISSING`);
    issues.push("Vault not initialized — run 'dev-workflow init'");
    printIssues(issues);
    return;
  }

  // Vault files
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
      console.log(`  ${icon.error} ${label.padEnd(16)} missing`);
      issues.push(`${filename} is missing`);
    } else if (frontmatterOnly) {
      console.log(`  ${icon.warning} ${label.padEnd(16)} empty (frontmatter only)`);
      issues.push(`${filename} is empty \u2014 fill for better agent context`);
    } else {
      console.log(`  ${icon.success} ${label.padEnd(16)} filled (${lines} lines)`);
    }
  }

  // Agents
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

  // Tasks
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

  // Workflows
  const builtinCount = getBuiltinWorkflows().length;
  const customCount = countCustomWorkflows(context.vaultPath);
  console.log(`  Workflows:     ${builtinCount} builtin${customCount > 0 ? ` + ${customCount} custom` : ""}`);

  // CLAUDE.md
  const claudeMdPath = join(context.projectRoot, "CLAUDE.md");
  if (existsSync(claudeMdPath)) {
    console.log(`  ${icon.success} CLAUDE.md       exists`);
  } else {
    console.log(`  ${icon.warning} CLAUDE.md       MISSING`);
    issues.push("CLAUDE.md not found — run 'dev-workflow init'");
  }

  // .mcp.json
  const mcpJsonPath = join(context.projectRoot, ".mcp.json");
  if (existsSync(mcpJsonPath)) {
    try {
      const mcpConfig = JSON.parse(readFileSync(mcpJsonPath, "utf-8")) as Record<string, unknown>;
      const servers = mcpConfig["mcpServers"] as Record<string, unknown> | undefined;
      if (servers?.["dev-workflow"]) {
        console.log(`  ${icon.success} .mcp.json       dev-workflow configured`);
      } else {
        console.log(`  ${icon.warning} .mcp.json       exists but dev-workflow missing`);
        issues.push(".mcp.json exists but dev-workflow server not configured");
      }
    } catch {
      console.log(`  ${icon.error} .mcp.json       invalid JSON`);
      issues.push(".mcp.json is not valid JSON");
    }
  } else {
    console.log(`  ${icon.error} .mcp.json       MISSING`);
    issues.push(".mcp.json not found — run 'dev-workflow init'");
  }

  // settings.json + hooks validation
  const settingsPath = join(context.projectRoot, ".claude", "settings.json");
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
      const hooks = settings["hooks"] as Record<string, unknown> | undefined;

      if (hooks) {
        const invalidEvents = Object.keys(hooks).filter((e) => !VALID_HOOK_EVENTS.has(e));
        if (invalidEvents.length > 0) {
          console.log(`  ${icon.error} Hooks           invalid events: ${invalidEvents.join(", ")}`);
          issues.push(`Invalid hook events: ${invalidEvents.join(", ")} — valid: SessionStart, SessionEnd, PostToolUse, TaskCompleted, PreCompact`);
        } else {
          console.log(`  ${icon.success} Hooks           ${Object.keys(hooks).length} events configured`);
        }

        for (const [eventName, eventConfigs] of Object.entries(hooks)) {
          const configs = eventConfigs as Array<{ hooks?: Array<{ command?: string }> }>;
          for (const config of configs) {
            for (const hook of config.hooks ?? []) {
              if (hook.command) {
                const nodePath = hook.command.replace(/^node\s+/, "").split(" ")[0]!;
                if (!existsSync(nodePath)) {
                  console.log(`  ${icon.error} Hook path       ${eventName}: file not found`);
                  issues.push(`Hook ${eventName}: ${nodePath} does not exist — run 'dev-workflow init --force'`);
                }
              }
            }
          }
        }
      } else {
        console.log(`  ${icon.warning} Hooks           none configured`);
        issues.push("No hooks in settings.json — run 'dev-workflow init'");
      }

      const perms = settings["permissions"] as Record<string, unknown> | undefined;
      if (perms) {
        const allowCount = (perms["allow"] as string[] | undefined)?.length ?? 0;
        const denyCount = (perms["deny"] as string[] | undefined)?.length ?? 0;
        console.log(`  ${icon.success} Permissions     ${allowCount} allow, ${denyCount} deny`);
      } else {
        console.log(`  ${icon.warning} Permissions     none configured`);
        issues.push("No permissions in settings.json — run 'dev-workflow init --force'");
      }
    } catch {
      console.log(`  ${icon.error} Settings        invalid JSON`);
      issues.push(".claude/settings.json is not valid JSON");
    }
  } else {
    console.log(`  ${icon.error} Settings        .claude/settings.json MISSING`);
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
