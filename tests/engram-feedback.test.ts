import { describe, it, expect } from "vitest";
import {
  parseEngramFeedback,
  extractEngramFeedbackSection,
} from "../src/lib/engram-feedback.js";

describe("extractEngramFeedbackSection()", () => {
  it("returns full output as body and null section when heading absent", () => {
    const output = "findings text\nno heading here";
    const { bodyForGate, feedbackSection } = extractEngramFeedbackSection(output);
    expect(bodyForGate).toBe(output);
    expect(feedbackSection).toBeNull();
  });

  it("splits body before heading and section after heading", () => {
    const output = [
      "APPROVE",
      "",
      "## Engram Feedback",
      "- id-1: 0.8 — useful",
    ].join("\n");
    const { bodyForGate, feedbackSection } = extractEngramFeedbackSection(output);
    expect(bodyForGate).toBe("APPROVE\n\n");
    expect(feedbackSection).toBe("- id-1: 0.8 — useful");
  });

  it("stops section at next h2 heading", () => {
    const output = [
      "APPROVE",
      "## Engram Feedback",
      "- id-1: 0.8 — used",
      "## Next Section",
      "other text",
    ].join("\n");
    const { bodyForGate, feedbackSection } = extractEngramFeedbackSection(output);
    expect(bodyForGate).toBe("APPROVE\n");
    expect(feedbackSection).toBe("- id-1: 0.8 — used");
  });

  it("matches heading case-insensitively", () => {
    const output = [
      "APPROVE",
      "## ENGRAM FEEDBACK",
      "- id-1: 0.5 — meh",
    ].join("\n");
    const { feedbackSection } = extractEngramFeedbackSection(output);
    expect(feedbackSection).toBe("- id-1: 0.5 — meh");
  });
});

describe("parseEngramFeedback()", () => {
  it("parses multiple memories with correct format", () => {
    const output = [
      "some body",
      "## Engram Feedback",
      "- id-1: 0.8 — applied pattern",
      "- id-2: 0.3 — marginally relevant",
      "- id-3: 0.0 — misleading",
    ].join("\n");
    const result = parseEngramFeedback(output, ["id-1", "id-2", "id-3"]);
    expect(result.judgments.get("id-1")).toEqual({ score: 0.8, explanation: "applied pattern" });
    expect(result.judgments.get("id-2")).toEqual({ score: 0.3, explanation: "marginally relevant" });
    expect(result.judgments.get("id-3")).toEqual({ score: 0, explanation: "misleading" });
    expect(result.fallbackIds).toEqual([]);
  });

  it("parses single memory", () => {
    const output = "## Engram Feedback\n- only-id: 1.0 — direct hit";
    const result = parseEngramFeedback(output, ["only-id"]);
    expect(result.judgments.get("only-id")).toEqual({ score: 1.0, explanation: "direct hit" });
    expect(result.fallbackIds).toEqual([]);
  });

  it("returns empty result when expected ids is empty", () => {
    const output = "## Engram Feedback\n- some-id: 0.5 — text";
    const result = parseEngramFeedback(output, []);
    expect(result.judgments.size).toBe(0);
    expect(result.fallbackIds).toEqual([]);
  });

  it("puts all expected ids in fallback when feedback section missing", () => {
    const output = "just a body, no heading";
    const result = parseEngramFeedback(output, ["id-1", "id-2"]);
    expect(result.judgments.size).toBe(0);
    expect(result.fallbackIds).toEqual(["id-1", "id-2"]);
  });

  it("tolerates extra whitespace around delimiters", () => {
    const output = [
      "## Engram Feedback",
      "-   id-1  :   0.7   —   spaced",
      "\t-\tid-2: 0.4 — leading tab",
    ].join("\n");
    const result = parseEngramFeedback(output, ["id-1", "id-2"]);
    expect(result.judgments.get("id-1")).toEqual({ score: 0.7, explanation: "spaced" });
    expect(result.judgments.get("id-2")).toEqual({ score: 0.4, explanation: "leading tab" });
  });

  it("splits on first em-dash when explanation contains em-dash", () => {
    const output = "## Engram Feedback\n- id-1: 0.8 — part one — part two";
    const result = parseEngramFeedback(output, ["id-1"]);
    expect(result.judgments.get("id-1")).toEqual({ score: 0.8, explanation: "part one — part two" });
  });

  it("accepts em-dash, en-dash, and ASCII hyphen delimiters", () => {
    const output = [
      "## Engram Feedback",
      "- id-em: 0.5 — em-dash variant",
      "- id-en: 0.5 – en-dash variant",
      "- id-ascii: 0.5 - ascii hyphen variant",
    ].join("\n");
    const result = parseEngramFeedback(output, ["id-em", "id-en", "id-ascii"]);
    expect(result.judgments.get("id-em")?.explanation).toBe("em-dash variant");
    expect(result.judgments.get("id-en")?.explanation).toBe("en-dash variant");
    expect(result.judgments.get("id-ascii")?.explanation).toBe("ascii hyphen variant");
  });

  it("sends score out of range to fallback", () => {
    const output = [
      "## Engram Feedback",
      "- id-high: 1.5 — too high",
      "- id-low: -0.2 — negative",
      "- id-ok: 0.7 — valid",
    ].join("\n");
    const result = parseEngramFeedback(output, ["id-high", "id-low", "id-ok"]);
    expect(result.judgments.has("id-high")).toBe(false);
    expect(result.judgments.has("id-low")).toBe(false);
    expect(result.judgments.get("id-ok")?.score).toBe(0.7);
    expect(result.fallbackIds).toContain("id-high");
    expect(result.fallbackIds).toContain("id-low");
  });

  it("ignores unknown memory ids that are not in expected list", () => {
    const output = [
      "## Engram Feedback",
      "- id-known: 0.8 — in expected",
      "- id-unknown: 0.9 — not in expected",
    ].join("\n");
    const result = parseEngramFeedback(output, ["id-known"]);
    expect(result.judgments.get("id-known")?.score).toBe(0.8);
    expect(result.judgments.has("id-unknown")).toBe(false);
    expect(result.fallbackIds).toEqual([]);
  });

  it("keeps first occurrence when a memory id is duplicated", () => {
    const output = [
      "## Engram Feedback",
      "- id-dup: 0.9 — first",
      "- id-dup: 0.1 — second",
    ].join("\n");
    const result = parseEngramFeedback(output, ["id-dup"]);
    expect(result.judgments.get("id-dup")).toEqual({ score: 0.9, explanation: "first" });
  });

  it("skips malformed lines and continues parsing the rest", () => {
    const output = [
      "## Engram Feedback",
      "- id-good: 0.8 — fine",
      "not a bullet line",
      "- no-delimiter-here",
      "- id-other: abc — non-numeric score",
      "- id-final: 0.5 — also fine",
    ].join("\n");
    const result = parseEngramFeedback(output, ["id-good", "id-other", "id-final"]);
    expect(result.judgments.get("id-good")?.score).toBe(0.8);
    expect(result.judgments.get("id-final")?.score).toBe(0.5);
    expect(result.judgments.has("id-other")).toBe(false);
    expect(result.fallbackIds).toContain("id-other");
  });

  it("accepts empty explanation as valid", () => {
    const output = "## Engram Feedback\n- id-1: 0.5 —";
    const result = parseEngramFeedback(output, ["id-1"]);
    expect(result.judgments.get("id-1")).toEqual({ score: 0.5, explanation: "" });
  });

  it("accepts UUID-style and mixed-case memory ids", () => {
    const output = [
      "## Engram Feedback",
      "- 3f5a9c2e-1234-5678-90ab-cdef12345678: 0.8 — uuid",
      "- MixedCaseID: 0.5 — case preserved",
    ].join("\n");
    const expected = ["3f5a9c2e-1234-5678-90ab-cdef12345678", "MixedCaseID"];
    const result = parseEngramFeedback(output, expected);
    expect(result.judgments.size).toBe(2);
    expect(result.judgments.has("3f5a9c2e-1234-5678-90ab-cdef12345678")).toBe(true);
    expect(result.judgments.has("MixedCaseID")).toBe(true);
  });

  it("integrates with realistic reviewer output containing severity keywords in body", () => {
    const output = [
      "severity: high",
      "file: src/foo.ts",
      "line: 42",
      "issue: potential XSS",
      "suggestion: escape HTML",
      "",
      "APPROVE",
      "",
      "## Engram Feedback",
      "- mem-review-1: 0.9 — flagged identical XSS pattern",
      "- mem-review-2: 0.2 — not applicable here",
    ].join("\n");
    const { bodyForGate } = extractEngramFeedbackSection(output);
    expect(bodyForGate).toContain("severity: high");
    expect(bodyForGate).toContain("APPROVE");
    expect(bodyForGate).not.toContain("## Engram Feedback");

    const result = parseEngramFeedback(output, ["mem-review-1", "mem-review-2"]);
    expect(result.judgments.get("mem-review-1")?.score).toBe(0.9);
    expect(result.judgments.get("mem-review-2")?.explanation).toBe("not applicable here");
  });

  it("lists missing expected ids in fallback when agent skips some", () => {
    const output = [
      "## Engram Feedback",
      "- id-1: 0.8 — judged",
    ].join("\n");
    const result = parseEngramFeedback(output, ["id-1", "id-2", "id-3"]);
    expect(result.judgments.get("id-1")?.score).toBe(0.8);
    expect(result.fallbackIds).toEqual(["id-2", "id-3"]);
  });
});
