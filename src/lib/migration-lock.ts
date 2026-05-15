import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PACKAGE_ROOT } from "./package-root.js";

export const LOCK_FILENAME = ".dev-workflow.lock";
export const LOCK_SCHEMA_VERSION = 1;

/**
 * State of `.claude/.dev-workflow.lock` — a per-project record of which
 * `@engramm/dev-workflow` versions last wrote each Claude Code component.
 *
 * Used by `dev-workflow init` (writes fresh) and `dev-workflow update`
 * (bumps the relevant `<component>_version` after re-copying that
 * component). Future Phase 4 migration (task-042) reads the lock to
 * decide whether legacy `.claude/commands/` can be safely removed.
 *
 * Per-component `*_version` fields are optional because a future major
 * release may stop shipping `commands/` entirely — at which point new
 * lock files will omit `commands_version`, while existing user-project
 * lock files keep their last-written value for migration detection.
 *
 * The `last_sync_*` fields and `auto_sync` are written/read by the
 * session-start auto-sync routine (task-052): `last_sync_version` records
 * which package version last reconciled bundled skills/agents,
 * `last_sync_at` is the ISO timestamp of that reconciliation, and
 * `auto_sync` is a persistent per-project opt-out (`false` disables the
 * session-start sync entirely).
 */
export interface LockState {
  version: number;
  commands_version?: string;
  agents_version?: string;
  skills_version?: string;
  last_sync_version?: string;
  last_sync_at?: string;
  auto_sync?: boolean;
  updated_at: string;
}

const RESERVED_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

function parseSafeJson<T>(content: string): T {
  return JSON.parse(content, (key, value): unknown => {
    if (RESERVED_KEYS.has(key)) return undefined;
    return value;
  }) as T;
}

function lockPath(projectRoot: string): string {
  return join(projectRoot, ".claude", LOCK_FILENAME);
}

/**
 * Read the `version` field from this package's `package.json` at runtime.
 *
 * Resolved against {@link PACKAGE_ROOT} so it works under `npm link` /
 * `pnpm link --global` (canonical realpath) the same as a normal install.
 * Throws if package.json is missing or unreadable — an installed dev-workflow
 * package always has a readable package.json, so a throw here is a real bug
 * (e.g. corrupted install) and not a silent recovery situation.
 */
export function getPackageVersion(): string {
  const pkgJsonPath = join(PACKAGE_ROOT, "package.json");
  const raw = readFileSync(pkgJsonPath, "utf-8");
  const parsed = parseSafeJson<{ version?: unknown }>(raw);
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error(`package.json at ${pkgJsonPath} has no string 'version' field`);
  }
  return parsed.version;
}

/**
 * Read the project's `.claude/.dev-workflow.lock` if present.
 *
 *  - missing file → returns `null` silently (fresh install state).
 *  - malformed JSON or wrong shape → returns `null` AND emits a single
 *    stderr warning `note: failed to read .dev-workflow.lock: <reason>`,
 *    so the next `writeLock` call rebuilds the file from a clean slate
 *    without crashing the surrounding init/update flow.
 */
export function readLock(projectRoot: string): LockState | null {
  const filepath = lockPath(projectRoot);
  if (!existsSync(filepath)) return null;
  let raw: string;
  try {
    raw = readFileSync(filepath, "utf-8");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`note: failed to read .dev-workflow.lock: ${msg}\n`);
    return null;
  }
  try {
    const parsed = parseSafeJson<unknown>(raw);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("not an object");
    }
    const obj = parsed as Record<string, unknown>;
    if (typeof obj["version"] !== "number" || typeof obj["updated_at"] !== "string") {
      throw new Error("missing required fields (version, updated_at)");
    }
    return obj as unknown as LockState;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`note: failed to read .dev-workflow.lock: ${msg}\n`);
    return null;
  }
}

/**
 * Merge `partial` into the existing lock (or start fresh if none/malformed)
 * and write the result. `updated_at` is always set to the current ISO
 * timestamp by writeLock — callers do not pass it. `version` is always
 * set to {@link LOCK_SCHEMA_VERSION} so an old lock with a future-schema
 * marker gets normalised on next write.
 *
 * Creates `.claude/` if missing (e.g. very early `init` where the
 * directory is not yet populated by other components).
 */
export function writeLock(projectRoot: string, partial: Partial<Omit<LockState, "version" | "updated_at">>): void {
  const existing = readLock(projectRoot);
  const merged: LockState = {
    version: LOCK_SCHEMA_VERSION,
    commands_version: partial.commands_version ?? existing?.commands_version,
    agents_version: partial.agents_version ?? existing?.agents_version,
    skills_version: partial.skills_version ?? existing?.skills_version,
    last_sync_version: partial.last_sync_version ?? existing?.last_sync_version,
    last_sync_at: partial.last_sync_at ?? existing?.last_sync_at,
    auto_sync: partial.auto_sync ?? existing?.auto_sync,
    updated_at: new Date().toISOString(),
  };

  const filepath = lockPath(projectRoot);
  mkdirSync(dirname(filepath), { recursive: true });
  writeFileSync(filepath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
}

/**
 * Remove a per-component `*_version` field from the lock. Reads existing,
 * writes back without the named field. Preserves `version`, `updated_at`,
 * and any other component fields. No-op (returns silently) if no lock
 * exists or the field is already absent.
 *
 * `writeLock` cannot clear fields — when `partial.X` is undefined it
 * preserves `existing.X` via nullish coalescing. This helper is the
 * explicit clear path used by task-042 legacy cleanup to remove
 * `commands_version` after the legacy directory is moved to backup.
 */
export function clearLockField(
  projectRoot: string,
  field: "commands_version" | "agents_version" | "skills_version",
): void {
  const existing = readLock(projectRoot);
  if (!existing || existing[field] === undefined) return;
  const cleared: LockState = {
    version: LOCK_SCHEMA_VERSION,
    commands_version: field === "commands_version" ? undefined : existing.commands_version,
    agents_version: field === "agents_version" ? undefined : existing.agents_version,
    skills_version: field === "skills_version" ? undefined : existing.skills_version,
    last_sync_version: existing.last_sync_version,
    last_sync_at: existing.last_sync_at,
    auto_sync: existing.auto_sync,
    updated_at: new Date().toISOString(),
  };
  const filepath = lockPath(projectRoot);
  mkdirSync(dirname(filepath), { recursive: true });
  writeFileSync(filepath, JSON.stringify(cleared, null, 2) + "\n", "utf-8");
}
