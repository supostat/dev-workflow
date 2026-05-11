import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

export interface EngramTraceEvent {
  ts: string;
  method: string;
  params: Record<string, unknown>;
  ok: boolean;
  response_summary: string;
  duration_ms: number;
  error?: string;
}

const ensuredDirs = new Set<string>();

export function appendEngramTrace(event: EngramTraceEvent): void {
  const filePath = process.env["ENGRAM_TRACE_FILE"];
  if (!filePath) return;
  try {
    const dir = dirname(filePath);
    if (!ensuredDirs.has(dir)) {
      mkdirSync(dir, { recursive: true });
      ensuredDirs.add(dir);
    }
    appendFileSync(filePath, JSON.stringify(event) + "\n");
  } catch {
    // Trace failures must never bubble — observability is best-effort,
    // matching engram socket fail-safe semantics.
  }
}

export const DEFAULT_TRACE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const DEFAULT_TRACE_MAX_FILES = 100;

/**
 * Garbage-collect stale `*.engram-trace.jsonl` files. Closes debt
 * `2026-05-01-engram-trace-file-rotationarchival-policy.md` via Option 1
 * (lazy GC at session-start).
 *
 * Deletes a trace file iff EITHER:
 *  - mtime older than `maxAgeMs` (default 30 days), OR
 *  - file is older than the most-recent `maxFiles` traces (default 100).
 *
 * Fire-and-forget — silent on all errors (matches `appendEngramTrace`
 * fail-safe). Returns the number of files deleted for caller telemetry.
 * Skips the file pointed to by `ENGRAM_TRACE_FILE` (in-flight trace —
 * never GC the one actively being written).
 */
export function gcEngramTraces(
  runsDir: string,
  options: { maxAgeMs?: number; maxFiles?: number } = {},
): number {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_TRACE_MAX_AGE_MS;
  const maxFiles = options.maxFiles ?? DEFAULT_TRACE_MAX_FILES;
  const activePath = process.env["ENGRAM_TRACE_FILE"];

  let entries: Array<{ path: string; mtime: number }>;
  try {
    entries = readdirSync(runsDir)
      .filter((name) => name.endsWith(".engram-trace.jsonl"))
      .map((name) => join(runsDir, name))
      .filter((path) => path !== activePath)
      .map((path) => ({ path, mtime: statSync(path).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime); // newest first
  } catch {
    return 0;
  }

  const now = Date.now();
  let deleted = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const tooOld = now - entry.mtime > maxAgeMs;
    const beyondCap = i >= maxFiles;
    if (tooOld || beyondCap) {
      try {
        unlinkSync(entry.path);
        deleted++;
      } catch {
        // ignore — file may have been deleted concurrently or be locked
      }
    }
  }
  return deleted;
}
