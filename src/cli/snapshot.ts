import { detectContext } from "../lib/context.js";
import {
  createSnapshot, listSnapshots, loadSnapshotMeta, deleteSnapshot, rollbackSnapshot,
  type SnapshotMeta,
} from "../lib/snapshot.js";
import { icon, table } from "../lib/output.js";

const SUBCOMMANDS: ReadonlySet<string> = new Set([
  "create", "list", "show", "rollback", "delete",
]);

function printUsage(): void {
  console.error("Usage: dev-workflow snapshot <subcommand> [args]");
  console.error("");
  console.error("Subcommands:");
  console.error("  create [name]            Create a snapshot (default name: snap-<ISO>)");
  console.error("  list                     List existing snapshots");
  console.error("  show <name>              Print snapshot manifest");
  console.error("  rollback <name>          Restore vault to snapshot (auto pre-rollback)");
  console.error("  delete <name> [--force]  Delete a snapshot (--force skips confirmation)");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

function formatDate(iso: string): string {
  // 2026-05-11T16:42:30.123Z → 2026-05-11 16:42 UTC
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]}Z` : iso;
}

export function snapshot(args: string[]): void {
  const subcommand = args[0];
  if (!subcommand) {
    printUsage();
    process.exitCode = 1;
    return;
  }
  if (!SUBCOMMANDS.has(subcommand)) {
    console.error(`Unknown subcommand: ${subcommand}`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  const context = detectContext();
  if (!context) {
    console.error("Not a git repository.");
    process.exitCode = 1;
    return;
  }

  try {
    switch (subcommand) {
      case "create":
        return runCreate(context.vaultPath, context.projectName, context.branch, args[1]);
      case "list":
        return runList(context.vaultPath);
      case "show":
        return runShow(context.vaultPath, args[1]);
      case "rollback":
        return runRollback(context.vaultPath, context.projectName, context.branch, args[1]);
      case "delete":
        return runDelete(context.vaultPath, args[1], args.includes("--force"));
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "snapshot operation failed";
    console.error(`${icon.error} ${message}`);
    process.exitCode = 1;
  }
}

function runCreate(
  vaultPath: string,
  projectName: string,
  branch: string,
  name: string | undefined,
): void {
  const { path, manifest } = createSnapshot(vaultPath, { name, projectName, branch });
  console.log(`${icon.success} Created snapshot "${manifest.name}"`);
  console.log(`  Files:   ${manifest.fileCount}`);
  console.log(`  Size:    ${formatBytes(manifest.totalBytes)}`);
  console.log(`  Path:    ${path}`);
}

function runList(vaultPath: string): void {
  const snapshots = listSnapshots(vaultPath);
  if (snapshots.length === 0) {
    console.log(`${icon.task} No snapshots found.`);
    return;
  }
  console.log(`\n${icon.task} Snapshots\n`);
  const rows = snapshots.map((s) => [
    s.name,
    formatDate(s.createdAt),
    s.branch,
    String(s.fileCount),
    formatBytes(s.totalBytes),
  ]);
  console.log(table(["Name", "Created", "Branch", "Files", "Size"], rows));
}

function runShow(vaultPath: string, name: string | undefined): void {
  if (!name) {
    console.error("Usage: dev-workflow snapshot show <name>");
    process.exitCode = 1;
    return;
  }
  const meta = loadSnapshotMeta(vaultPath, name);
  console.log(JSON.stringify(meta, null, 2));
}

function runRollback(
  vaultPath: string,
  projectName: string,
  branch: string,
  name: string | undefined,
): void {
  if (!name) {
    console.error("Usage: dev-workflow snapshot rollback <name>");
    process.exitCode = 1;
    return;
  }
  const result = rollbackSnapshot(vaultPath, name, { projectName, branch });
  console.log(`${icon.success} Rolled back to "${result.restoredFromManifest.name}"`);
  console.log(`  Files restored: ${result.restoredFromManifest.fileCount}`);
  console.log(`  Pre-rollback snapshot: "${result.preRollbackName}"`);
  console.log(`  To revert: dev-workflow snapshot rollback ${result.preRollbackName}`);
}

function runDelete(vaultPath: string, name: string | undefined, force: boolean): void {
  if (!name) {
    console.error("Usage: dev-workflow snapshot delete <name> [--force]");
    process.exitCode = 1;
    return;
  }
  // Show the snapshot first so the user knows what's being deleted
  let meta: SnapshotMeta;
  try {
    meta = loadSnapshotMeta(vaultPath, name);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "snapshot not found";
    console.error(`${icon.error} ${message}`);
    process.exitCode = 1;
    return;
  }
  if (!force) {
    console.error(`${icon.warning} Snapshot "${name}" — ${meta.fileCount} files, ${formatBytes(meta.totalBytes)}, created ${formatDate(meta.createdAt)}`);
    console.error(`Pass --force to confirm deletion.`);
    process.exitCode = 1;
    return;
  }
  deleteSnapshot(vaultPath, name);
  console.log(`${icon.success} Deleted snapshot "${name}"`);
}
