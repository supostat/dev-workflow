import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { readLock, clearLockField } from "./migration-lock.js";

/**
 * Detection + cleanup for legacy `.claude/commands/` directories left over
 * from dev-workflow ≤ v1.x. After v2.0.0 (task-041) the bundled package no
 * longer ships `templates/claude/commands/`, but existing user projects
 * still have populated `.claude/commands/` from earlier installs.
 *
 * Cleanup strategy: rename the directory to a timestamped backup. Zero
 * data-loss risk — user reviews + deletes manually. No per-version
 * sha256 manifest is shipped because:
 *
 *   - The universe of legacy bundled commands is closed (v2.0.0 removed
 *     all 47 files; no future shipping plan reintroduces them).
 *   - Shipping a hash manifest creates drift risk: stale hashes would
 *     silently delete user-modified files.
 *   - Backup-rename is reversible via `mv` (user undo path is trivial).
 */

export interface LegacyCommandsState {
  /** Version recorded in lock.commands_version (the version that wrote this dir). */
  lockedVersion: string;
  /** Absolute path to the legacy directory still present on disk. */
  commandsDir: string;
}

export interface CleanupResult {
  /** Absolute path the legacy directory was moved to. */
  backupPath: string;
  /** True iff lock had commands_version and it was cleared. */
  lockCleared: boolean;
}

/**
 * Returns state object when BOTH conditions hold:
 *   1. `.dev-workflow.lock` has a non-empty `commands_version` field
 *   2. `<projectRoot>/.claude/commands/` directory exists on disk
 *
 * Either signal alone is insufficient: a stale lock without the directory
 * means the user already cleaned up manually; a directory without lock
 * means the install predates lock tracking (v1.0.x or earlier).
 */
export function detectLegacyCommands(projectRoot: string): LegacyCommandsState | null {
  const lock = readLock(projectRoot);
  if (!lock?.commands_version) return null;
  const commandsDir = join(projectRoot, ".claude", "commands");
  if (!existsSync(commandsDir)) return null;
  return { lockedVersion: lock.commands_version, commandsDir };
}

/**
 * Rename `<projectRoot>/.claude/commands/` to
 * `<projectRoot>/.claude/commands.legacy-bak-<ISO-no-colons>/` and clear
 * `commands_version` from `.dev-workflow.lock`.
 *
 * Timestamp format: ISO 8601 with colons replaced by dashes for fs
 * portability (Windows rejects `:` in filenames). Milliseconds preserved.
 *
 * `dateProvider` is injectable for deterministic tests.
 */
export function cleanupLegacyCommands(
  state: LegacyCommandsState,
  projectRoot: string,
  dateProvider: () => Date = () => new Date(),
): CleanupResult {
  const stamp = dateProvider().toISOString().replace(/:/g, "-");
  const backupPath = `${state.commandsDir}.legacy-bak-${stamp}`;
  renameSync(state.commandsDir, backupPath);
  clearLockField(projectRoot, "commands_version");
  return { backupPath, lockCleared: true };
}
