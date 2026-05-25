import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { tokenizeSpy } = vi.hoisted(() => ({ tokenizeSpy: vi.fn() }));

vi.mock("@anthropic-ai/tokenizer", async () => {
  const actual = await vi.importActual<typeof import("@anthropic-ai/tokenizer")>(
    "@anthropic-ai/tokenizer",
  );
  tokenizeSpy.mockImplementation(actual.countTokens);
  return { ...actual, countTokens: tokenizeSpy };
});

import { countTokens, countSections } from "../src/lib/tokens.js";

const EXPECTED_HELLO = 1;
const EXPECTED_FOX = 4;

describe("countTokens", () => {
  beforeEach(() => {
    tokenizeSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the real tokenizer count for a known short string", () => {
    expect(countTokens("hello")).toBe(EXPECTED_HELLO);
  });

  it("returns the real tokenizer count for a known sentence", () => {
    expect(countTokens("the quick brown fox")).toBe(EXPECTED_FOX);
  });

  it("returns 0 for the empty string without a short-circuit", () => {
    expect(countTokens("")).toBe(0);
  });

  it("counts unicode and emoji content as a positive token count", () => {
    expect(countTokens("héllo 🦊 мир")).toBeGreaterThan(0);
  });

  it("serves a repeated string from cache without re-invoking the tokenizer", () => {
    const sentinel = "cache-hit-sentinel-unique-α";
    const first = countTokens(sentinel);
    const callsAfterFirst = tokenizeSpy.mock.calls.length;
    const second = countTokens(sentinel);

    expect(second).toBe(first);
    expect(tokenizeSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it("invokes the tokenizer once per distinct string", () => {
    countTokens("distinct-sentinel-one-β");
    countTokens("distinct-sentinel-two-γ");

    expect(tokenizeSpy.mock.calls.length).toBe(2);
  });

  it("evicts the oldest entry once capacity is exceeded", () => {
    const oldest = "evict-probe-oldest-ζ";
    countTokens(oldest);
    for (let i = 0; i < 200; i++) countTokens(`evict-probe-fill-${i}-ζ`);
    const callsBefore = tokenizeSpy.mock.calls.length;
    countTokens(oldest); // evicted → cache miss → re-tokenizes
    expect(tokenizeSpy.mock.calls.length).toBe(callsBefore + 1);
  });

  it("promotes a re-read entry so it survives eviction", () => {
    const kept = "lru-keep-η";
    countTokens(kept);
    for (let i = 0; i < 199; i++) countTokens(`lru-fill-${i}-η`); // size = 200, kept is oldest
    countTokens(kept); // re-read → promoted to tail
    countTokens("lru-overflow-η"); // size = 201 → evicts the new oldest, not kept
    const callsBefore = tokenizeSpy.mock.calls.length;
    countTokens(kept); // still cached → no re-tokenize
    expect(tokenizeSpy.mock.calls.length).toBe(callsBefore);
  });
});

describe("countSections", () => {
  beforeEach(() => {
    tokenizeSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sums per-section counts into total", () => {
    const result = countSections({
      stack: "section-sentinel-stack-δ",
      knowledge: "section-sentinel-knowledge-ε",
    });

    const expectedTotal = result.sections["stack"]! + result.sections["knowledge"]!;
    expect(result.total).toBe(expectedTotal);
    expect(result.total).toBeGreaterThan(0);
  });

  it("returns an empty result for an empty section map", () => {
    expect(countSections({})).toEqual({ sections: {}, total: 0 });
  });

  it("counts an empty-value section as 0", () => {
    const result = countSections({ blank: "" });

    expect(result.sections["blank"]).toBe(0);
    expect(result.total).toBe(0);
  });
});
