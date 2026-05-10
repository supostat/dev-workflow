import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCommunicationConfig } from "../src/lib/communication.js";

describe("loadCommunicationConfig", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "comm-test-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  function writeConfig(content: string): void {
    writeFileSync(join(vaultPath, "communication.yaml"), content);
  }

  describe("happy path", () => {
    it("loads minimal valid config (single profile, language only)", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  simple:",
          "    language: en",
          "",
        ].join("\n"),
      );

      const config = loadCommunicationConfig(vaultPath);

      expect(config).not.toBeNull();
      expect(config!.active_profile).toBe("simple");
      expect(Object.keys(config!.profiles)).toEqual(["simple"]);
      expect(config!.profiles["simple"]!.language).toBe("en");
    });

    it("loads all 4 ADR profiles with full field set", () => {
      writeConfig(
        [
          "active_profile: senior_fast",
          "",
          "profiles:",
          "  onboarding:",
          "    language: ru",
          "    tone: friendly",
          "    verbosity: detailed",
          "    expertise: junior",
          "    explanations: with_alternatives",
          "",
          "  senior_fast:",
          "    language: ru",
          "    tone: terse",
          "    verbosity: brief",
          "    expertise: senior",
          "    output: code_first",
          "    ask_before_acting: false",
          "",
          "  code_review:",
          "    language: ru",
          "    tone: formal",
          "    verbosity: structured",
          "    output_format: review_template",
          "    emojis: false",
          "    severity_levels: [CRITICAL, HIGH, MEDIUM, LOW]",
          "",
          "  bilingual:",
          "    language: auto",
          "    fallback_language: en",
          "    code_comments: en",
          "    commit_messages: en",
          "    docs_language: en",
          "    session_logs: ru",
          "",
        ].join("\n"),
      );

      const config = loadCommunicationConfig(vaultPath);

      expect(config).not.toBeNull();
      expect(config!.active_profile).toBe("senior_fast");
      expect(Object.keys(config!.profiles).sort()).toEqual([
        "bilingual",
        "code_review",
        "onboarding",
        "senior_fast",
      ]);

      const onboarding = config!.profiles["onboarding"]!;
      expect(onboarding.language).toBe("ru");
      expect(onboarding.tone).toBe("friendly");
      expect(onboarding.verbosity).toBe("detailed");
      expect(onboarding.expertise).toBe("junior");
      expect(onboarding.explanations).toBe("with_alternatives");

      const seniorFast = config!.profiles["senior_fast"]!;
      expect(seniorFast.tone).toBe("terse");
      expect(seniorFast.output).toBe("code_first");
      expect(seniorFast.ask_before_acting).toBe(false);

      const codeReview = config!.profiles["code_review"]!;
      expect(codeReview.output_format).toBe("review_template");
      expect(codeReview.emojis).toBe(false);
      expect(codeReview.severity_levels).toEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

      const bilingual = config!.profiles["bilingual"]!;
      expect(bilingual.language).toBe("auto");
      expect(bilingual.fallback_language).toBe("en");
      expect(bilingual.code_comments).toBe("en");
      expect(bilingual.session_logs).toBe("ru");
    });

    it("handles optional fields gracefully (only language present)", () => {
      writeConfig(
        [
          "active_profile: bare",
          "",
          "profiles:",
          "  bare:",
          "    language: ru",
          "",
        ].join("\n"),
      );

      const config = loadCommunicationConfig(vaultPath);
      const profile = config!.profiles["bare"]!;
      expect(profile.language).toBe("ru");
      expect(profile.tone).toBeUndefined();
      expect(profile.verbosity).toBeUndefined();
      expect(profile.ask_before_acting).toBeUndefined();
    });
  });

  describe("fail-safe", () => {
    it("returns null when communication.yaml missing", () => {
      expect(loadCommunicationConfig(vaultPath)).toBeNull();
    });

    it("returns null when vault directory itself missing", () => {
      const missing = join(vaultPath, "does-not-exist");
      expect(loadCommunicationConfig(missing)).toBeNull();
    });
  });

  describe("structural errors", () => {
    it("throws on missing active_profile field", () => {
      writeConfig(
        [
          "profiles:",
          "  simple:",
          "    language: en",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/active_profile/);
    });

    it("throws on missing profiles section", () => {
      writeConfig(["active_profile: simple", ""].join("\n"));

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/profiles/);
    });

    it("throws on active_profile referencing undefined profile (with available list)", () => {
      writeConfig(
        [
          "active_profile: ghost",
          "",
          "profiles:",
          "  simple:",
          "    language: en",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/ghost/);
      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/simple/);
    });

    it("throws on profile missing required language field", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  simple:",
          "    tone: terse",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/language/);
    });
  });

  describe("enum validation errors", () => {
    it("throws on invalid tone with valid list in message", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  simple:",
          "    language: en",
          "    tone: verbose",
          "",
        ].join("\n"),
      );

      const error = (() => {
        try {
          loadCommunicationConfig(vaultPath);
          return null;
        } catch (caught) {
          return caught as Error;
        }
      })();

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/communication\.yaml:\d+/);
      expect(error!.message).toContain("verbose");
      expect(error!.message).toContain("valid:");
      expect(error!.message).toContain("friendly");
      expect(error!.message).toContain("terse");
      expect(error!.message).toContain("formal");
    });

    it("throws on invalid verbosity (error includes valid list)", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  simple:",
          "    language: en",
          "    verbosity: short",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/verbosity/);
      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/valid:/);
      expect(() => loadCommunicationConfig(vaultPath)).toThrow(
        /brief|detailed|structured/,
      );
    });

    it("throws on invalid language (error includes valid list)", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  simple:",
          "    language: cz",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/language/);
      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/valid:/);
      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/ru|en|auto/);
    });

    it("throws on invalid output (error includes valid list)", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  simple:",
          "    language: en",
          "    output: pretty",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/output/);
      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/valid:/);
      expect(() => loadCommunicationConfig(vaultPath)).toThrow(
        /code_first|with_alternatives|review_template/,
      );
    });

    it("throws on invalid expertise (error includes valid list)", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  simple:",
          "    language: en",
          "    expertise: principal",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/expertise/);
      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/valid:/);
      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/junior|senior/);
    });
  });

  describe("unknown field detection", () => {
    it("throws on typo (e.g. tone_level instead of tone)", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  simple:",
          "    language: en",
          "    tone_level: terse",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/unknown field/);
      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/tone_level/);
    });

    it("error message includes file:line location", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  simple:",
          "    language: en",
          "    bogus: value",
          "",
        ].join("\n"),
      );

      try {
        loadCommunicationConfig(vaultPath);
        throw new Error("expected throw");
      } catch (caught) {
        const message = (caught as Error).message;
        expect(message).toMatch(/communication\.yaml:6:/);
        expect(message).toContain("bogus");
      }
    });
  });

  describe("edge cases", () => {
    it("throws on duplicate key within profile", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  simple:",
          "    language: en",
          "    tone: terse",
          "    tone: friendly",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/duplicate/);
      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/tone/);
    });

    it("throws on tab indentation with helpful message", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  simple:",
          "\tlanguage: en",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/tab/);
      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/spaces/);
    });

    it("parses boolean values strictly (true/false only)", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  simple:",
          "    language: en",
          "    ask_before_acting: yes",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/boolean/);
      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/ask_before_acting/);
    });

    it("parses inline severity_levels array", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  simple:",
          "    language: en",
          "    severity_levels: [HIGH, LOW]",
          "",
        ].join("\n"),
      );

      const config = loadCommunicationConfig(vaultPath);
      expect(config!.profiles["simple"]!.severity_levels).toEqual(["HIGH", "LOW"]);
    });

    it("skips full-line comments and empty lines", () => {
      writeConfig(
        [
          "# Top-level comment",
          "active_profile: simple",
          "",
          "# Another comment",
          "profiles:",
          "  # Profile comment",
          "  simple:",
          "    language: en",
          "    # field comment",
          "    tone: terse",
          "",
          "",
        ].join("\n"),
      );

      const config = loadCommunicationConfig(vaultPath);
      expect(config!.profiles["simple"]!.tone).toBe("terse");
    });

    it("loads ADR canonical example end-to-end", () => {
      writeConfig(
        [
          "active_profile: senior_fast",
          "",
          "profiles:",
          "  onboarding:",
          "    language: ru",
          "    tone: friendly",
          "    verbosity: detailed",
          "    expertise: junior",
          "    explanations: with_alternatives",
          "",
          "  senior_fast:",
          "    language: ru",
          "    tone: terse",
          "    verbosity: brief",
          "    expertise: senior",
          "    output: code_first",
          "    ask_before_acting: false",
          "",
          "  code_review:",
          "    language: ru",
          "    tone: formal",
          "    verbosity: structured",
          "    output_format: review_template",
          "    emojis: false",
          "    severity_levels: [CRITICAL, HIGH, MEDIUM, LOW]",
          "",
          "  bilingual:",
          "    language: auto",
          "    fallback_language: en",
          "    code_comments: en",
          "    commit_messages: en",
          "    docs_language: en",
          "    session_logs: ru",
          "",
        ].join("\n"),
      );

      const config = loadCommunicationConfig(vaultPath);
      expect(config).not.toBeNull();
      expect(config!.active_profile).toBe("senior_fast");
      expect(Object.keys(config!.profiles)).toHaveLength(4);
    });
  });

  describe("parser error paths", () => {
    it("throws on garbage line that does not match key:value pattern", () => {
      writeConfig(
        [
          "active_profile: simple",
          "!!notakey here",
          "profiles:",
          "  simple:",
          "    language: en",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/malformed line/);
    });

    it("throws on indented field appearing before 'profiles:' header", () => {
      writeConfig(
        [
          "active_profile: simple",
          "  language: ru",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(
        /indented field 'language' before 'profiles:' header/,
      );
    });

    it("throws on field at depth 4 with no parent profile (skipped depth 2)", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "    language: ru",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(
        /field 'language' has no parent profile/,
      );
    });

    it("throws on unexpected indent depth 1", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          " simple:",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/unexpected indent/);
    });

    it("throws on unexpected indent depth 3", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "   simple:",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/unexpected indent/);
    });

    it("throws on unexpected indent depth 6", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  simple:",
          "      language: ru",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/unexpected indent/);
    });

    it("throws on empty active_profile value", () => {
      writeConfig(
        [
          "active_profile:",
          "",
          "profiles:",
          "  simple:",
          "    language: en",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(
        /active_profile has empty value/,
      );
    });

    it("throws when 'profiles:' header has inline value", () => {
      writeConfig(
        [
          "active_profile: simple",
          "profiles: something",
          "  simple:",
          "    language: en",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/must have no inline value/);
    });

    it("throws on unknown top-level key", () => {
      writeConfig(
        [
          "active_profile: simple",
          "other_key: value",
          "profiles:",
          "  simple:",
          "    language: en",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/unknown top-level key/);
      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/other_key/);
    });

    it("throws when profile name has inline value", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  simple: inline_value",
          "    language: en",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(
        /must be followed by ':' only/,
      );
    });

    it("throws on duplicate profile name", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  simple:",
          "    language: en",
          "  simple:",
          "    language: ru",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/duplicate profile/);
      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/simple/);
    });

    it("throws on empty string field value (output_format)", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  simple:",
          "    language: en",
          "    output_format:",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/empty value/);
      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/output_format/);
    });

    it("throws on array value missing brackets", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  simple:",
          "    language: en",
          "    severity_levels: HIGH, LOW",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/inline array syntax/);
    });
  });

  describe("verbatim parsing (no inline-comment / quote stripping)", () => {
    it("treats inline '#' as part of the value (no comment stripping)", () => {
      // Per ADR: inline comments are NOT supported in MVP; the value is parsed
      // verbatim and rejected by the enum check.
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  simple:",
          "    language: ru # russian",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/language/);
      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/ru # russian/);
    });

    it("preserves quotes literally in string field values", () => {
      writeConfig(
        [
          'active_profile: simple',
          '',
          'profiles:',
          '  simple:',
          '    language: en',
          '    output_format: "quoted value"',
          '',
        ].join("\n"),
      );

      const config = loadCommunicationConfig(vaultPath);
      expect(config!.profiles["simple"]!.output_format).toBe('"quoted value"');
    });
  });

  describe("prototype-pollution defense", () => {
    afterEach(() => {
      // Sanity: ensure no test in this group leaked a prototype mutation.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((({} as any) as Record<string, unknown>)["polluted"]).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((({} as any) as Record<string, unknown>)["language"]).toBeUndefined();
    });

    it("rejects profile named '__proto__'", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  __proto__:",
          "    language: en",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(
        /reserved JavaScript identifier/,
      );
    });

    it("rejects profile named 'constructor'", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  constructor:",
          "    language: en",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(
        /reserved JavaScript identifier/,
      );
    });

    it("rejects profile named 'prototype'", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  prototype:",
          "    language: en",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(
        /reserved JavaScript identifier/,
      );
    });

    it("rejects field key '__proto__' inside a profile", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  simple:",
          "    language: en",
          "    __proto__: { polluted: true }",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/unknown field/);
      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/__proto__/);
    });

    it("rejects field key 'constructor' inside a profile", () => {
      writeConfig(
        [
          "active_profile: simple",
          "",
          "profiles:",
          "  simple:",
          "    language: en",
          "    constructor: malicious",
          "",
        ].join("\n"),
      );

      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/unknown field/);
      expect(() => loadCommunicationConfig(vaultPath)).toThrow(/constructor/);
    });
  });

  describe("bundled template templates/project/communication-yaml.example", () => {
    // Integration: parses through loadCommunicationConfig — guards drift between
    // the bundled example and the parser/schema. Any field rename, allowed-value
    // change, or yaml format shift breaks this test before downstream consumers.

    it("parses cleanly and exposes 4 ADR profiles with senior_fast active", () => {
      copyFileSync(
        join(process.cwd(), "templates/project/communication-yaml.example"),
        join(vaultPath, "communication.yaml"),
      );

      const config = loadCommunicationConfig(vaultPath);

      expect(config).not.toBeNull();
      expect(config!.active_profile).toBe("senior_fast");
      expect(Object.keys(config!.profiles).sort()).toEqual([
        "bilingual",
        "code_review",
        "onboarding",
        "senior_fast",
      ]);

      // Spot-check key fields per profile to lock the example against silent drift.
      expect(config!.profiles.onboarding!.tone).toBe("friendly");
      expect(config!.profiles.onboarding!.expertise).toBe("junior");

      expect(config!.profiles.senior_fast!.output).toBe("code_first");
      expect(config!.profiles.senior_fast!.ask_before_acting).toBe(false);

      expect(config!.profiles.code_review!.emojis).toBe(false);
      expect(config!.profiles.code_review!.severity_levels).toEqual([
        "CRITICAL",
        "HIGH",
        "MEDIUM",
        "LOW",
      ]);

      expect(config!.profiles.bilingual!.language).toBe("auto");
      expect(config!.profiles.bilingual!.commit_messages).toBe("en");
    });
  });
});
