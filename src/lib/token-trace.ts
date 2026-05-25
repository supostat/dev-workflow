import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { detectContext } from "./context.js";

const TOKEN_TRACE_SUFFIX = ".tokens.jsonl";
const ORPHAN_TOKENS_FILE = "orphan-tokens.jsonl";
const WORKFLOW_STATE_DIR = "workflow-state";
const ORPHAN_RUN_ID = "orphan";
const UNKNOWN_STEP = "unknown";

export interface TokenTracePayload {
  path?: string;
  memoryId?: string;
  memoryType?: string;
  query?: string;
}

export interface TokenTraceRecord {
  runId: string;
  step: string;
  timestamp: string;
  source: string;
  payload: TokenTracePayload;
  tokens: number;
  chars: number;
}

const ensuredDirs = new Set<string>();
const orphanPathCache = new Map<
  string,
  { filePath: string; runId: string } | null
>();

/**
 * Resolve where a token trace should be written for the current process state.
 *
 * Active run (`ENGRAM_TRACE_FILE` + `ENGRAM_RUN_ID` both set): the token JSONL
 * is a sibling of the engram trace file — `<dir>/<runId>.tokens.jsonl`.
 *
 * Orphan (no active run): resolve the vault at most once per cwd. `detectContext`
 * spawns git subprocesses plus an fs-walk, so it must never run per choke-point
 * call. cwd is stable in the long-lived MCP server -> one `detectContext` per
 * process in practice. The memo guard is `cached !== undefined`, NOT a
 * truthiness check: a cached `null` is the VALID "this cwd has no vault" result,
 * and re-checking it with truthiness would re-invoke `detectContext` on every
 * orphan call for a vault-less cwd.
 */
function resolveTokenTracePath(): { filePath: string; runId: string } | null {
  const traceFile = process.env["ENGRAM_TRACE_FILE"];
  const runId = process.env["ENGRAM_RUN_ID"];
  if (traceFile && runId) {
    return {
      filePath: join(dirname(traceFile), runId + TOKEN_TRACE_SUFFIX),
      runId,
    };
  }

  const cwd = process.cwd();
  const cached = orphanPathCache.get(cwd);
  if (cached !== undefined) return cached;
  const context = detectContext();
  const resolved = context
    ? {
        filePath: join(context.vaultPath, WORKFLOW_STATE_DIR, ORPHAN_TOKENS_FILE),
        runId: ORPHAN_RUN_ID,
      }
    : null;
  orphanPathCache.set(cwd, resolved);
  return resolved;
}

/**
 * Append a per-call token/char measurement as a JSONL sibling of the engram
 * trace. The caller supplies only `{ source, payload, tokens, chars }`; the
 * writer stamps `runId`, `step`, and `timestamp`. The full record is built by
 * explicit field copy (no spread of the caller's object) so the caller's object
 * is never mutated and no stray keys leak into the JSONL.
 */
export function appendTokenTrace(
  record: Omit<TokenTraceRecord, "runId" | "step" | "timestamp">,
): void {
  try {
    const target = resolveTokenTracePath();
    if (!target) return;
    const full: TokenTraceRecord = {
      runId: target.runId,
      step: process.env["ENGRAM_STEP"] || UNKNOWN_STEP,
      timestamp: new Date().toISOString(),
      source: record.source,
      payload: record.payload,
      tokens: record.tokens,
      chars: record.chars,
    };
    const dir = dirname(target.filePath);
    if (!ensuredDirs.has(dir)) {
      mkdirSync(dir, { recursive: true });
      ensuredDirs.add(dir);
    }
    appendFileSync(target.filePath, JSON.stringify(full) + "\n");
  } catch {
    // Documented fail-safe measurement boundary — token-trace failures must
    // never bubble; measurement is best-effort, matching appendEngramTrace.
  }
}
