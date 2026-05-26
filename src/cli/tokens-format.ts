import type {
  TokenRunStats,
  TokenCompareStats,
} from "../lib/token-stats.js";
import type { TokenTraceRecord } from "../lib/token-trace.js";

const TOKENS_COLUMN_WIDTH = 10;
const NAME_COLUMN_WIDTH = 20;
const PAYLOAD_HINT_MAX = 40;

function formatDurationMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60 > 0 ? `${s % 60}s` : ""}`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 > 0 ? `${m % 60}m` : ""}`;
}

function clockOf(timestamp: string): string {
  const match = timestamp.match(/T(\d{2}:\d{2}:\d{2})/);
  return match ? match[1]! : timestamp;
}

export function formatAnalyze(stats: TokenRunStats): string[] {
  const lines: string[] = [];

  lines.push(`# Token usage: ${stats.runId}`);
  lines.push(
    `Tokens: ${stats.totalTokens} | Chars: ${stats.totalChars} | Records: ${stats.recordCount} | Duration: ${formatDurationMs(stats.durationMs)}`,
  );
  lines.push("");

  lines.push("## By step");
  for (const group of stats.byStep) {
    lines.push(
      `  ${group.name.padEnd(NAME_COLUMN_WIDTH)} ${String(group.tokens).padStart(TOKENS_COLUMN_WIDTH)}  ${group.percent}%`,
    );
  }
  lines.push("");

  lines.push("## By source");
  for (const source of stats.bySource) {
    lines.push(
      `  ${source.name.padEnd(NAME_COLUMN_WIDTH)} ${String(source.tokens).padStart(TOKENS_COLUMN_WIDTH)}  ${source.callCount} calls  avg ${source.avgTokens}`,
    );
  }
  lines.push("");

  lines.push("## By vault file");
  if (stats.byVaultFile.length === 0) {
    lines.push("  (no vault_read records)");
  } else {
    for (const file of stats.byVaultFile) {
      lines.push(
        `  ${file.path.padEnd(NAME_COLUMN_WIDTH)} ${String(file.tokens).padStart(TOKENS_COLUMN_WIDTH)}  ${file.reads} reads`,
      );
    }
  }
  lines.push("");

  lines.push("## By engram type");
  if (stats.byEngramType.length === 0) {
    lines.push("  (no engram type data)");
  } else {
    for (const group of stats.byEngramType) {
      lines.push(
        `  ${group.name.padEnd(NAME_COLUMN_WIDTH)} ${String(group.tokens).padStart(TOKENS_COLUMN_WIDTH)}  ${group.percent}%`,
      );
    }
  }

  if (stats.warnings.length > 0) {
    lines.push("");
    lines.push("## Warnings");
    for (const warning of stats.warnings) {
      lines.push(`  ⚠ ${warning.message}`);
    }
  }

  return lines;
}

export function formatCompare(stats: TokenCompareStats): string[] {
  const lines: string[] = [];
  lines.push(`Comparing ${stats.runA} → ${stats.runB}`);
  const totalDelta = stats.totalB - stats.totalA;
  const totalPercent =
    stats.totalA > 0 ? Math.round((totalDelta / stats.totalA) * 100) : null;
  const totalPercentLabel = totalPercent === null ? "—" : `${totalPercent}%`;
  lines.push(`Total: ${stats.totalA} → ${stats.totalB}  (Δ ${totalDelta}, ${totalPercentLabel})`);
  lines.push("");

  for (const step of stats.steps) {
    const percentLabel = step.deltaPercent === null ? "new" : `${step.deltaPercent}%`;
    const flag = step.flagged ? " ⚠" : "";
    lines.push(
      `  ${step.step.padEnd(NAME_COLUMN_WIDTH)} ${String(step.tokensA).padStart(TOKENS_COLUMN_WIDTH)} → ${String(step.tokensB).padStart(TOKENS_COLUMN_WIDTH)}  ${step.arrow} ${percentLabel}${flag}`,
    );
  }

  return lines;
}

function payloadHintOf(record: TokenTraceRecord): string {
  const { path, memoryId, query } = record.payload;
  if (typeof path === "string") return path;
  if (typeof memoryId === "string") return memoryId;
  if (typeof query === "string") return query.slice(0, PAYLOAD_HINT_MAX);
  return "";
}

export function formatTail(records: TokenTraceRecord[], count: number): string[] {
  return records.slice(-count).map((record) => {
    return `  ${clockOf(record.timestamp)}  ${record.step.padEnd(NAME_COLUMN_WIDTH)} ${record.source.padEnd(NAME_COLUMN_WIDTH)} ${String(record.tokens).padStart(TOKENS_COLUMN_WIDTH)}  ${payloadHintOf(record)}`;
  });
}
