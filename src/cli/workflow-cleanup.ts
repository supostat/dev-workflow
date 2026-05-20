import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { WorkflowState } from "../workflow/state.js";
import type { WorkflowRun, WorkflowStatus } from "../workflow/types.js";

const DEFAULT_OLDER_THAN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STATUSES: ReadonlySet<WorkflowStatus> = new Set(["running", "paused"]);
const VALID_TARGETED_STATUSES: ReadonlySet<WorkflowStatus> = new Set([
  "running", "paused", "completed", "failed", "aborted",
]);
const ABORT_REASON = "auto-aborted: orchestrator never finalized";

interface CleanupOptions {
  dryRun: boolean;
  delete: boolean;
  olderThanMs: number;
  statuses: ReadonlySet<WorkflowStatus>;
}

interface CleanupCandidate {
  run: WorkflowRun;
  ageMs: number;
}

export function runWorkflowCleanup(args: string[], vaultPath: string): void {
  let options: CleanupOptions;
  try {
    options = parseFlags(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    process.exitCode = 1;
    return;
  }

  const state = new WorkflowState(vaultPath);
  const allRuns = state.list();
  const now = Date.now();
  const candidates: CleanupCandidate[] = [];
  for (const run of allRuns) {
    if (!options.statuses.has(run.status)) continue;
    const ageMs = now - Date.parse(run.startedAt);
    if (Number.isNaN(ageMs) || ageMs < options.olderThanMs) continue;
    candidates.push({ run, ageMs });
  }

  if (candidates.length === 0) {
    console.log("No stale runs found.");
    return;
  }

  printCandidates(candidates, options);

  if (options.dryRun) {
    console.log(`\n(dry-run) ${candidates.length} run(s) would be affected. No files modified.`);
    return;
  }

  let processed = 0;
  let completedCount = 0;
  let abortedCount = 0;
  const runsDir = join(vaultPath, "workflow-state", "runs");
  for (const { run } of candidates) {
    if (options.delete) {
      state.delete(run.id);
      const tracePath = join(runsDir, `${run.id}.engram-trace.jsonl`);
      if (existsSync(tracePath)) {
        unlinkSync(tracePath);
      }
    } else {
      const terminal = classifyTerminalStatus(run);
      run.status = terminal;
      run.completedAt = new Date().toISOString();
      if (terminal === "aborted") {
        run.abortReason = ABORT_REASON;
      }
      state.save(run);
      if (terminal === "completed") completedCount++;
      else abortedCount++;
    }
    processed++;
  }

  if (options.delete) {
    console.log(`\n${processed} run(s) deleted.`);
  } else {
    console.log(
      `\n${completedCount} run(s) marked completed, ${abortedCount} run(s) marked aborted.`,
    );
  }
}

/**
 * Classify a stale `running`/`paused` run into its true terminal status by
 * examining recorded step states.
 *
 * The conversational orchestrator (Claude-driven slash dispatcher) forgets to
 * transition `run.status` from `"running"` to `"completed"` even on a clean
 * finish (the transition lives in `WorkflowEngine.executeLoop` on the CLI
 * path only). The result is a fully-finished pipeline whose run JSON looks
 * like a zombie. Marking every such run as `"aborted"` would lie about
 * success.
 *
 * Heuristic: if every recorded `StepState` has `status === "completed"`, the
 * pipeline reached its end successfully — return `"completed"`. Any
 * `running`/`failed`/`pending`/`skipped` step (or an empty `steps` map, which
 * means the run never advanced past `workflow_start`) means the pipeline did
 * not finish — return `"aborted"`.
 */
function classifyTerminalStatus(run: WorkflowRun): "completed" | "aborted" {
  const steps = Object.values(run.steps);
  if (steps.length === 0) return "aborted";
  return steps.every((step) => step.status === "completed") ? "completed" : "aborted";
}

function parseFlags(args: string[]): CleanupOptions {
  let dryRun = false;
  let deleteFlag = false;
  let olderThanMs = DEFAULT_OLDER_THAN_MS;
  let statuses: ReadonlySet<WorkflowStatus> = DEFAULT_STATUSES;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--delete") {
      deleteFlag = true;
    } else if (arg === "--older-than") {
      const value = args[++i];
      if (value === undefined) {
        throw new Error("E001: --older-than requires a value (e.g. 24h, 7d)");
      }
      olderThanMs = parseDuration(value);
    } else if (arg === "--status") {
      const value = args[++i];
      if (value === undefined) {
        throw new Error("E001: --status requires a value (comma-separated list)");
      }
      statuses = parseStatusList(value);
    } else {
      throw new Error(`E001: unknown flag: ${arg}`);
    }
  }

  if (dryRun && deleteFlag) {
    throw new Error("E001: --dry-run and --delete are mutually exclusive");
  }

  return { dryRun, delete: deleteFlag, olderThanMs, statuses };
}

function parseDuration(value: string): number {
  const match = value.match(/^(\d+)(h|d)$/);
  if (!match) {
    throw new Error(`E001: --older-than must match <N>h or <N>d (got "${value}")`);
  }
  const n = Number.parseInt(match[1]!, 10);
  const unit = match[2]!;
  return unit === "h" ? n * 60 * 60 * 1000 : n * 24 * 60 * 60 * 1000;
}

function parseStatusList(value: string): ReadonlySet<WorkflowStatus> {
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error("E001: --status requires at least one status");
  }
  for (const part of parts) {
    if (!VALID_TARGETED_STATUSES.has(part as WorkflowStatus)) {
      throw new Error(
        `E001: unknown status "${part}" — valid: ${[...VALID_TARGETED_STATUSES].join(", ")}`,
      );
    }
  }
  return new Set(parts as WorkflowStatus[]);
}

function printCandidates(candidates: CleanupCandidate[], options: CleanupOptions): void {
  const action = options.dryRun
    ? "Would affect"
    : options.delete
    ? "Will delete"
    : "Will reclassify";
  console.log(`${action} ${candidates.length} run(s):`);
  for (const { run, ageMs } of candidates) {
    if (options.delete) {
      console.log(
        `  ${run.id}  status=${run.status}  startedAt=${run.startedAt}  age=${formatAge(ageMs)}`,
      );
    } else {
      const target = classifyTerminalStatus(run);
      console.log(
        `  ${run.id}  status=${run.status} → ${target}  startedAt=${run.startedAt}  age=${formatAge(ageMs)}`,
      );
    }
  }
}

function formatAge(ms: number): string {
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours - days * 24;
  return remHours === 0 ? `${days}d` : `${days}d${remHours}h`;
}

function printUsage(): void {
  console.error("");
  console.error("Usage: dev-workflow workflow cleanup [options]");
  console.error("");
  console.error("Options:");
  console.error("  --older-than <N>h|<N>d   Age threshold (default: 24h)");
  console.error("  --status <comma-list>    Filter by status (default: running,paused)");
  console.error("  --dry-run                Print candidates without modifying files");
  console.error("  --delete                 Remove run JSON + trace file (default: mark aborted)");
}
