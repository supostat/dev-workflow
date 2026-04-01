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

function buildSettingsJson(): string {
  // Resolve paths from the actual package location (works for npm link, global, and local installs)
  const distDir = join(PACKAGE_ROOT, "dist");
  const hookBase = join(distDir, "hooks");
  const statuslinePath = join(distDir, "lib", "statusline.js");
  const mcpServerPath = join(distDir, "cli", "serve.js");

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
      PostEdit: [{
        hooks: [{
          type: "command",
          command: `node ${hookBase}/post-edit.js`,
          timeout: 5000,
        }],
      }],
      PostTask: [{
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
    statusLine: {
      type: "command",
      command: `node ${statuslinePath}`,
    },
    mcpServers: {
      "dev-workflow": {
        command: "node",
        args: [mcpServerPath],
      },
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

  // 1. Create .claude/settings.json
  writeIfMissing(
    join(projectRoot, ".claude", "settings.json"),
    buildSettingsJson(),
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

  ensureGitignoreEntries(projectRoot);

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

function ensureGitignoreEntries(projectRoot: string): void {
  const gitignorePath = join(projectRoot, ".gitignore");
  const entries = [".dev-vault/daily/", ".dev-vault/branches/"];

  let content = "";
  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, "utf-8");
  }

  const missing = entries.filter((entry) => !content.includes(entry));
  if (missing.length === 0) return;

  const addition = "\n# dev-workflow (auto-generated session data)\n" + missing.join("\n") + "\n";
  writeFileSync(gitignorePath, content.trimEnd() + "\n" + addition, "utf-8");
  console.log(`  update .gitignore`);
}
