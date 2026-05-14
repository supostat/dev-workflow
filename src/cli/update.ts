import { existsSync, cpSync } from "node:fs";
import { join } from "node:path";
import { detectContext } from "../lib/context.js";
import { icon, keyValue } from "../lib/output.js";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { updateSkillsAdditively } from "../lib/skills-update.js";

export function update(): void {
  const context = detectContext();
  if (!context) {
    console.error("Not a git repository.");
    process.exitCode = 1;
    return;
  }

  const projectRoot = context.projectRoot;

  if (!existsSync(join(projectRoot, ".dev-vault"))) {
    console.error("No vault found. Run 'dev-workflow init' first.");
    process.exitCode = 1;
    return;
  }

  console.log(`\n${icon.init} dev-workflow update \u2014 ${context.projectName}\n`);

  let updated = 0;

  const commandsTemplateDir = join(PACKAGE_ROOT, "templates", "claude", "commands");
  const commandsTargetDir = join(projectRoot, ".claude", "commands");
  if (existsSync(commandsTemplateDir)) {
    cpSync(commandsTemplateDir, commandsTargetDir, { recursive: true, force: true });
    console.log(keyValue("\u2713 commands/", "updated from package"));
    updated++;
  }

  const agentsTemplateDir = join(PACKAGE_ROOT, "templates", "claude", "agents");
  const agentsTargetDir = join(projectRoot, ".claude", "agents");
  if (existsSync(agentsTemplateDir)) {
    cpSync(agentsTemplateDir, agentsTargetDir, { recursive: true, force: true });
    console.log(keyValue("\u2713 agents/", "updated from package"));
    updated++;
  }

  const skillsTemplateDir = join(PACKAGE_ROOT, "templates", "claude", "skills");
  const skillsTargetDir = join(projectRoot, ".claude", "skills");
  if (existsSync(skillsTemplateDir)) {
    const { added, skipped } = updateSkillsAdditively(skillsTemplateDir, skillsTargetDir);
    console.log(keyValue("\u2713 skills/", `${added} added, ${skipped} skipped (user-modified)`));
    updated++;
  }

  console.log(`\n${icon.tip} Updated ${updated} components. Vault data untouched.`);
}
