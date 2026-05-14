import { existsSync, cpSync } from "node:fs";
import { join } from "node:path";
import { detectContext } from "../lib/context.js";
import { icon, keyValue } from "../lib/output.js";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { updateSkillsAdditively } from "../lib/skills-update.js";
import { getPackageVersion, writeLock } from "../lib/migration-lock.js";
import type { LockState } from "../lib/migration-lock.js";
import {
  detectLegacyCommands,
  cleanupLegacyCommands,
} from "../lib/legacy-commands-cleanup.js";

export interface UpdateOptions {
  /** Run cleanup of legacy `.claude/commands/` after detection. */
  cleanupLegacyCommands?: boolean;
  /** Suppress detection notice and any interactive prompts. */
  noInteractive?: boolean;
}

export function update(options: UpdateOptions = {}): void {
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
  const lockBumps: Partial<Omit<LockState, "version" | "updated_at">> = {};
  const packageVersion = getPackageVersion();

  const agentsTemplateDir = join(PACKAGE_ROOT, "templates", "claude", "agents");
  const agentsTargetDir = join(projectRoot, ".claude", "agents");
  if (existsSync(agentsTemplateDir)) {
    cpSync(agentsTemplateDir, agentsTargetDir, { recursive: true, force: true });
    console.log(keyValue("\u2713 agents/", "updated from package"));
    lockBumps.agents_version = packageVersion;
    updated++;
  }

  const skillsTemplateDir = join(PACKAGE_ROOT, "templates", "claude", "skills");
  const skillsTargetDir = join(projectRoot, ".claude", "skills");
  if (existsSync(skillsTemplateDir)) {
    const { added, skipped } = updateSkillsAdditively(skillsTemplateDir, skillsTargetDir);
    console.log(keyValue("\u2713 skills/", `${added} added, ${skipped} skipped (user-modified)`));
    lockBumps.skills_version = packageVersion;
    updated++;
  }

  if (Object.keys(lockBumps).length > 0) {
    writeLock(projectRoot, lockBumps);
    console.log(keyValue("\u2713 .dev-workflow.lock", `tracked at v${packageVersion}`));
  }

  const legacy = detectLegacyCommands(projectRoot);
  if (legacy) {
    if (options.cleanupLegacyCommands) {
      const result = cleanupLegacyCommands(legacy, projectRoot);
      console.log(keyValue("\u2713 legacy commands", `moved to ${result.backupPath}`));
      console.log(keyValue("\u2713 .dev-workflow.lock", "commands_version cleared"));
    } else if (!options.noInteractive) {
      process.stderr.write(
        `note: legacy .claude/commands/ detected (commands_version=${legacy.lockedVersion} in lock).\n` +
        `note: skills format superseded this directory; the bundled package no longer ships commands.\n` +
        `note: to move it to a timestamped backup, re-run with --cleanup-legacy-commands.\n`,
      );
    }
  }

  console.log(`\n${icon.tip} Updated ${updated} components. Vault data untouched.`);
}
