import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { hashFile } from "./spec-hash.js";
import { walkFiles } from "./fs-walk.js";
import { mergeSettingsJson } from "./settings-merge.js";
import { buildSettingsJson } from "./settings-template.js";
import { getPackageVersion, readLock, writeLock } from "./migration-lock.js";

/** Outcome of a single {@link syncBundledArtifacts} run. */
export interface AutoSyncResult {
  /** Files copied — either newly added or overwritten because they were unmodified. */
  synced: number;
  /** Drifted files left untouched because they look user-modified. */
  preserved: number;
  /** `1` when an opt-out short-circuited the whole sync, otherwise `0`. */
  skipped: number;
  /** The package version recorded as `last_sync_version` for this run. */
  lastSyncVersion: string;
}

/** Caller-side overrides for {@link syncBundledArtifacts}. */
export interface AutoSyncOptions {
  /** Skip the sync unconditionally. Default: `false` (sync runs). */
  forceSkip?: boolean;
}

const ARTIFACT_KINDS: readonly string[] = ["skills", "agents"];

/**
 * Reconcile a project's bundled artifacts against the installed dev-workflow
 * package, intended to run fire-and-forget at session-start.
 *
 * For each of `.claude/{skills,agents}/` the routine walks the bundled
 * `templates/claude/<kind>/` tree and, per file:
 *
 *  - target missing → copy it in (`synced`);
 *  - target byte-identical to the template → no-op;
 *  - target drifted, lock has a prior `last_sync_version` → overwrite,
 *    treating the file as an unmodified earlier-version copy (`synced`);
 *  - target drifted, no prior sync recorded → leave it, emit a stderr
 *    notice, treat it as user-modified (`preserved`).
 *
 * The walk always runs (no version-equality fast path) so a hand-deleted
 * target is healed by the missing-file branch. After the walk the project's
 * `.claude/settings.json` hooks block is re-merged, and the lock's
 * `last_sync_version` / `last_sync_at` are refreshed.
 *
 * Opt-out, in order: `options.forceSkip`, `DEV_WORKFLOW_AUTO_SYNC=0`, or a
 * lock with `auto_sync: false`. Any of these returns `{ skipped: 1 }` with
 * no fs changes.
 *
 * Throws only on unexpected fs errors — a missing template directory or a
 * missing lock are normal states handled inline.
 */
export function syncBundledArtifacts(
  projectRoot: string,
  packageRoot: string,
  options?: AutoSyncOptions,
): AutoSyncResult {
  const packageVersion = getPackageVersion();

  if (options?.forceSkip === true) return optOut(packageVersion);
  if (process.env["DEV_WORKFLOW_AUTO_SYNC"] === "0") return optOut(packageVersion);

  const lock = readLock(projectRoot);
  if (lock?.auto_sync === false) return optOut(packageVersion);

  const lockHasPriorSync = typeof lock?.last_sync_version === "string";
  let synced = 0;
  let preserved = 0;

  for (const kind of ARTIFACT_KINDS) {
    const templateDir = join(packageRoot, "templates", "claude", kind);
    const targetDir = join(projectRoot, ".claude", kind);
    const partial = syncArtifactDir(templateDir, targetDir, kind, lockHasPriorSync);
    synced += partial.synced;
    preserved += partial.preserved;
  }

  const settingsPath = join(projectRoot, ".claude", "settings.json");
  if (existsSync(settingsPath)) {
    mergeSettingsJson(settingsPath, JSON.parse(buildSettingsJson()) as Record<string, unknown>);
  }

  writeLock(projectRoot, {
    last_sync_version: packageVersion,
    last_sync_at: new Date().toISOString(),
  });

  return { synced, preserved, skipped: 0, lastSyncVersion: packageVersion };
}

function optOut(lastSyncVersion: string): AutoSyncResult {
  return { synced: 0, preserved: 0, skipped: 1, lastSyncVersion };
}

/**
 * Reconcile one artifact kind's template tree against its target directory.
 * Returns the partial `{ synced, preserved }` contribution for that kind.
 * A missing `templateDir` (kind not bundled) yields a zero contribution.
 */
function syncArtifactDir(
  templateDir: string,
  targetDir: string,
  kind: string,
  lockHasPriorSync: boolean,
): { synced: number; preserved: number } {
  let synced = 0;
  let preserved = 0;
  if (!existsSync(templateDir)) return { synced, preserved };

  for (const filepath of walkFiles(templateDir)) {
    const rel = relative(templateDir, filepath);
    const target = join(targetDir, rel);

    if (!existsSync(target)) {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(filepath, target);
      synced++;
      continue;
    }

    if (hashFile(filepath) === hashFile(target)) continue;

    if (lockHasPriorSync) {
      copyFileSync(filepath, target);
      synced++;
    } else {
      process.stderr.write(`note: skipping user-modified ${kind} ${rel}\n`);
      preserved++;
    }
  }

  return { synced, preserved };
}
