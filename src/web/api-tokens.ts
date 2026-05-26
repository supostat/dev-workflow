// Token-usage REST handlers for the web dashboard (task-073).
//
// `GET /api/tokens/runs` lists discovered token-trace runs (mtime desc);
// `GET /api/tokens[?runId=]` returns the analyzer's per-run breakdown. Both
// take a filesystem-only `ProjectScope` (no engram socket) and validate the
// run id at the path-traversal boundary before any filesystem join.

import type { ServerResponse } from "node:http";
import { sendJson, type ProjectScope } from "./api-handlers.js";
import {
  discoverTokenRuns,
  mostRecentTokenRun,
  tokenTracePathFor,
  readTokenTrace,
  isValidRunId,
} from "../lib/token-trace-store.js";
import { aggregateRun } from "../lib/token-stats.js";
import type { TokenTraceRecord } from "../lib/token-trace.js";

/** `GET /api/tokens/runs?project=<name>` — discovered runs, newest first. */
export function getTokenRuns(res: ServerResponse, scope: ProjectScope): void {
  const runs = [...discoverTokenRuns(scope.context.vaultPath)].sort(
    (first, second) => second.mtimeMs - first.mtimeMs,
  );
  sendJson(res, 200, { runs });
}

/**
 * `GET /api/tokens?project=<name>&runId=<id>` — per-run token breakdown.
 *
 * No `runId` falls back to the most-recent run. A present-but-blank trace
 * yields 200 all-zero stats (read-only observability: a present run is valid
 * zero data, not an error). A missing run id or ENOENT trace yields 404; an
 * invalid run id yields 400 before the id ever reaches the filesystem.
 */
export function getTokenStats(
  res: ServerResponse,
  scope: ProjectScope,
  runIdParam: string | null,
): void {
  const vaultPath = scope.context.vaultPath;
  if (runIdParam !== null && !isValidRunId(runIdParam)) {
    sendJson(res, 400, { error: `invalid run id: ${runIdParam}` });
    return;
  }
  const runId = runIdParam ?? mostRecentTokenRun(vaultPath)?.runId ?? null;
  if (runId === null) {
    sendJson(res, 404, { error: "no token traces found" });
    return;
  }
  const records = readTraceOrNull(vaultPath, runId);
  if (records === null) {
    sendJson(res, 404, { error: `token trace not found: ${runId}` });
    return;
  }
  sendJson(res, 200, aggregateRun(runId, records));
}

/**
 * Read a run's trace, mapping ENOENT to `null` so `getTokenStats` can answer
 * 404 without an inline try/catch (keeps the handler ≤30 LOC). Non-ENOENT
 * errors propagate to the router's 500 boundary.
 */
function readTraceOrNull(vaultPath: string, runId: string): TokenTraceRecord[] | null {
  try {
    return readTokenTrace(tokenTracePathFor(vaultPath, runId));
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
