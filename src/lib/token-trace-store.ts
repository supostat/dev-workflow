import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { TokenTraceRecord } from "./token-trace.js";

const RUNS_DIRNAME = join("workflow-state", "runs");
const TOKEN_TRACE_SUFFIX = ".tokens.jsonl";
const ORPHAN_TOKENS_FILE = join("workflow-state", "orphan-tokens.jsonl");
const ORPHAN_RUN_ID = "orphan";

/** A run identifier as minted by `workflowStart` — `run-` + 12 hex digits. */
const RUN_ID_PATTERN = /^run-[a-f0-9]{12}$/;

/**
 * A run id is accepted as user input only when it is either the canonical
 * `run-<12hex>` shape or the `"orphan"` sentinel. This neutralizes path
 * traversal (`..`, absolute paths, suffix injection) at the CLI boundary
 * before a run id is ever joined into a filesystem path by
 * {@link tokenTracePathFor}.
 */
export function isValidRunId(runId: string): boolean {
  return runId === ORPHAN_RUN_ID || RUN_ID_PATTERN.test(runId);
}

export interface DiscoveredRun {
  runId: string;
  filePath: string;
  mtimeMs: number;
}

export function discoverTokenRuns(vaultPath: string): DiscoveredRun[] {
  const discovered: DiscoveredRun[] = [];
  const runsDir = join(vaultPath, RUNS_DIRNAME);
  let entries: string[];
  try {
    entries = readdirSync(runsDir);
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.endsWith(TOKEN_TRACE_SUFFIX)) continue;
    const filePath = join(runsDir, entry);
    const stats = statSync(filePath);
    if (stats.size === 0) continue;
    discovered.push({
      runId: entry.slice(0, -TOKEN_TRACE_SUFFIX.length),
      filePath,
      mtimeMs: stats.mtimeMs,
    });
  }

  const orphanPath = join(vaultPath, ORPHAN_TOKENS_FILE);
  try {
    const orphanStats = statSync(orphanPath);
    if (orphanStats.size > 0) {
      discovered.push({
        runId: ORPHAN_RUN_ID,
        filePath: orphanPath,
        mtimeMs: orphanStats.mtimeMs,
      });
    }
  } catch {
    // orphan file absent — nothing to add
  }

  return discovered;
}

export function mostRecentTokenRun(vaultPath: string): DiscoveredRun | null {
  const runs = discoverTokenRuns(vaultPath);
  if (runs.length === 0) return null;
  return [...runs].sort((a, b) => b.mtimeMs - a.mtimeMs)[0]!;
}

export function tokenTracePathFor(vaultPath: string, runId: string): string {
  if (runId === ORPHAN_RUN_ID) return join(vaultPath, ORPHAN_TOKENS_FILE);
  return join(vaultPath, RUNS_DIRNAME, `${runId}${TOKEN_TRACE_SUFFIX}`);
}

export function readTokenTrace(filePath: string): TokenTraceRecord[] {
  const content = readFileSync(filePath, "utf-8");
  const records: TokenTraceRecord[] = [];
  for (const line of content.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      records.push(JSON.parse(line) as TokenTraceRecord);
    } catch {
      // skip malformed lines silently — partial trace is better than no trace
    }
  }
  return records;
}
