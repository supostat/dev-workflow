import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowRun, TelemetryCounters } from "../workflow/types.js";
import type { EngramTraceEvent } from "./engram-trace.js";
import { engramHealth, engramSearch } from "./engram.js";
import type { EngramMemory, EngramHealthStatus } from "./engram.js";

/**
 * Stable shape for `dev-workflow engram-stats --json` consumers.
 * Post-1.0.x additive only.
 */
export interface EngramStats {
  scope: { runCount: number; vaultPath: string; cutoffISO: string | null };
  byMethod: Record<string, { count: number; errors: number; avgDurationMs: number }>;
  byMemoryType: Record<string, number>;
  byStep: Record<string, { search: number; store: number; judge: number }>;
  recentRuns: RunSummary[];
  warnings: { runId: string; issue: string }[];
  live: {
    health: EngramHealthStatus | null; // null = engram daemon unavailable
    topMemories: EngramMemory[];        // empty when engram unavailable
  };
}

export interface RunSummary {
  id: string;
  workflowName: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  stepCount: number;
  completedSteps: number;
  telemetry: TelemetryCounters | null;
  hasTrace: boolean;
}

export interface CollectOptions {
  runCount?: number;
  projectName?: string;
  branch?: string;
  /** Skip live engram queries (deterministic tests). */
  skipLive?: boolean;
}

const RUNS_DIRNAME = join("workflow-state", "runs");

function listRunFiles(vaultPath: string): string[] {
  const runsDir = join(vaultPath, RUNS_DIRNAME);
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir)
    .filter((name) => name.startsWith("run-") && name.endsWith(".json"))
    .map((name) => join(runsDir, name));
}

function readRun(filepath: string): WorkflowRun | null {
  try {
    return JSON.parse(readFileSync(filepath, "utf-8")) as WorkflowRun;
  } catch {
    return null;
  }
}

function readTrace(vaultPath: string, runId: string): EngramTraceEvent[] {
  const tracePath = join(vaultPath, RUNS_DIRNAME, `${runId}.engram-trace.jsonl`);
  if (!existsSync(tracePath)) return [];
  const content = readFileSync(tracePath, "utf-8");
  const events: EngramTraceEvent[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as EngramTraceEvent);
    } catch {
      // skip malformed lines
    }
  }
  return events;
}

function summarizeRun(run: WorkflowRun, hasTrace: boolean): RunSummary {
  const stepStates = Object.values(run.steps ?? {});
  const completedSteps = stepStates.filter((s) => s.status === "completed").length;
  const durationMs = run.completedAt
    ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
    : null;
  return {
    id: run.id,
    workflowName: run.workflowName,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs,
    stepCount: stepStates.length,
    completedSteps,
    telemetry: run.telemetry ?? null,
    hasTrace,
  };
}

function tagValue(tags: unknown, prefix: string): string | null {
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) {
    if (typeof tag === "string" && tag.startsWith(prefix)) {
      return tag.slice(prefix.length);
    }
  }
  return null;
}

function aggregateMethods(events: EngramTraceEvent[]): EngramStats["byMethod"] {
  const acc: Record<string, { count: number; errors: number; totalDurationMs: number }> = {};
  for (const event of events) {
    const slot = acc[event.method] ?? { count: 0, errors: 0, totalDurationMs: 0 };
    slot.count++;
    slot.totalDurationMs += event.duration_ms;
    if (!event.ok) slot.errors++;
    acc[event.method] = slot;
  }
  const result: EngramStats["byMethod"] = {};
  for (const [method, s] of Object.entries(acc)) {
    result[method] = {
      count: s.count,
      errors: s.errors,
      avgDurationMs: s.count > 0 ? Math.round(s.totalDurationMs / s.count) : 0,
    };
  }
  return result;
}

function aggregateMemoryTypes(events: EngramTraceEvent[]): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const event of events) {
    if (event.method !== "memory_store" || !event.ok) continue;
    const memType = event.params["memory_type"];
    if (typeof memType !== "string") continue;
    acc[memType] = (acc[memType] ?? 0) + 1;
  }
  return acc;
}

function aggregateByStep(events: EngramTraceEvent[]): EngramStats["byStep"] {
  const acc: Record<string, { search: number; store: number; judge: number }> = {};
  for (const event of events) {
    const step = tagValue(event.params["tags"], "step:");
    if (!step) continue;
    const slot = acc[step] ?? { search: 0, store: 0, judge: 0 };
    if (event.method === "memory_search") slot.search++;
    else if (event.method === "memory_store") slot.store++;
    else if (event.method === "memory_judge") slot.judge++;
    acc[step] = slot;
  }
  return acc;
}

function detectWarnings(runs: RunSummary[]): EngramStats["warnings"] {
  const warnings: EngramStats["warnings"] = [];
  for (const run of runs) {
    const t = run.telemetry;
    if (!t) continue;
    if (t.store > 0 && t.judge === 0) {
      warnings.push({
        runId: run.id,
        issue: `${t.store} stores, 0 judges — likely missed agent feedback`,
      });
    }
    if (t.vaultRecord > 0 && t.store === 0) {
      warnings.push({
        runId: run.id,
        issue: `${t.vaultRecord} vault records, 0 engram mirrors — daemon may have been down`,
      });
    }
  }
  return warnings;
}

async function gatherLive(
  options: CollectOptions,
): Promise<EngramStats["live"]> {
  if (options.skipLive) {
    return { health: null, topMemories: [] };
  }
  const [health, topMemories] = await Promise.all([
    engramHealth(),
    fetchTopMemoriesBestEffort(options),
  ]);
  return { health, topMemories };
}

async function fetchTopMemoriesBestEffort(options: CollectOptions): Promise<EngramMemory[]> {
  if (!options.projectName) return [];
  try {
    const tags = options.branch ? [`branch:${options.branch}`] : undefined;
    return await engramSearch("recent activity", options.projectName, 5, tags);
  } catch {
    return [];
  }
}

/**
 * Aggregate engram activity from local artifacts (run JSONs + engram-trace
 * JSONLs) over the last N runs, plus a best-effort live engram health probe.
 *
 * Local data is always shown — engram daemon down or absent only zeroes the
 * `live` panel, not the rest. The `--skipLive` test option bypasses daemon
 * calls entirely for deterministic test fixtures.
 */
export async function collectEngramStats(
  vaultPath: string,
  options: CollectOptions = {},
): Promise<EngramStats> {
  const runCount = options.runCount ?? 10;

  const runFiles = listRunFiles(vaultPath);
  const runsWithMeta = runFiles
    .map((path) => ({ path, run: readRun(path) }))
    .filter((entry): entry is { path: string; run: WorkflowRun } => entry.run !== null);

  runsWithMeta.sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt));
  const recentEntries = runsWithMeta.slice(0, runCount);
  const cutoffISO = recentEntries.length > 0
    ? recentEntries[recentEntries.length - 1]!.run.startedAt
    : null;

  const recentRuns: RunSummary[] = [];
  const allEvents: EngramTraceEvent[] = [];
  for (const { run } of recentEntries) {
    const events = readTrace(vaultPath, run.id);
    recentRuns.push(summarizeRun(run, events.length > 0));
    allEvents.push(...events);
  }

  const live = await gatherLive(options);

  return {
    scope: { runCount: recentRuns.length, vaultPath, cutoffISO },
    byMethod: aggregateMethods(allEvents),
    byMemoryType: aggregateMemoryTypes(allEvents),
    byStep: aggregateByStep(allEvents),
    recentRuns,
    warnings: detectWarnings(recentRuns),
    live,
  };
}
