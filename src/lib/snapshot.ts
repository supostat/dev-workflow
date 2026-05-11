import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * Metadata stored as `<snapshot>/manifest.json`. Stable contract for the
 * `dev-workflow snapshot show --json` and any tooling that reads the
 * snapshot directory directly.
 */
export interface SnapshotMeta {
  name: string;
  createdAt: string; // ISO timestamp
  projectName: string;
  branch: string;
  fileCount: number;
  totalBytes: number;
  excludedPatterns: string[];
}

/** Internal manifest filename — sits inside each snapshot dir. */
export const MANIFEST_FILENAME = "manifest.json";

/** Snapshot root inside the vault. */
export const SNAPSHOTS_DIRNAME = "snapshots";

/**
 * Patterns excluded from snapshot. Stored in the manifest so we know
 * the snapshot's coverage at rollback time.
 *
 * - `snapshots/` — avoid recursive growth (snapshot OF snapshots)
 * - `.edit-log.json` — large, regenerable (vault editing audit)
 * - `.profile-state` — runtime state (gitignored, set by /profile)
 * - `workflow-state/runs/*.engram-trace.jsonl` — regenerable, GC'd
 *   separately by session-start hook
 */
export const DEFAULT_EXCLUDED: ReadonlySet<string> = new Set([
  SNAPSHOTS_DIRNAME,
  ".edit-log.json",
  ".profile-state",
]);

const TRACE_SUFFIX = ".engram-trace.jsonl";

/**
 * Validates a snapshot name. Allowed: lowercase letters, digits, dashes,
 * underscores, dots. Length 1–80. No path separators (rejected to
 * prevent traversal — every snapshot lives under
 * `<vault>/snapshots/<name>/`, no exceptions).
 */
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/i;

export function validateSnapshotName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid snapshot name "${name}": must match ${NAME_PATTERN}. ` +
      "Allowed: alphanumeric + dash/dot/underscore, 1-80 chars, no path separators.",
    );
  }
}

function defaultSnapshotName(prefix = "snap"): string {
  const iso = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${iso}`;
}

/**
 * Should the file at `relativePath` (relative to vault root) be included
 * in the snapshot? Returns false for excluded patterns + trace files.
 */
function shouldInclude(relativePath: string): boolean {
  const firstSegment = relativePath.split("/")[0]!;
  if (DEFAULT_EXCLUDED.has(firstSegment)) return false;
  if (relativePath === ".edit-log.json" || relativePath === ".profile-state") return false;
  if (relativePath.endsWith(TRACE_SUFFIX)) return false;
  return true;
}

/**
 * Walks the vault directory, invoking `callback` for each regular file
 * that passes {@link shouldInclude}.
 *
 * **Symlinks are deliberately skipped** (`entry.isFile()` returns false
 * for symlinks). This prevents two attack vectors:
 *
 * 1. **Outward refs in snapshots**: a vault containing
 *    `link → /etc/passwd` would otherwise be copied into the snapshot,
 *    making the snapshot tarball/zip leak external paths.
 * 2. **Inward overwrites on rollback**: if a snapshot contained
 *    absolute symlinks, restoring them via `cpSync` could overwrite
 *    host files outside the vault root.
 *
 * Trade-off: vault symlinks are NOT preserved across snapshot/rollback.
 * Users wishing to preserve symlink semantics should convert them to
 * regular files before snapshotting.
 */
function walkVault(
  vaultPath: string,
  callback: (absPath: string, relPath: string) => void,
): void {
  function walk(dir: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = relative(vaultPath, abs);
      if (!shouldInclude(rel)) continue;
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        callback(abs, rel);
      }
      // Symlinks (entry.isSymbolicLink() === true) and other file types
      // are skipped silently — see JSDoc above for security rationale.
    }
  }
  walk(vaultPath);
}

/**
 * Create a snapshot of `vaultPath` into `<vaultPath>/snapshots/<name>/`.
 * If `name` is omitted, generates `snap-<ISO-timestamp>`.
 * Returns the absolute path to the snapshot directory + parsed manifest.
 */
export function createSnapshot(
  vaultPath: string,
  options: { name?: string; projectName: string; branch: string; namePrefix?: string } = {} as never,
): { path: string; manifest: SnapshotMeta } {
  if (!existsSync(vaultPath)) {
    throw new Error(`Vault does not exist: ${vaultPath}`);
  }
  const name = options.name ?? defaultSnapshotName(options.namePrefix);
  validateSnapshotName(name);

  const snapshotRoot = join(vaultPath, SNAPSHOTS_DIRNAME, name);
  if (existsSync(snapshotRoot)) {
    throw new Error(`Snapshot "${name}" already exists at ${snapshotRoot}`);
  }
  mkdirSync(snapshotRoot, { recursive: true });

  let fileCount = 0;
  let totalBytes = 0;
  walkVault(vaultPath, (absPath, relPath) => {
    const targetPath = join(snapshotRoot, relPath);
    mkdirSync(dirname(targetPath), { recursive: true });
    cpSync(absPath, targetPath);
    fileCount++;
    totalBytes += statSync(absPath).size;
  });

  const manifest: SnapshotMeta = {
    name,
    createdAt: new Date().toISOString(),
    projectName: options.projectName,
    branch: options.branch,
    fileCount,
    totalBytes,
    excludedPatterns: [...DEFAULT_EXCLUDED, `*${TRACE_SUFFIX}`],
  };
  writeFileSync(
    join(snapshotRoot, MANIFEST_FILENAME),
    JSON.stringify(manifest, null, 2),
    "utf-8",
  );

  return { path: snapshotRoot, manifest };
}

/** List all snapshots in `<vaultPath>/snapshots/`, newest first by createdAt. */
export function listSnapshots(vaultPath: string): SnapshotMeta[] {
  const root = join(vaultPath, SNAPSHOTS_DIRNAME);
  if (!existsSync(root)) return [];

  const result: SnapshotMeta[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(root, entry.name, MANIFEST_FILENAME);
    if (!existsSync(manifestPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(manifestPath, "utf-8")) as SnapshotMeta;
      result.push(meta);
    } catch {
      // Skip corrupt manifests silently — they show up in `show` if invoked directly.
    }
  }
  result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return result;
}

/** Load a single snapshot's manifest. Throws if missing or corrupt. */
export function loadSnapshotMeta(vaultPath: string, name: string): SnapshotMeta {
  validateSnapshotName(name);
  const manifestPath = join(vaultPath, SNAPSHOTS_DIRNAME, name, MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) {
    throw new Error(`Snapshot "${name}" not found (no manifest at ${manifestPath})`);
  }
  return JSON.parse(readFileSync(manifestPath, "utf-8")) as SnapshotMeta;
}

/** Delete a snapshot directory. Throws if the snapshot doesn't exist. */
export function deleteSnapshot(vaultPath: string, name: string): void {
  validateSnapshotName(name);
  const dir = join(vaultPath, SNAPSHOTS_DIRNAME, name);
  if (!existsSync(dir)) {
    throw new Error(`Snapshot "${name}" not found at ${dir}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Restore vault to a snapshot. Before restoring, auto-creates a
 * `pre-rollback-<ISO>` snapshot of the current state so the rollback
 * itself is reversible.
 *
 * Strategy:
 * 1. Auto-snapshot current state under `pre-rollback-<ISO>`.
 * 2. Delete current vault files (excluded patterns preserved — most
 *    importantly `snapshots/` itself + runtime state).
 * 3. Copy snapshot files back into vault.
 *
 * Returns the name of the auto-created pre-rollback snapshot so the
 * caller can offer to revert.
 */
export function rollbackSnapshot(
  vaultPath: string,
  name: string,
  context: { projectName: string; branch: string },
): { preRollbackName: string; restoredFromManifest: SnapshotMeta } {
  validateSnapshotName(name);
  const snapshotRoot = join(vaultPath, SNAPSHOTS_DIRNAME, name);
  if (!existsSync(snapshotRoot)) {
    throw new Error(`Snapshot "${name}" not found at ${snapshotRoot}`);
  }
  const restoredFromManifest = loadSnapshotMeta(vaultPath, name);

  // 1. Auto pre-rollback snapshot
  const preRollback = createSnapshot(vaultPath, {
    projectName: context.projectName,
    branch: context.branch,
    namePrefix: "pre-rollback",
  });

  // 2. Delete current files (preserve excluded patterns — snapshots/ etc)
  walkVault(vaultPath, (absPath) => {
    rmSync(absPath, { force: true });
  });

  // 3. Copy snapshot contents back (but not its manifest into vault root).
  // verbatimSymlinks: true → never traverse symlinks; if any slipped in
  // (e.g. user manually edited the snapshot dir), they're copied as
  // symlinks not followed. Combined with walkVault's symlink skip on
  // snapshot creation, this means symlinks have no path through the
  // snapshot system.
  for (const entry of readdirSync(snapshotRoot, { withFileTypes: true })) {
    if (entry.name === MANIFEST_FILENAME) continue;
    const src = join(snapshotRoot, entry.name);
    const dst = join(vaultPath, entry.name);
    cpSync(src, dst, { recursive: true, verbatimSymlinks: true });
  }

  return { preRollbackName: preRollback.manifest.name, restoredFromManifest };
}
