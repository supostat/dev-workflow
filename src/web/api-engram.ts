// Engram REST handlers for the web dashboard (task-055).
//
// `GET /api/engram/stats` and `GET /api/engram/health`. Both thread the
// per-project socket path resolved by `EngramPool` into the engram libs, so
// multi-project routing reaches the right daemon instead of the cwd/global
// socket. Engram being unavailable is never an error here — it degrades the
// `live` panel / yields a null health, the request still returns 200.

import { collectEngramStats } from "../lib/engram-stats.js";
import { engramHealth } from "../lib/engram.js";
import type { EngramPool } from "./engram-pool.js";
import type { Project } from "./types.js";
import { sendJson } from "./api-handlers.js";
import type { ServerResponse } from "node:http";

/** Largest `?runs=N` window honoured for `GET /api/engram/stats`. */
const MAX_RUN_WINDOW = 100;

/**
 * Parse and clamp the `?runs=` query value. Non-numeric or out-of-range input
 * falls back to the engram-stats default (caller passes `undefined`).
 */
function parseRunWindow(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return undefined;
  return Math.min(parsed, MAX_RUN_WINDOW);
}

/** `GET /api/engram/stats?project=<name>&runs=N` — aggregated engram activity. */
export async function getEngramStats(
  res: ServerResponse,
  project: Project,
  pool: EngramPool,
  runsParam: string | null,
): Promise<void> {
  const { socketPath } = pool.getConnection(project);
  const stats = await collectEngramStats(`${project.path}/.dev-vault`, {
    runCount: parseRunWindow(runsParam),
    projectName: project.name,
    socketPath,
  });
  sendJson(res, 200, stats);
}

/** `GET /api/engram/health?project=<name>` — daemon health, null when down. */
export async function getEngramHealth(
  res: ServerResponse,
  project: Project,
  pool: EngramPool,
): Promise<void> {
  const { socketPath } = pool.getConnection(project);
  const health = await engramHealth(socketPath);
  sendJson(res, 200, { healthy: health !== null, status: health });
}
