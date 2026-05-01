import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

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
