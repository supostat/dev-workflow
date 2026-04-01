import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { detectContext } from "../lib/context.js";
import { VaultWriter } from "../lib/writer.js";
import { detectStack, renderStackMarkdown } from "../lib/stack-detect.js";
import { detectConventions, renderConventionsMarkdown } from "../lib/conventions-detect.js";
import { icon, section, keyValue } from "../lib/output.js";
import { renderTemplate } from "../lib/templates.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface InitOptions {
  force: boolean;
  detectOnly?: boolean;
}

function writeIfMissing(filepath: string, content: string, force: boolean): boolean {
  if (existsSync(filepath) && !force) {
    console.log(`  skip ${filepath} (exists)`);
    return false;
  }
  mkdirSync(dirname(filepath), { recursive: true });
  writeFileSync(filepath, content, "utf-8");
  console.log(`  create ${filepath}`);
  return true;
}

function mergeSettingsJson(filepath: string, newSettings: Record<string, unknown>): void {
  let existing: Record<string, unknown> = {};
  if (existsSync(filepath)) {
    try {
      existing = JSON.parse(readFileSync(filepath, "utf-8")) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }

  const existingHooks = (existing["hooks"] ?? {}) as Record<string, unknown[]>;
  const newHooks = (newSettings["hooks"] ?? {}) as Record<string, unknown[]>;
  const mergedHooks = { ...existingHooks };
  for (const [event, configs] of Object.entries(newHooks)) {
    const existingConfigs = mergedHooks[event] ?? [];
    const newCommands = new Set(
      configs.map((c) => JSON.stringify((c as Record<string, unknown>)["hooks"] ?? c)),
    );
    const filtered = existingConfigs.filter(
      (c) => !newCommands.has(JSON.stringify((c as Record<string, unknown>)["hooks"] ?? c)),
    );
    mergedHooks[event] = [...filtered, ...configs];
  }

  const existingPerms = (existing["permissions"] ?? {}) as Record<string, unknown>;
  const newPerms = (newSettings["permissions"] ?? {}) as Record<string, unknown>;
  const existingAllow = (existingPerms["allow"] ?? []) as string[];
  const newAllow = (newPerms["allow"] ?? []) as string[];
  const existingDeny = (existingPerms["deny"] ?? []) as string[];
  const newDeny = (newPerms["deny"] ?? []) as string[];
  const mergedPerms = {
    allow: [...new Set([...existingAllow, ...newAllow])],
    deny: [...new Set([...existingDeny, ...newDeny])],
  };

  const merged = {
    ...existing,
    hooks: mergedHooks,
    permissions: mergedPerms,
    statusLine: newSettings["statusLine"],
  };

  mkdirSync(dirname(filepath), { recursive: true });
  writeFileSync(filepath, JSON.stringify(merged, null, 2), "utf-8");
}

function buildSettingsJson(): string {
  // Resolve paths from the actual package location (works for npm link, global, and local installs)
  const distDir = join(PACKAGE_ROOT, "dist");
  const hookBase = join(distDir, "hooks");
  const statuslinePath = join(distDir, "lib", "statusline.js");
  return JSON.stringify({
    hooks: {
      SessionStart: [{
        hooks: [{
          type: "command",
          command: `node ${hookBase}/session-start.js`,
          timeout: 10000,
        }],
      }],
      SessionEnd: [{
        hooks: [{
          type: "command",
          command: `node ${hookBase}/session-end.js`,
          timeout: 10000,
        }],
      }],
      PostToolUse: [{
        matcher: "Write|Edit|MultiEdit",
        hooks: [{
          type: "command",
          command: `node ${hookBase}/post-edit.js`,
          timeout: 5000,
        }],
      }],
      TaskCompleted: [{
        hooks: [{
          type: "command",
          command: `node ${hookBase}/post-task.js`,
          timeout: 5000,
        }],
      }],
      PreCompact: [
        {
          matcher: "auto",
          hooks: [{
            type: "command",
            command: `node ${hookBase}/pre-compact.js`,
            timeout: 8000,
          }],
        },
        {
          matcher: "manual",
          hooks: [{
            type: "command",
            command: `node ${hookBase}/pre-compact.js`,
            timeout: 8000,
          }],
        },
      ],
    },
    permissions: {
      allow: [
        "Read",
        "Edit",
        "Write",
        "Bash(npm test)",
        "Bash(npm run *)",
        "Bash(npx *)",
        "Bash(pnpm test)",
        "Bash(pnpm run *)",
        "Bash(node *)",
        "Bash(git status*)",
        "Bash(git diff*)",
        "Bash(git log*)",
        "Bash(git branch*)",
        "Bash(git add *)",
        "Bash(git commit *)",
        "Bash(git stash *)",
        "Bash(ls *)",
        "Bash(cat *)",
        "Bash(pwd)",
        "Bash(wc *)",
        "Agent",
        "mcp__dev-workflow__*",
      ],
      deny: [
        "Read(./.env)",
        "Read(./.env.*)",
        "Bash(git push *)",
        "Bash(git reset --hard*)",
        "Bash(rm -rf *)",
      ],
    },
    statusLine: {
      type: "command",
      command: `node ${statuslinePath}`,
    },
  }, null, 2);
}

export function init(options: InitOptions): void {
  const context = detectContext();
  if (!context) {
    console.error("Error: not a git repository. Run 'git init' first.");
    process.exitCode = 1;
    return;
  }

  const projectRoot = context.projectRoot;

  if (options.detectOnly) {
    console.log(`${icon.search} Re-detecting stack and conventions for ${context.projectName}...`);
    runAutoDetect(context.projectName, context.vaultPath, projectRoot, true);
    return;
  }

  console.log(`\n${icon.init} dev-workflow init \u2014 ${context.projectName}\n`);

  // 0. Create CLAUDE.md
  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  if (writeIfMissing(claudeMdPath, renderTemplate("project/claude-md", { projectName: context.projectName }), options.force)) {
    console.log(keyValue("\u2713 CLAUDE.md", "project instructions for Claude Code"));
  }

  // 1. Merge .claude/settings.json (hooks + permissions + statusLine)
  const settingsPath = join(projectRoot, ".claude", "settings.json");
  const newSettings = JSON.parse(buildSettingsJson()) as Record<string, unknown>;
  mergeSettingsJson(settingsPath, newSettings);
  console.log(`  merge ${settingsPath}`);

  // 1b. Create .mcp.json (MCP server — Claude Code reads this for MCP discovery)
  const mcpEntryPath = join(PACKAGE_ROOT, "dist", "cli", "index.js");
  writeIfMissing(
    join(projectRoot, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        "dev-workflow": {
          command: "node",
          args: [mcpEntryPath, "serve"],
        },
      },
    }, null, 2),
    options.force,
  );

  // 2. Copy commands from templates
  const commandsTemplateDir = join(PACKAGE_ROOT, "templates", "claude", "commands");
  const commandsTargetDir = join(projectRoot, ".claude", "commands");

  if (existsSync(commandsTemplateDir)) {
    cpSync(commandsTemplateDir, commandsTargetDir, { recursive: true, force: options.force });
  }

  const agentsTemplateDir = join(PACKAGE_ROOT, "templates", "claude", "agents");
  const agentsTargetDir = join(projectRoot, ".claude", "agents");
  if (existsSync(agentsTemplateDir)) {
    cpSync(agentsTemplateDir, agentsTargetDir, { recursive: true, force: options.force });
  }

  const skillsTemplateDir = join(PACKAGE_ROOT, "templates", "claude", "skills");
  const skillsTargetDir = join(projectRoot, ".claude", "skills");
  if (existsSync(skillsTemplateDir)) {
    cpSync(skillsTemplateDir, skillsTargetDir, { recursive: true, force: options.force });
  }

  console.log(section(icon.vault, "Claude Code"));
  console.log(keyValue("\u2713 settings.json", "hooks + MCP configured"));
  console.log(keyValue("\u2713 commands/", "17 commands installed"));
  console.log(keyValue("\u2713 agents/", "2 agents installed"));

  const writer = new VaultWriter(context);
  writer.scaffold();

  console.log(section(icon.vault, "Vault"));
  runAutoDetect(context.projectName, context.vaultPath, projectRoot, options.force);

  const knowledgeLines = existsSync(join(context.vaultPath, "knowledge.md"))
    ? readFileSync(join(context.vaultPath, "knowledge.md"), "utf-8").split("\n").length
    : 0;
  const gameplanLines = existsSync(join(context.vaultPath, "gameplan.md"))
    ? readFileSync(join(context.vaultPath, "gameplan.md"), "utf-8").split("\n").length
    : 0;

  console.log(keyValue(knowledgeLines > 8 ? "\u2713 knowledge.md" : "\u25CB knowledge.md",
    knowledgeLines > 8 ? `${knowledgeLines} lines` : "empty \u2014 use /vault:analyze"));
  console.log(keyValue(gameplanLines > 8 ? "\u2713 gameplan.md" : "\u25CB gameplan.md",
    gameplanLines > 8 ? `${gameplanLines} lines` : "empty \u2014 fill manually"));

  const detectedStack = detectStack(projectRoot);
  ensureGitignoreEntries(projectRoot, detectedStack);

  console.log(`\n${icon.tip} Next: /vault:analyze for deep codebase analysis`);
}

function runAutoDetect(projectName: string, vaultPath: string, projectRoot: string, force: boolean): void {
  const stackPath = join(vaultPath, "stack.md");
  const stack = detectStack(projectRoot);
  const stackHasContent = stack.languages.length > 0 || stack.frameworks.length > 0;
  if (stackHasContent && (!existsSync(stackPath) || force)) {
    writeFileSync(stackPath, renderStackMarkdown(projectName, stack), "utf-8");
    const stackCount = stack.languages.length + stack.frameworks.length;
    console.log(keyValue("\u2713 stack.md", `${stackCount} technologies detected`));
  } else {
    console.log(keyValue("\u25CB stack.md", "no technologies detected"));
  }

  const conventionsPath = join(vaultPath, "conventions.md");
  const conventions = detectConventions(projectRoot);
  const conventionsHasContent = conventions.codeStyle.length > 0 || conventions.testing.length > 0;
  if (conventionsHasContent && (!existsSync(conventionsPath) || force)) {
    writeFileSync(conventionsPath, renderConventionsMarkdown(projectName, conventions), "utf-8");
    const conventionsCount = conventions.codeStyle.length + conventions.testing.length + conventions.git.length;
    console.log(keyValue("\u2713 conventions.md", `${conventionsCount} rules detected`));
  } else {
    console.log(keyValue("\u25CB conventions.md", "no rules detected"));
  }
}

function ensureGitignoreEntries(projectRoot: string, stack: ReturnType<typeof detectStack>): void {
  const gitignorePath = join(projectRoot, ".gitignore");

  const devWorkflowEntries = [
    ".dev-vault/daily/",
    ".dev-vault/branches/",
    ".dev-vault/.edit-log.json",
    ".dev-vault/.intelligence.json",
  ];

  const stackEntries: string[] = [];
  const allLangs = stack.languages.map((l) => l.toLowerCase());
  const allFrameworks = stack.frameworks.map((f) => f.toLowerCase());

  const hasLang = (keyword: string) => allLangs.some((l) => l.includes(keyword));
  const hasFramework = (keyword: string) => allFrameworks.some((f) => f.includes(keyword));

  // Universal
  stackEntries.push(".DS_Store", "*.swp", "*.swo", "*~", "coverage/", ".env", ".env.*");

  // Node / TypeScript
  if (hasLang("typescript") || hasLang("node") || existsSync(join(projectRoot, "package.json"))) {
    stackEntries.push("node_modules/", "dist/", "*.tsbuildinfo", ".turbo/");
  }

  // Next.js
  if (hasFramework("next")) {
    stackEntries.push(".next/", "out/");
  }

  // Rust
  if (hasLang("rust") || existsSync(join(projectRoot, "Cargo.toml"))) {
    stackEntries.push("target/");
  }

  // Python
  if (hasLang("python") || existsSync(join(projectRoot, "pyproject.toml")) || existsSync(join(projectRoot, "requirements.txt"))) {
    stackEntries.push("__pycache__/", "*.pyc", ".venv/", "*.egg-info/");
  }

  // Go
  if (hasLang("go")) {
    stackEntries.push("bin/");
  }

  let content = "";
  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, "utf-8");
  }

  const missingDevWorkflow = devWorkflowEntries.filter((e) => !content.includes(e));
  const missingStack = stackEntries.filter((e) => !content.includes(e));

  const additions: string[] = [];
  if (missingDevWorkflow.length > 0) {
    additions.push("# dev-workflow (session data)", ...missingDevWorkflow);
  }
  if (missingStack.length > 0) {
    additions.push("# dev-workflow (stack-detected)", ...missingStack);
  }

  if (additions.length === 0) return;

  writeFileSync(gitignorePath, content.trimEnd() + "\n\n" + additions.join("\n") + "\n", "utf-8");
  console.log(`  update .gitignore (+${missingDevWorkflow.length + missingStack.length} entries)`);
}
