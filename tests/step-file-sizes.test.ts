import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computeStepSizes, getStepBodyTokens, getStepBodyChars, parseSizesFile, stepSizesByName } from "../src/lib/step-file-sizes.js";

describe("computeStepSizes", () => {
  let stepsDir: string;

  beforeEach(() => {
    stepsDir = mkdtempSync(join(tmpdir(), "step-sizes-test-"));
  });

  afterEach(() => {
    rmSync(stepsDir, { recursive: true, force: true });
  });

  it("indexes every .md file with positive tokens and char-exact length", () => {
    const planBody = "# Plan\n\nWrite a plan before coding.";
    const coderBody = "# Coder\n\nImplement the approved plan, test-first.";
    writeFileSync(join(stepsDir, "plan.md"), planBody, "utf-8");
    writeFileSync(join(stepsDir, "coder.md"), coderBody, "utf-8");

    const sizes = computeStepSizes(stepsDir);

    expect(Object.keys(sizes).sort()).toEqual(["coder", "plan"]);
    expect(sizes["plan"]!.tokens).toBeGreaterThan(0);
    expect(sizes["coder"]!.tokens).toBeGreaterThan(0);
    expect(sizes["plan"]!.chars).toBe(planBody.length);
    expect(sizes["coder"]!.chars).toBe(coderBody.length);
  });

  it("ignores non-.md files", () => {
    writeFileSync(join(stepsDir, "plan.md"), "# Plan", "utf-8");
    writeFileSync(join(stepsDir, "notes.txt"), "not a step", "utf-8");

    const sizes = computeStepSizes(stepsDir);

    expect(Object.keys(sizes)).toEqual(["plan"]);
    expect(sizes["notes"]).toBeUndefined();
  });

  it("reflects an edited step body: a longer rewrite yields more tokens and differing chars", () => {
    const version1 = "# Coder\n\nShort body.";
    writeFileSync(join(stepsDir, "coder.md"), version1, "utf-8");
    const before = computeStepSizes(stepsDir)["coder"]!;

    const version2 = version1 + "\n\n" + "Substantially longer instructions. ".repeat(40);
    writeFileSync(join(stepsDir, "coder.md"), version2, "utf-8");
    const after = computeStepSizes(stepsDir)["coder"]!;

    expect(after.tokens).toBeGreaterThan(before.tokens);
    expect(after.chars).not.toBe(before.chars);
    expect(after.chars).toBe(version2.length);
  });

  it("indexes an empty .md body with { tokens: 0, chars: 0 }", () => {
    writeFileSync(join(stepsDir, "coder.md"), "", "utf-8");

    const sizes = computeStepSizes(stepsDir);

    expect(sizes["coder"]).toBeDefined();
    expect(sizes["coder"]!.tokens).toBe(0);
    expect(sizes["coder"]!.chars).toBe(0);
  });
});

describe("stepSizesByName mapping", () => {
  it("re-keys basenames to pipeline step names: code carries coder.md, principles dropped", () => {
    const byName = stepSizesByName({
      preflight: { tokens: 1, chars: 1 },
      read: { tokens: 1, chars: 1 },
      plan: { tokens: 1, chars: 1 },
      "plan-review": { tokens: 1, chars: 1 },
      "plan-fix": { tokens: 1, chars: 1 },
      coder: { tokens: 5, chars: 9 },
      review: { tokens: 1, chars: 1 },
      test: { tokens: 1, chars: 1 },
      verify: { tokens: 1, chars: 1 },
      commit: { tokens: 1, chars: 1 },
      "vault-updates": { tokens: 1, chars: 1 },
      principles: { tokens: 3, chars: 4 },
    });

    expect(byName["code"]).toEqual({ tokens: 5, chars: 9 });
    expect(byName["coder"]).toBeUndefined();
    expect(byName["principles"]).toBeUndefined();
    expect(Object.keys(byName).sort()).toEqual(
      ["code", "commit", "plan", "plan-fix", "plan-review", "preflight", "read", "review", "test", "vault-updates", "verify"].sort(),
    );
  });

  it("throws fail-fast when a mapped basename is missing (step file renamed/deleted)", () => {
    const byBasename: Record<string, { tokens: number; chars: number }> = {
      preflight: { tokens: 1, chars: 1 },
      // `read` intentionally omitted — simulates a renamed/deleted read.md.
      plan: { tokens: 1, chars: 1 },
      "plan-review": { tokens: 1, chars: 1 },
      "plan-fix": { tokens: 1, chars: 1 },
      coder: { tokens: 1, chars: 1 },
      review: { tokens: 1, chars: 1 },
      test: { tokens: 1, chars: 1 },
      verify: { tokens: 1, chars: 1 },
      commit: { tokens: 1, chars: 1 },
      "vault-updates": { tokens: 1, chars: 1 },
    };

    expect(() => stepSizesByName(byBasename)).toThrow(/read.*read/);
  });
});

describe("parseSizesFile fail-safe", () => {
  let scratchDir: string;

  beforeEach(() => {
    scratchDir = mkdtempSync(join(tmpdir(), "parse-sizes-test-"));
  });

  afterEach(() => {
    rmSync(scratchDir, { recursive: true, force: true });
  });

  it("returns {} for a missing file without throwing", () => {
    const missingPath = join(tmpdir(), `does-not-exist-${Date.now()}.json`);
    expect(() => parseSizesFile(missingPath)).not.toThrow();
    expect(parseSizesFile(missingPath)).toEqual({});
  });

  it("returns {} for a corrupt JSON file", () => {
    const corruptPath = join(scratchDir, "corrupt.json");
    writeFileSync(corruptPath, "{ not valid json", "utf-8");

    expect(parseSizesFile(corruptPath)).toEqual({});
  });

  it("round-trips a valid sizes file", () => {
    const validPath = join(scratchDir, "valid.json");
    writeFileSync(validPath, JSON.stringify({ plan: { tokens: 3, chars: 10 } }), "utf-8");

    expect(parseSizesFile(validPath)).toEqual({ plan: { tokens: 3, chars: 10 } });
  });
});

describe("getStepBodyTokens / getStepBodyChars fail-safe", () => {
  it("returns 0 for an unknown step name without throwing", () => {
    expect(() => getStepBodyTokens("definitely-not-a-real-step-xyz")).not.toThrow();
    expect(getStepBodyTokens("definitely-not-a-real-step-xyz")).toBe(0);
    expect(getStepBodyChars("definitely-not-a-real-step-xyz")).toBe(0);
  });

  it("returns a non-negative count for a shipped step (>= 0, never asserting load success)", () => {
    expect(getStepBodyTokens("code")).toBeGreaterThanOrEqual(0);
    expect(getStepBodyChars("code")).toBeGreaterThanOrEqual(0);
  });
});
