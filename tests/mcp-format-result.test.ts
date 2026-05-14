import { describe, it, expect } from "vitest";
import { formatToolResult } from "../src/mcp/format-result.js";

describe("formatToolResult — named per-tool formatters", () => {
  it("workflow_start renders runId + trace path on two lines", () => {
    const out = formatToolResult("workflow_start", {
      runId: "run-1a2b3c4d5e6f",
      traceFilePath: "/vault/workflow-state/runs/run-1a2b3c4d5e6f.engram-trace.jsonl",
    });
    expect(out).toBe(
      "✓ workflow started — runId=run-1a2b3c4d5e6f\n  trace: /vault/workflow-state/runs/run-1a2b3c4d5e6f.engram-trace.jsonl",
    );
  });

  it("step_start renders bare checkmark (no payload to surface)", () => {
    expect(formatToolResult("step_start", { ok: true })).toBe("✓");
  });

  it("step_complete renders counts for judgments / fallbacks / antipatterns", () => {
    const out = formatToolResult("step_complete", {
      judgmentsApplied: 9,
      fallbackIds: ["id-1", "id-2", "id-3"],
      antipatternIdsInBefore: ["id-a", "id-b"],
      antipatternJudgmentDistribution: {},
    });
    expect(out).toBe("✓ 9 judgments applied (3 fallbacks, 2 antipatterns in before-search)");
  });

  it("step_complete handles zero-count case", () => {
    const out = formatToolResult("step_complete", {
      judgmentsApplied: 0,
      fallbackIds: [],
      antipatternIdsInBefore: [],
      antipatternJudgmentDistribution: {},
    });
    expect(out).toBe("✓ 0 judgments applied (0 fallbacks, 0 antipatterns in before-search)");
  });

  it("memory_store renders the stored memory id", () => {
    expect(formatToolResult("memory_store", { id: "abc-def-123" })).toBe("✓ stored: abc-def-123");
  });

  it("memory_judge renders judged ack", () => {
    expect(formatToolResult("memory_judge", { ok: true })).toBe("✓ judged");
  });

  it("vault_record renders the recorded filepath", () => {
    expect(
      formatToolResult("vault_record", { filepath: ".dev-vault/architecture/foo.md" }),
    ).toBe("✓ recorded: .dev-vault/architecture/foo.md");
  });
});

describe("formatToolResult — fallbacks and edge cases", () => {
  it("unknown tool falls through to JSON pretty-print", () => {
    const out = formatToolResult("unknown_tool", { a: 1, b: "x" });
    expect(out).toBe('{\n  "a": 1,\n  "b": "x"\n}');
  });

  it("string result passes through unchanged", () => {
    expect(formatToolResult("step_start", "raw text")).toBe("raw text");
    expect(formatToolResult("unknown_tool", "raw text")).toBe("raw text");
  });

  it("null result renders as bare checkmark", () => {
    expect(formatToolResult("step_start", null)).toBe("✓");
    expect(formatToolResult("workflow_start", null)).toBe("✓");
  });

  it("undefined result renders as bare checkmark", () => {
    expect(formatToolResult("step_complete", undefined)).toBe("✓");
  });

  it("malformed result shape falls through to JSON (workflow_start missing runId)", () => {
    const out = formatToolResult("workflow_start", { traceFilePath: "/x.jsonl" });
    expect(out).toBe('{\n  "traceFilePath": "/x.jsonl"\n}');
  });

  it("malformed result shape falls through to JSON (step_complete non-numeric judgmentsApplied)", () => {
    const out = formatToolResult("step_complete", { judgmentsApplied: "nope" });
    expect(out).toBe('{\n  "judgmentsApplied": "nope"\n}');
  });

  it("malformed memory_store missing id falls through to JSON", () => {
    const out = formatToolResult("memory_store", { unrelated: true });
    expect(out).toBe('{\n  "unrelated": true\n}');
  });

  it("default object falls through to JSON pretty-print preserving structure", () => {
    const out = formatToolResult("task_list", [{ id: "task-1" }, { id: "task-2" }]);
    expect(out).toContain('"id": "task-1"');
    expect(out).toContain('"id": "task-2"');
  });
});
