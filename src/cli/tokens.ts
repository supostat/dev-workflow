import { detectContext } from "../lib/context.js";
import { aggregateRun, aggregateAll, compareRuns } from "../lib/token-stats.js";
import {
  discoverTokenRuns,
  isValidRunId,
  mostRecentTokenRun,
  readTokenTrace,
  tokenTracePathFor,
} from "../lib/token-trace-store.js";
import type { TokenTraceRecord } from "../lib/token-trace.js";
import { formatAnalyze, formatCompare, formatTail } from "./tokens-format.js";

const DEFAULT_TAIL_LINES = 20;

function requireVault(): { vaultPath: string } | null {
  const context = detectContext();
  if (!context) {
    console.error("Not a dev-workflow project (no .dev-vault/ found).");
    process.exitCode = 1;
    return null;
  }
  return { vaultPath: context.vaultPath };
}

function parseLines(args: string[]): number {
  const idx = args.indexOf("--lines");
  if (idx === -1 || idx >= args.length - 1) return DEFAULT_TAIL_LINES;
  const value = Number(args[idx + 1]);
  if (!Number.isFinite(value) || value < 1) return DEFAULT_TAIL_LINES;
  return Math.floor(value);
}

function positionalArg(args: string[]): string | undefined {
  return args.find((arg) => !arg.startsWith("--"));
}

/**
 * Reject a user-supplied run id that does not match the canonical
 * `run-<12hex>` shape (or the `orphan` sentinel) BEFORE it reaches the path
 * builder, neutralizing path traversal. Filesystem-derived run ids (no-arg /
 * `--all`) never pass through here, so legitimate discovered runs are
 * untouched. On rejection: error + exitCode 1, no constructed path echoed.
 */
function guardRunId(runId: string): boolean {
  if (isValidRunId(runId)) return true;
  console.error(`Invalid run id: ${runId}`);
  process.exitCode = 1;
  return false;
}

function readTraceOrError(vaultPath: string, runId: string): TokenTraceRecord[] | null {
  const tracePath = tokenTracePathFor(vaultPath, runId);
  try {
    return readTokenTrace(tracePath);
  } catch (error) {
    const isMissing =
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ENOENT";
    if (isMissing) {
      console.error(`Token trace not found: ${tracePath}`);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to read token trace: ${message}`);
    }
    process.exitCode = 1;
    return null;
  }
}

function analyze(args: string[]): void {
  const vault = requireVault();
  if (!vault) return;
  const jsonMode = args.includes("--json");

  if (args.includes("--all")) {
    if (discoverTokenRuns(vault.vaultPath).length === 0) {
      console.error("No token traces found.");
      process.exitCode = 1;
      return;
    }
    const stats = aggregateAll(vault.vaultPath);
    if (jsonMode) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      for (const line of formatAnalyze(stats)) console.log(line);
    }
    return;
  }

  const explicitRunId = positionalArg(args);
  if (explicitRunId !== undefined && !guardRunId(explicitRunId)) return;
  const runId = explicitRunId ?? mostRecentTokenRun(vault.vaultPath)?.runId;
  if (!runId) {
    console.error("No token traces found.");
    process.exitCode = 1;
    return;
  }

  const records = readTraceOrError(vault.vaultPath, runId);
  if (records === null) return;
  if (records.length === 0) {
    console.error(`No token records in run ${runId}.`);
    process.exitCode = 1;
    return;
  }

  const stats = aggregateRun(runId, records);
  if (jsonMode) {
    console.log(JSON.stringify(stats, null, 2));
  } else {
    for (const line of formatAnalyze(stats)) console.log(line);
  }
}

function compare(args: string[]): void {
  const vault = requireVault();
  if (!vault) return;
  const jsonMode = args.includes("--json");
  const positionals = args.filter((arg) => !arg.startsWith("--"));
  if (positionals.length < 2) {
    console.error("Usage: dev-workflow tokens compare <runA> <runB> [--json]");
    process.exitCode = 1;
    return;
  }
  if (!guardRunId(positionals[0]!) || !guardRunId(positionals[1]!)) return;

  const recordsA = readTraceOrError(vault.vaultPath, positionals[0]!);
  if (recordsA === null) return;
  const recordsB = readTraceOrError(vault.vaultPath, positionals[1]!);
  if (recordsB === null) return;

  const stats = compareRuns(positionals[0]!, recordsA, positionals[1]!, recordsB);
  if (jsonMode) {
    console.log(JSON.stringify(stats, null, 2));
  } else {
    for (const line of formatCompare(stats)) console.log(line);
  }
}

function tail(args: string[]): void {
  const vault = requireVault();
  if (!vault) return;
  const count = parseLines(args);
  const explicitRunId = positionalArg(args);
  if (explicitRunId !== undefined && !guardRunId(explicitRunId)) return;
  const runId = explicitRunId ?? mostRecentTokenRun(vault.vaultPath)?.runId;
  if (!runId) {
    console.error("No token traces found.");
    process.exitCode = 1;
    return;
  }

  const records = readTraceOrError(vault.vaultPath, runId);
  if (records === null) return;
  for (const line of formatTail(records, count)) console.log(line);
}

export function tokens(args: string[]): void {
  const subcommand = args[0];
  switch (subcommand) {
    case "analyze":
      analyze(args.slice(1));
      break;
    case "compare":
      compare(args.slice(1));
      break;
    case "tail":
      tail(args.slice(1));
      break;
    default:
      console.error(
        "Usage: dev-workflow tokens analyze|compare|tail [<runId>] [--json] [--all] [--lines N]",
      );
      process.exitCode = 1;
  }
}
