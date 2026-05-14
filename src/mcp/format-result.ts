/**
 * Per-tool human-readable formatter for MCP `tools/call` text content.
 *
 * Replaces the default `JSON.stringify(result, null, 2)` for a small set of
 * high-traffic tools whose results render as multi-line JSON blocks that
 * clutter the conversation UI. Handler return values are NOT changed —
 * formatting only affects the `content[0].text` field of the JSON-RPC
 * response, where structured data is anyway just rendered to the user.
 *
 * Named formatters extract the operationally-significant fields into a
 * compact single-line summary (or short multi-line for workflow_start
 * which carries two distinct paths). Unknown tools and shape mismatches
 * fall through to the default JSON pretty-print so no information is
 * silently dropped.
 */

type Formatter = (result: unknown) => string;

const NAMED_FORMATTERS: Record<string, Formatter> = {
  workflow_start: (result) => {
    const r = result as { runId?: string; traceFilePath?: string };
    if (!r.runId || !r.traceFilePath) throw new Error("shape mismatch");
    return `✓ workflow started — runId=${r.runId}\n  trace: ${r.traceFilePath}`;
  },

  step_start: () => "✓",

  step_complete: (result) => {
    const r = result as {
      judgmentsApplied?: number;
      fallbackIds?: unknown[];
      antipatternIdsInBefore?: unknown[];
    };
    if (typeof r.judgmentsApplied !== "number") throw new Error("shape mismatch");
    const judgments = r.judgmentsApplied;
    const fallbacks = Array.isArray(r.fallbackIds) ? r.fallbackIds.length : 0;
    const antipatterns = Array.isArray(r.antipatternIdsInBefore)
      ? r.antipatternIdsInBefore.length
      : 0;
    return `✓ ${judgments} judgments applied (${fallbacks} fallbacks, ${antipatterns} antipatterns in before-search)`;
  },

  memory_store: (result) => {
    const r = result as { id?: string };
    if (typeof r.id !== "string") throw new Error("shape mismatch");
    return `✓ stored: ${r.id}`;
  },

  memory_judge: () => "✓ judged",

  vault_record: (result) => {
    const r = result as { filepath?: string };
    if (typeof r.filepath !== "string") throw new Error("shape mismatch");
    return `✓ recorded: ${r.filepath}`;
  },
};

export function formatToolResult(toolName: string, result: unknown): string {
  if (typeof result === "string") return result;
  if (result === null || result === undefined) return "✓";

  const formatter = NAMED_FORMATTERS[toolName];
  if (formatter) {
    try {
      return formatter(result);
    } catch {
      // Result shape didn't match the formatter's expectations — fall through
      // to JSON.stringify so the caller still sees the actual data.
      return JSON.stringify(result, null, 2);
    }
  }
  return JSON.stringify(result, null, 2);
}
