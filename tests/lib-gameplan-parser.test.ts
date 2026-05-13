import { describe, it, expect } from "vitest";
import {
  parseGameplanPhase,
  VALID_PHASE_NAME_PATTERN,
  GAMEPLAN_PHASE_PATTERN,
} from "../src/lib/gameplan-parser.js";

describe("parseGameplanPhase", () => {
  it("frontmatter priority — frontmatter value wins when present", () => {
    const content = `---
current-phase: engram-hardening
tags: [gameplan]
---
# Gameplan
body only
`;
    expect(parseGameplanPhase(content)).toBe("engram-hardening");
  });

  it("regex fallback — no frontmatter field, parses body marker", () => {
    const content = `---
tags: [gameplan]
---
# Gameplan

## Current Phase

**Active: \`communication-config\`** — started 2026-05-10
`;
    expect(parseGameplanPhase(content)).toBe("communication-config");
  });

  it("frontmatter wins over regex — both present, frontmatter chosen", () => {
    const content = `---
current-phase: frontmatter-phase
---
# Gameplan

**Active: \`body-phase\`** — fallback should NOT be used
`;
    expect(parseGameplanPhase(content)).toBe("frontmatter-phase");
  });

  it("missing section — no frontmatter, no regex match → null", () => {
    const content = `---
tags: [gameplan]
---
# Gameplan

No phase marker at all here.
`;
    expect(parseGameplanPhase(content)).toBeNull();
  });

  it("malformed backticks — Active marker without backticks → null", () => {
    const content = `---
---
## Current Phase

**Active: no-backticks-here** — malformed
`;
    expect(parseGameplanPhase(content)).toBeNull();
  });

  it("invalid chars in body marker — uppercase → null", () => {
    const content = `---
---
**Active: \`Engram-Hardening\`** — uppercase rejected
`;
    expect(parseGameplanPhase(content)).toBeNull();
  });

  it("empty gameplan — empty string → null", () => {
    expect(parseGameplanPhase("")).toBeNull();
  });

  it("empty quoted string in frontmatter → null", () => {
    // parseFrontmatter is value-literal — `""` becomes the 2-char string `""`,
    // which fails VALID_PHASE_NAME_PATTERN. A bare `current-phase:` (no value)
    // is dropped by the frontmatter field regex (requires `.+` after colon),
    // so the field is absent rather than empty — exercised by the
    // "missing section" case above. The defense-in-depth concern is an
    // attacker-controlled empty literal in YAML, covered here.
    const content = `---
current-phase: ""
---
`;
    expect(parseGameplanPhase(content)).toBeNull();
  });

  it("frontmatter array rejected — current-phase: [phase-name] → null", () => {
    const content = `---
current-phase: [phase-name]
---
**Active: \`body-phase\`** — must NOT be used; array signals explicit (malformed) intent
`;
    expect(parseGameplanPhase(content)).toBeNull();
  });

  it("phase name with leading dash rejected", () => {
    const content = `---
current-phase: -leading-dash
---
`;
    expect(parseGameplanPhase(content)).toBeNull();
  });

  it("min length: single char accepted", () => {
    const content = `---
current-phase: a
---
`;
    expect(parseGameplanPhase(content)).toBe("a");
  });

  it("max length: exactly 64 chars accepted", () => {
    const phase = "a" + "b".repeat(63); // 64 chars
    expect(phase.length).toBe(64);
    const content = `---
current-phase: ${phase}
---
`;
    expect(parseGameplanPhase(content)).toBe(phase);
  });

  it("over max length: 65 chars rejected", () => {
    const phase = "a" + "b".repeat(64); // 65 chars
    expect(phase.length).toBe(65);
    const content = `---
current-phase: ${phase}
---
`;
    expect(parseGameplanPhase(content)).toBeNull();
  });

  it("VALID_PHASE_NAME_PATTERN export matches expected character set", () => {
    expect(VALID_PHASE_NAME_PATTERN.test("a")).toBe(true);
    expect(VALID_PHASE_NAME_PATTERN.test("engram-hardening")).toBe(true);
    expect(VALID_PHASE_NAME_PATTERN.test("Phase1")).toBe(false);
    expect(VALID_PHASE_NAME_PATTERN.test("-dash-first")).toBe(false);
    expect(VALID_PHASE_NAME_PATTERN.test("")).toBe(false);
  });

  it("GAMEPLAN_PHASE_PATTERN export matches the documented Active marker", () => {
    const match = "**Active: `engram-hardening`** — note".match(GAMEPLAN_PHASE_PATTERN);
    expect(match?.[1]).toBe("engram-hardening");
  });

  it("returns null for current-phase: null literal (hand-coded YAML parser scalar)", () => {
    // The hand-coded parseFrontmatter treats YAML null as the literal string
    // "null"; without the sentinel guard it would match VALID_PHASE_NAME_PATTERN
    // and be returned as a literal phase name, polluting downstream engram tags.
    const content = `---
current-phase: null
---
body
`;
    expect(parseGameplanPhase(content)).toBeNull();
  });

  it("returns null for current-phase: ~ (YAML null alias)", () => {
    const content = `---
current-phase: ~
---
body
`;
    expect(parseGameplanPhase(content)).toBeNull();
  });

  it("rejects uppercase NULL via VALID_PHASE_NAME_PATTERN (scope boundary)", () => {
    // Scope decision: NULL_LITERAL_SENTINELS is strictly lowercase ("null"/"~").
    // Uppercase NULL is NOT special-cased here — it falls through to the regex,
    // which rejects it because VALID_PHASE_NAME_PATTERN requires lowercase.
    // This test pins the case-sensitivity decision against future scope creep.
    const content = `---
current-phase: NULL
---
`;
    expect(parseGameplanPhase(content)).toBeNull();
  });

  it("rejects mixed-case Null via VALID_PHASE_NAME_PATTERN (not special-cased)", () => {
    const content = `---
current-phase: Null
---
`;
    expect(parseGameplanPhase(content)).toBeNull();
  });

  it("null sentinel in frontmatter takes priority over body Active marker", () => {
    // An explicitly cleared current-phase must NOT fall through to body
    // regex — the sentinel signals authoritative intent.
    const content = `---
current-phase: null
---
## Current Phase

**Active: \`body-phase\`** — must not be used
`;
    expect(parseGameplanPhase(content)).toBeNull();
  });

  it("tilde sentinel in frontmatter takes priority over body Active marker", () => {
    const content = `---
current-phase: ~
---
**Active: \`body-phase\`** — must not be used
`;
    expect(parseGameplanPhase(content)).toBeNull();
  });
});
