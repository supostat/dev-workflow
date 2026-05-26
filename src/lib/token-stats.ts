import type { TokenTraceRecord } from "./token-trace.js";
import { discoverTokenRuns, readTokenTrace } from "./token-trace-store.js";

const ALL_RUNS_LABEL = "(all runs)";

const FILE_TOKENS_THRESHOLD = 5000;
const FILE_REREAD_THRESHOLD = 3;
const SOURCE_DOMINANCE_PERCENT = 40;
const TOTAL_TOKENS_THRESHOLD = 500_000;
const MEMORY_REPEAT_THRESHOLD = 5;
const STEP_GROWTH_FLAG_PERCENT = 10;

const VAULT_READ_SOURCE = "vault_read";
const MEMORY_SEARCH_SOURCE = "memory_search";
const MEMORY_JUDGE_SOURCE = "memory_judge";

export interface TokenGroup {
  name: string;
  tokens: number;
  percent: number;
}

export interface SourceGroup {
  name: string;
  tokens: number;
  callCount: number;
  avgTokens: number;
}

export interface FileGroup {
  path: string;
  tokens: number;
  reads: number;
}

export interface TokenWarning {
  kind: "split" | "dominant_source" | "total_budget" | "engram_cache";
  message: string;
}

export interface TokenRunStats {
  runId: string;
  totalTokens: number;
  totalChars: number;
  recordCount: number;
  durationMs: number | null;
  startedAt: string | null;
  endedAt: string | null;
  stepCount: number;
  byStep: TokenGroup[];
  bySource: SourceGroup[];
  byVaultFile: FileGroup[];
  byEngramType: TokenGroup[];
  warnings: TokenWarning[];
}

export interface StepDelta {
  step: string;
  tokensA: number;
  tokensB: number;
  deltaTokens: number;
  deltaPercent: number | null;
  arrow: "↑" | "↓" | "→";
  flagged: boolean;
}

export interface TokenCompareStats {
  runA: string;
  runB: string;
  totalA: number;
  totalB: number;
  steps: StepDelta[];
}

function percentOf(tokens: number, total: number): number {
  return total > 0 ? Math.round((tokens / total) * 100) : 0;
}

function byTokensDescending(a: { tokens: number }, b: { tokens: number }): number {
  return b.tokens - a.tokens;
}

function groupTokens(
  records: TokenTraceRecord[],
  total: number,
  keyOf: (record: TokenTraceRecord) => string | null,
): TokenGroup[] {
  const tokensByKey = new Map<string, number>();
  for (const record of records) {
    const key = keyOf(record);
    if (key === null) continue;
    tokensByKey.set(key, (tokensByKey.get(key) ?? 0) + record.tokens);
  }
  return [...tokensByKey.entries()]
    .map(([name, tokens]) => ({ name, tokens, percent: percentOf(tokens, total) }))
    .sort(byTokensDescending);
}

function groupSources(records: TokenTraceRecord[]): SourceGroup[] {
  const accumulator = new Map<string, { tokens: number; callCount: number }>();
  for (const record of records) {
    const entry = accumulator.get(record.source) ?? { tokens: 0, callCount: 0 };
    entry.tokens += record.tokens;
    entry.callCount += 1;
    accumulator.set(record.source, entry);
  }
  return [...accumulator.entries()]
    .map(([name, { tokens, callCount }]) => ({
      name,
      tokens,
      callCount,
      avgTokens: Math.round(tokens / callCount),
    }))
    .sort(byTokensDescending);
}

function groupVaultFiles(records: TokenTraceRecord[]): FileGroup[] {
  const accumulator = new Map<string, { tokens: number; reads: number }>();
  for (const record of records) {
    if (record.source !== VAULT_READ_SOURCE) continue;
    const path = record.payload.path;
    if (typeof path !== "string") continue;
    const entry = accumulator.get(path) ?? { tokens: 0, reads: 0 };
    entry.tokens += record.tokens;
    entry.reads += 1;
    accumulator.set(path, entry);
  }
  return [...accumulator.entries()]
    .map(([path, { tokens, reads }]) => ({ path, tokens, reads }))
    .sort(byTokensDescending);
}

function countMaxMemoryIdRepeats(records: TokenTraceRecord[]): number {
  const repeatsById = new Map<string, number>();
  for (const record of records) {
    if (record.source !== MEMORY_JUDGE_SOURCE) continue;
    const memoryId = record.payload.memoryId;
    if (typeof memoryId !== "string") continue;
    repeatsById.set(memoryId, (repeatsById.get(memoryId) ?? 0) + 1);
  }
  return Math.max(0, ...repeatsById.values());
}

function detectWarnings(records: TokenTraceRecord[], total: number): TokenWarning[] {
  const warnings: TokenWarning[] = [];

  for (const file of groupVaultFiles(records)) {
    if (file.tokens > FILE_TOKENS_THRESHOLD && file.reads > FILE_REREAD_THRESHOLD) {
      warnings.push({
        kind: "split",
        message: `${file.path} read ${file.reads}× for ${file.tokens} tokens — consider splitting the file`,
      });
    }
  }

  for (const source of groupSources(records)) {
    if (total > 0 && (source.tokens / total) * 100 > SOURCE_DOMINANCE_PERCENT) {
      warnings.push({
        kind: "dominant_source",
        message: `${source.name} accounts for ${percentOf(source.tokens, total)}% of tokens`,
      });
    }
  }

  if (total > TOTAL_TOKENS_THRESHOLD) {
    warnings.push({
      kind: "total_budget",
      message: `run consumed ${total} tokens — over the ${TOTAL_TOKENS_THRESHOLD} budget`,
    });
  }

  if (countMaxMemoryIdRepeats(records) > MEMORY_REPEAT_THRESHOLD) {
    warnings.push({
      kind: "engram_cache",
      message: `a memory was judged more than ${MEMORY_REPEAT_THRESHOLD}× — consider caching engram results`,
    });
  }

  return warnings;
}

export function aggregateRun(runId: string, records: TokenTraceRecord[]): TokenRunStats {
  let totalTokens = 0;
  let totalChars = 0;
  for (const record of records) {
    totalTokens += record.tokens;
    totalChars += record.chars;
  }

  const timestamps = records.map((record) => record.timestamp).sort();
  const startedAt = timestamps.length > 0 ? timestamps[0]! : null;
  const endedAt = timestamps.length > 0 ? timestamps[timestamps.length - 1]! : null;
  const durationMs =
    startedAt !== null && endedAt !== null
      ? Date.parse(endedAt) - Date.parse(startedAt)
      : null;

  const byStep = groupTokens(records, totalTokens, (record) => record.step);
  const byEngramType = groupTokens(records, totalTokens, (record) =>
    record.source === MEMORY_SEARCH_SOURCE && typeof record.payload.memoryType === "string"
      ? record.payload.memoryType
      : null,
  );

  return {
    runId,
    totalTokens,
    totalChars,
    recordCount: records.length,
    durationMs,
    startedAt,
    endedAt,
    stepCount: byStep.length,
    byStep,
    bySource: groupSources(records),
    byVaultFile: groupVaultFiles(records),
    byEngramType,
    warnings: detectWarnings(records, totalTokens),
  };
}

export function aggregateAll(vaultPath: string): TokenRunStats {
  const pooled: TokenTraceRecord[] = [];
  for (const run of discoverTokenRuns(vaultPath)) {
    pooled.push(...readTokenTrace(run.filePath));
  }
  const stats = aggregateRun(ALL_RUNS_LABEL, pooled);
  return { ...stats, durationMs: null };
}

function tokensByStep(records: TokenTraceRecord[]): Map<string, number> {
  const byStep = new Map<string, number>();
  for (const record of records) {
    byStep.set(record.step, (byStep.get(record.step) ?? 0) + record.tokens);
  }
  return byStep;
}

function buildStepDelta(step: string, tokensA: number, tokensB: number): StepDelta {
  const deltaTokens = tokensB - tokensA;
  const deltaPercent = tokensA > 0 ? Math.round((deltaTokens / tokensA) * 100) : null;
  const arrow = deltaTokens > 0 ? "↑" : deltaTokens < 0 ? "↓" : "→";
  const flagged =
    deltaPercent !== null ? deltaPercent > STEP_GROWTH_FLAG_PERCENT : true;
  return { step, tokensA, tokensB, deltaTokens, deltaPercent, arrow, flagged };
}

export function compareRuns(
  runA: string,
  recordsA: TokenTraceRecord[],
  runB: string,
  recordsB: TokenTraceRecord[],
): TokenCompareStats {
  const byStepA = tokensByStep(recordsA);
  const byStepB = tokensByStep(recordsB);
  const stepNames = [...new Set([...byStepA.keys(), ...byStepB.keys()])].sort();

  const steps = stepNames.map((step) =>
    buildStepDelta(step, byStepA.get(step) ?? 0, byStepB.get(step) ?? 0),
  );

  return {
    runA,
    runB,
    totalA: recordsA.reduce((sum, record) => sum + record.tokens, 0),
    totalB: recordsB.reduce((sum, record) => sum + record.tokens, 0),
    steps,
  };
}
