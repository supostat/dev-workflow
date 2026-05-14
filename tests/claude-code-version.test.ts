import { describe, it, expect } from "vitest";
import {
  MIN_CLAUDE_CODE_VERSION,
  compareVersions,
  getClaudeCodeVersion,
  requireClaudeCodeVersion,
} from "../src/lib/claude-code-version.js";

describe("MIN_CLAUDE_CODE_VERSION", () => {
  it("is exported as a string in N.N.N format", () => {
    expect(typeof MIN_CLAUDE_CODE_VERSION).toBe("string");
    expect(MIN_CLAUDE_CODE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("2.1.101", "2.1.101")).toBe(0);
  });

  it("returns -1 when a < b at major level", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
  });

  it("returns 1 when a > b at major level", () => {
    expect(compareVersions("3.0.0", "2.9.9")).toBe(1);
  });

  it("compares numerically, not lexicographically (1.2.10 > 1.2.9)", () => {
    expect(compareVersions("1.2.10", "1.2.9")).toBe(1);
    expect(compareVersions("1.2.9", "1.2.10")).toBe(-1);
    // The bug a naive lexicographic compare would have:
    expect(compareVersions("2.1.101", "2.1.99")).toBe(1);
    expect(compareVersions("2.1.99", "2.1.101")).toBe(-1);
  });

  it("treats missing segments as zero (1.2 == 1.2.0)", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1", "1.0.0")).toBe(0);
  });

  it("compares minor correctly when major equal", () => {
    expect(compareVersions("2.1.0", "2.2.0")).toBe(-1);
    expect(compareVersions("2.3.0", "2.2.99")).toBe(1);
  });
});

describe("getClaudeCodeVersion", () => {
  it("parses '2.1.101 (Claude Code)' format correctly", () => {
    const result = getClaudeCodeVersion(() => "2.1.101 (Claude Code)\n");
    expect(result).toBe("2.1.101");
  });

  it("parses leading N.N.N triple even with trailing junk", () => {
    const result = getClaudeCodeVersion(() => "1.2.3 some other text 4.5.6");
    expect(result).toBe("1.2.3");
  });

  it("returns null when executor throws (CLI missing)", () => {
    const result = getClaudeCodeVersion(() => {
      throw new Error("ENOENT");
    });
    expect(result).toBeNull();
  });

  it("returns null when output has no semver prefix", () => {
    const result = getClaudeCodeVersion(() => "unknown command\n");
    expect(result).toBeNull();
  });

  it("returns null on empty output", () => {
    const result = getClaudeCodeVersion(() => "");
    expect(result).toBeNull();
  });
});

describe("requireClaudeCodeVersion", () => {
  it("returns ok=true with detected version when >= minimum", () => {
    const result = requireClaudeCodeVersion(
      "2.1.101",
      () => "2.1.101 (Claude Code)",
    );
    expect(result).toEqual({
      ok: true,
      detected: "2.1.101",
      minimum: "2.1.101",
      status: "ok",
    });
  });

  it("returns ok=true when detected version > minimum", () => {
    const result = requireClaudeCodeVersion(
      "2.1.101",
      () => "3.0.0 (Claude Code)",
    );
    expect(result.ok).toBe(true);
    expect(result.detected).toBe("3.0.0");
    expect(result.status).toBe("ok");
  });

  it("returns ok=false (REFUSE) when detected version < minimum", () => {
    const result = requireClaudeCodeVersion(
      "2.1.101",
      () => "2.1.99 (Claude Code)",
    );
    expect(result).toEqual({
      ok: false,
      detected: "2.1.99",
      minimum: "2.1.101",
      status: "too-old",
    });
  });

  it("returns ok=true with detected=null when CLI not on PATH (advisory)", () => {
    const result = requireClaudeCodeVersion("2.1.101", () => {
      throw new Error("ENOENT");
    });
    expect(result).toEqual({
      ok: true,
      detected: null,
      minimum: "2.1.101",
      status: "not-detected",
    });
  });

  it("returns not-detected when output is unparseable (treated like missing CLI)", () => {
    const result = requireClaudeCodeVersion("2.1.101", () => "not a version");
    expect(result.detected).toBeNull();
    expect(result.status).toBe("not-detected");
    expect(result.ok).toBe(true);
  });

  it("uses MIN_CLAUDE_CODE_VERSION as default minimum", () => {
    const result = requireClaudeCodeVersion(undefined, () => "9.9.9 (Claude Code)");
    expect(result.minimum).toBe(MIN_CLAUDE_CODE_VERSION);
    expect(result.ok).toBe(true);
  });
});
