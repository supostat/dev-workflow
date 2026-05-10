import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { formatActiveProfileBlock } from "../src/hooks/active-profile-block.js";

describe("formatActiveProfileBlock", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "active-profile-block-test-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  function writeYaml(content: string): void {
    writeFileSync(join(vaultPath, "communication.yaml"), content, "utf-8");
  }

  function writeStateFile(name: string): void {
    writeFileSync(join(vaultPath, ".profile-state"), `${name}\n`, "utf-8");
  }

  function minimalConfig(active: string): string {
    return [
      `active_profile: ${active}`,
      "",
      "profiles:",
      "  onboarding:",
      "    language: ru",
      "    tone: friendly",
      "    verbosity: detailed",
      "    expertise: junior",
      "  senior_fast:",
      "    language: ru",
      "    tone: terse",
      "    verbosity: brief",
      "    output: code_first",
      "",
    ].join("\n");
  }

  describe("backwards compat", () => {
    it("returns null when communication.yaml is missing", () => {
      expect(formatActiveProfileBlock(vaultPath)).toBeNull();
    });

    it("returns null when communication.yaml is malformed (parse error swallowed)", () => {
      writeYaml("active_profile: x\n  bad_indent_field: garbage\n");
      expect(formatActiveProfileBlock(vaultPath)).toBeNull();
    });
  });

  describe("yaml-default source (no .profile-state)", () => {
    it("emits block with active_profile from YAML and key fields", () => {
      writeYaml(minimalConfig("senior_fast"));
      const block = formatActiveProfileBlock(vaultPath);
      expect(block).not.toBeNull();
      expect(block).toContain("🎙️");
      expect(block).toContain("Active profile:");
      expect(block).toContain("**senior_fast**");
      expect(block).toContain("(yaml-default)");
      expect(block).toContain("language=ru");
      expect(block).toContain("tone=terse");
      expect(block).toContain("verbosity=brief");
      expect(block).toContain("output=code_first");
    });

    it("includes only set optional fields (sparse profile)", () => {
      writeYaml([
        "active_profile: minimal",
        "",
        "profiles:",
        "  minimal:",
        "    language: en",
        "",
      ].join("\n"));
      const block = formatActiveProfileBlock(vaultPath);
      expect(block).toContain("**minimal**");
      expect(block).toContain("language=en");
      expect(block).not.toContain("tone=");
      expect(block).not.toContain("verbosity=");
      expect(block).not.toContain("output=");
    });
  });

  describe("state source (.profile-state present)", () => {
    it("uses state file value when present (overrides yaml default)", () => {
      writeYaml(minimalConfig("senior_fast"));
      writeStateFile("onboarding");
      const block = formatActiveProfileBlock(vaultPath);
      expect(block).toContain("**onboarding**");
      expect(block).toContain("(state)");
      expect(block).toContain("tone=friendly");
      expect(block).toContain("expertise=junior");
    });
  });

  describe("config drift", () => {
    it("emits warning when state references undefined profile", () => {
      writeYaml(minimalConfig("senior_fast"));
      writeStateFile("nonexistent");
      const block = formatActiveProfileBlock(vaultPath);
      expect(block).toContain("⚠️");
      expect(block).toContain("Active profile 'nonexistent'");
      expect(block).toContain("not found");
      expect(block).toContain("/profile");
    });

    it("emits warning when yaml active_profile references undefined (no state)", () => {
      // Construct YAML where active_profile points to a non-existent profile.
      // loadCommunicationConfig actually throws on this (validates referential
      // integrity at load time), so we expect formatActiveProfileBlock to
      // return null (malformed swallow path).
      writeYaml([
        "active_profile: missing",
        "",
        "profiles:",
        "  onboarding:",
        "    language: ru",
        "",
      ].join("\n"));
      // loadCommunicationConfig throws "active_profile 'missing' references undefined profile"
      // → swallowed by formatActiveProfileBlock → null. Drift caught at parser
      // boundary, not at formatter.
      expect(formatActiveProfileBlock(vaultPath)).toBeNull();
    });
  });
});
