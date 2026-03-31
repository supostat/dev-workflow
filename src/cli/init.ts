import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { detectContext } from "../lib/context.js";
import { VaultWriter } from "../lib/writer.js";
import { detectStack, renderStackMarkdown } from "../lib/stack-detect.js";
import { detectConventions, renderConventionsMarkdown } from "../lib/conventions-detect.js";

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
  // Resolve the path to hooks relative to project
  // When installed as dependency: node_modules/dev-workflow/dist/hooks/
  // When linked: direct path
  const hookBase = "node_modules/dev-workflow/dist/hooks";
  const statuslinePath = "node_modules/dev-workflow/dist/lib/statusline.js";
  const mcpServerPath = "node_modules/dev-workflow/dist/cli/serve.js";

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
    console.log(`Re-detecting stack and conventions for ${context.projectName}...`);
    runAutoDetect(context.projectName, context.vaultPath, projectRoot, true);
    return;
  }

  console.log(`Initializing dev-workflow in ${context.projectName}...`);

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
    console.log(`  create .claude/commands/`);
  }

  // 3. Copy agents from templates
  const agentsTemplateDir = join(PACKAGE_ROOT, "templates", "claude", "agents");
  const agentsTargetDir = join(projectRoot, ".claude", "agents");

  if (existsSync(agentsTemplateDir)) {
    cpSync(agentsTemplateDir, agentsTargetDir, { recursive: true, force: options.force });
    console.log(`  create .claude/agents/`);
  }

  // 4. Copy skills from templates
  const skillsTemplateDir = join(PACKAGE_ROOT, "templates", "claude", "skills");
  const skillsTargetDir = join(projectRoot, ".claude", "skills");

  if (existsSync(skillsTemplateDir)) {
    cpSync(skillsTemplateDir, skillsTargetDir, { recursive: true, force: options.force });
    console.log(`  create .claude/skills/`);
  }

  // 5. Scaffold .dev-vault/
  const writer = new VaultWriter(context);
  writer.scaffold();
  console.log(`  create .dev-vault/`);

  // 6. Auto-detect stack and conventions
  runAutoDetect(context.projectName, context.vaultPath, projectRoot, options.force);

  // 7. Update .gitignore
  ensureGitignoreEntries(projectRoot);

  console.log(`\nDone! Vault initialized for ${context.projectName}.`);
  console.log(`\nNext steps:`);
  console.log(`  1. Review .dev-vault/stack.md`);
  console.log(`  2. Fill .dev-vault/gameplan.md with your roadmap`);
  console.log(`  3. Start a Claude Code session — context loads automatically`);
}

function runAutoDetect(projectName: string, vaultPath: string, projectRoot: string, force: boolean): void {
  const stackPath = join(vaultPath, "stack.md");
  const stack = detectStack(projectRoot);
  const stackHasContent = stack.languages.length > 0 || stack.frameworks.length > 0;
  if (stackHasContent && (!existsSync(stackPath) || force)) {
    writeFileSync(stackPath, renderStackMarkdown(projectName, stack), "utf-8");
    console.log(`  detect stack.md (${stack.languages.length + stack.frameworks.length} items)`);
  }

  const conventionsPath = join(vaultPath, "conventions.md");
  const conventions = detectConventions(projectRoot);
  const conventionsHasContent = conventions.codeStyle.length > 0 || conventions.testing.length > 0;
  if (conventionsHasContent && (!existsSync(conventionsPath) || force)) {
    writeFileSync(conventionsPath, renderConventionsMarkdown(projectName, conventions), "utf-8");
    console.log(`  detect conventions.md (${conventions.codeStyle.length + conventions.testing.length} items)`);
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
