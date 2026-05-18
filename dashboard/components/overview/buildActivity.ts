// Pure data layer for the Overview page — no React, unit-testable in isolation.
//
// `buildActivity` fans out three project-scoped fetches (vault gameplan, tasks,
// workflow runs), merges the results into one descending-by-time timeline,
// derives the KPI counters, and parses the gameplan frontmatter for the
// `current-phase` value. The gameplan parse is deliberately tolerant: an
// absent or malformed frontmatter block yields an explicit `null`, never a
// masked optional-chain result.

import type { BoundApi } from "@/lib/project-context";
import type { ApiTask, ApiWorkflowRun } from "@/lib/types";

/** One row in the merged Overview activity feed. */
export interface ActivityEntry {
  /** Stable key — kind plus the source id. */
  id: string;
  /** Which source produced the row; drives the feed icon and label. */
  kind: "vault" | "task" | "run";
  /** Human-readable summary line. */
  title: string;
  /** ISO timestamp the row is sorted by. */
  timestamp: string;
}

/** Headline counters shown in the Overview KPI strip. */
export interface ActivitySummary {
  /** Workflow runs currently in the `paused` status. */
  pausedRuns: number;
  /** Tasks in the `pending` status. */
  pendingTasks: number;
}

/** Everything the Overview page renders from one fetch pass. */
export interface OverviewData {
  /** `current-phase` from gameplan frontmatter, or null when unavailable. */
  currentPhase: string | null;
  summary: ActivitySummary;
  /** The 10 most recent activity rows, newest first. */
  feed: ActivityEntry[];
}

const FEED_LIMIT = 10;

/**
 * Fetch and assemble the Overview page data. Any wrapper rejection propagates
 * to the caller, which renders the page's fetch-error state.
 */
export async function buildActivity(api: BoundApi): Promise<OverviewData> {
  const [gameplan, taskList, runList] = await Promise.all([
    api.getVaultSection("gameplan"),
    api.getTasks(),
    api.getWorkflowRuns(),
  ]);
  const tasks = taskList.tasks;
  const runs = runList.runs;
  return {
    currentPhase: parseCurrentPhase(gameplan.content),
    summary: summarize(tasks, runs),
    feed: mergeFeed(gameplan.content, tasks, runs),
  };
}

/** Count paused runs and pending tasks for the KPI strip. */
function summarize(tasks: ApiTask[], runs: ApiWorkflowRun[]): ActivitySummary {
  return {
    pausedRuns: runs.filter((run) => run.status === "paused").length,
    pendingTasks: tasks.filter((task) => task.status === "pending").length,
  };
}

/** Build the descending-by-time feed, capped at the 10 newest rows. */
function mergeFeed(
  gameplanContent: string,
  tasks: ApiTask[],
  runs: ApiWorkflowRun[],
): ActivityEntry[] {
  const rows: ActivityEntry[] = [
    ...taskRows(tasks),
    ...runRows(runs),
    ...gameplanRow(gameplanContent),
  ];
  rows.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  return rows.slice(0, FEED_LIMIT);
}

/** One feed row per task, keyed on its last-updated timestamp. */
function taskRows(tasks: ApiTask[]): ActivityEntry[] {
  return tasks.map((task) => ({
    id: `task:${task.id}`,
    kind: "task" as const,
    title: `${task.id} — ${task.title} [${task.status}]`,
    timestamp: task.updated,
  }));
}

/** One feed row per workflow run, keyed on its last-updated timestamp. */
function runRows(runs: ApiWorkflowRun[]): ActivityEntry[] {
  return runs.map((run) => ({
    id: `run:${run.id}`,
    kind: "run" as const,
    title: `${run.workflow} run ${run.status}`,
    timestamp: run.updatedAt,
  }));
}

/** A single vault row representing the gameplan's last edit, when datable. */
function gameplanRow(gameplanContent: string): ActivityEntry[] {
  const updated = parseFrontmatterField(gameplanContent, "updated");
  if (updated === null) return [];
  return [
    {
      id: "vault:gameplan",
      kind: "vault",
      title: "gameplan.md updated",
      timestamp: updated,
    },
  ];
}

/** Read `current-phase` from gameplan frontmatter — null when absent. */
export function parseCurrentPhase(gameplanContent: string): string | null {
  return parseFrontmatterField(gameplanContent, "current-phase");
}

/**
 * Extract a scalar `key: value` field from a leading `---` frontmatter block.
 * Returns null when the block is absent, unterminated, or the key is missing —
 * no optional-chain masking of a structurally invalid document.
 */
function parseFrontmatterField(source: string, key: string): string | null {
  const block = extractFrontmatterBlock(source);
  if (block === null) return null;
  for (const line of block) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    if (line.slice(0, separator).trim() !== key) continue;
    const value = line.slice(separator + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
}

/** Return the frontmatter lines between the opening and closing `---`, or null. */
function extractFrontmatterBlock(source: string): string[] | null {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const closing = lines.indexOf("---", 1);
  if (closing === -1) return null;
  return lines.slice(1, closing);
}
