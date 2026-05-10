import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { readFileOrNull, writeFileSafe } from "./fs-helpers.js";

const STATE_FILE_NAME = ".profile-state";
const PROFILE_NAME_REGEX = /^[\w][\w_-]*$/;

/**
 * Read the active profile name from .dev-vault/.profile-state.
 * Returns null if file is missing, unreadable, or contains only whitespace.
 *
 * Concurrency: Node.js is single-threaded for filesystem syscalls within
 * a single process — read is atomic. For clustered deployments (multi-process),
 * last-write-wins is acceptable for runtime state.
 */
export function getActiveProfile(vaultPath: string): string | null {
  const filePath = join(vaultPath, STATE_FILE_NAME);
  const content = readFileOrNull(filePath);
  if (content === null) return null;
  const trimmed = content.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Persist the active profile name to .dev-vault/.profile-state.
 * Validates name syntax (matches communication.yaml parser regex).
 *
 * Atomicity: writeFileSync chosen over write-tmp-rename for single-line
 * state; assumes POSIX-like filesystem. NFS/FAT32 edge cases acceptable
 * per task-014 scope (gitignored runtime state, not durable config).
 *
 * @throws Error if name fails regex validation
 * @throws Error from writeFileSafe (e.g. EACCES, ENOSPC) on I/O failure
 */
export function setActiveProfile(vaultPath: string, name: string): void {
  if (!PROFILE_NAME_REGEX.test(name)) {
    throw new Error(
      `Invalid profile name '${name}' — must match ${PROFILE_NAME_REGEX.source}`,
    );
  }
  const filePath = join(vaultPath, STATE_FILE_NAME);
  writeFileSafe(filePath, `${name}\n`);
}

/**
 * Delete the .profile-state file (reset runtime state to "no active profile").
 * No-op if file does not exist (fail-safe).
 *
 * @throws Error from unlinkSync only on permission denied or other non-ENOENT errors
 */
export function clearActiveProfile(vaultPath: string): void {
  const filePath = join(vaultPath, STATE_FILE_NAME);
  try {
    unlinkSync(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    throw err;
  }
}
