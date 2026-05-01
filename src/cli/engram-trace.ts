import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectContext } from "../lib/context.js";
import type { EngramTraceEvent } from "../lib/engram-trace.js";

interface MethodSummary {
  method: string;
  count: number;
  totalDurationMs: number;
  errors: number;
}

export function engramTrace(args: string[]): void {
  const runId = args[0];
  if (!runId) {
    console.error("Usage: dev-workflow engram-trace <runId> [--raw]");
    process.exitCode = 1;
    return;
  }

  const context = detectContext(process.cwd());
  if (!context) {
    console.error("Not a dev-workflow project (no .dev-vault/ found).");
    process.exitCode = 1;
    return;
  }

  const tracePath = join(
    context.vaultPath,
    "workflow-state",
    "runs",
    `${runId}.engram-trace.jsonl`,
  );

  const raw = args.includes("--raw");
  let content: string;
  try {
    content = readFileSync(tracePath, "utf-8");
  } catch (error) {
    const isMissing =
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ENOENT";
    if (isMissing) {
      console.error(`Trace file not found: ${tracePath}`);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to read trace file: ${message}`);
    }
    process.exitCode = 1;
    return;
  }
  const lines = content.split("\n").filter((line) => line.trim().length > 0);

  if (raw) {
    for (const line of lines) console.log(line);
    return;
  }

  const events = parseTraceLines(lines);
  printSummary(runId, events);
}

function parseTraceLines(lines: string[]): EngramTraceEvent[] {
  const events: EngramTraceEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as EngramTraceEvent);
    } catch {
      // skip malformed lines silently — partial trace is better than no trace
    }
  }
  return events;
}

function printSummary(runId: string, events: EngramTraceEvent[]): void {
  const byMethod = new Map<string, MethodSummary>();
  let totalDuration = 0;
  let totalErrors = 0;
  for (const event of events) {
    totalDuration += event.duration_ms;
    const summary = byMethod.get(event.method) ?? {
      method: event.method,
      count: 0,
      totalDurationMs: 0,
      errors: 0,
    };
    summary.count += 1;
    summary.totalDurationMs += event.duration_ms;
    if (!event.ok) {
      summary.errors += 1;
      totalErrors += 1;
    }
    byMethod.set(event.method, summary);
  }

  const slowest = [...events]
    .sort((a, b) => b.duration_ms - a.duration_ms)
    .slice(0, 5);

  const fingerprints = new Set<string>();
  for (const event of events) {
    const query = (event.params["query"] as string | undefined) ?? "";
    const tags = JSON.stringify(event.params["tags"] ?? null);
    fingerprints.add(`${event.method}|${query}|${tags}`);
  }

  console.log(`# Engram trace: ${runId}`);
  console.log(
    `Calls: ${events.length} | Total duration: ${totalDuration}ms | Errors: ${totalErrors}`,
  );
  console.log(`Unique fingerprints: ${fingerprints.size}`);
  console.log(``);
  console.log(`## Calls by method`);
  for (const summary of byMethod.values()) {
    console.log(
      `- ${summary.method}: ${summary.count} calls, ${summary.totalDurationMs}ms total, ${summary.errors} errors`,
    );
  }
  console.log(``);
  console.log(`## Slowest 5`);
  for (const event of slowest) {
    const status = event.ok ? "ok" : `ERR ${event.error ?? ""}`;
    console.log(`- ${event.duration_ms}ms ${event.method} ${status}`);
  }
}
