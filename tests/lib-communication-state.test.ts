import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getActiveProfile,
  setActiveProfile,
  clearActiveProfile,
} from "../src/lib/communication-state.js";

const STATE_FILE_NAME = ".profile-state";

describe("communication-state", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "comm-state-test-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  function writeState(content: string): void {
    writeFileSync(join(vaultPath, STATE_FILE_NAME), content, "utf-8");
  }

  describe("getActiveProfile", () => {
    it("returns trimmed name from valid file", () => {
      writeState("senior_fast");
      expect(getActiveProfile(vaultPath)).toBe("senior_fast");
    });

    it("returns trimmed name when file ends with newline", () => {
      writeState("onboarding\n");
      expect(getActiveProfile(vaultPath)).toBe("onboarding");
    });

    it("returns trimmed name when surrounded by whitespace", () => {
      writeState("  code-review  \n");
      expect(getActiveProfile(vaultPath)).toBe("code-review");
    });

    it("returns null when file is missing", () => {
      expect(getActiveProfile(vaultPath)).toBeNull();
    });

    it("returns null when file is empty", () => {
      writeState("");
      expect(getActiveProfile(vaultPath)).toBeNull();
    });

    it("returns null when file contains only whitespace", () => {
      writeState("   \n\t  \n");
      expect(getActiveProfile(vaultPath)).toBeNull();
    });
  });

  describe("setActiveProfile", () => {
    it("writes valid name with trailing newline", () => {
      setActiveProfile(vaultPath, "senior_fast");
      const written = readFileSync(join(vaultPath, STATE_FILE_NAME), "utf-8");
      expect(written).toBe("senior_fast\n");
    });

    it("overwrites existing state file", () => {
      setActiveProfile(vaultPath, "onboarding");
      setActiveProfile(vaultPath, "senior_fast");
      const written = readFileSync(join(vaultPath, STATE_FILE_NAME), "utf-8");
      expect(written).toBe("senior_fast\n");
    });

    it("round-trip: getActiveProfile after set returns same value", () => {
      setActiveProfile(vaultPath, "onboarding");
      expect(getActiveProfile(vaultPath)).toBe("onboarding");
    });

    it("accepts hyphenated name (code-review)", () => {
      expect(() => setActiveProfile(vaultPath, "code-review")).not.toThrow();
      expect(getActiveProfile(vaultPath)).toBe("code-review");
    });

    it("accepts underscored name (senior_fast)", () => {
      expect(() => setActiveProfile(vaultPath, "senior_fast")).not.toThrow();
      expect(getActiveProfile(vaultPath)).toBe("senior_fast");
    });

    it("rejects name with space", () => {
      expect(() => setActiveProfile(vaultPath, "bad name")).toThrow(
        /Invalid profile name/,
      );
    });

    it("rejects leading hyphen", () => {
      expect(() => setActiveProfile(vaultPath, "-bad")).toThrow(
        /Invalid profile name/,
      );
    });

    it("accepts leading digit (parser regex \\w allows 0-9)", () => {
      // Plan D1: regex matches communication.ts parseYamlLine — \w includes digits.
      // Accepting leading digit keeps state validation in lockstep with config parser.
      expect(() => setActiveProfile(vaultPath, "9bad")).not.toThrow();
      expect(getActiveProfile(vaultPath)).toBe("9bad");
    });

    it("rejects dot in name", () => {
      expect(() => setActiveProfile(vaultPath, "bad.name")).toThrow(
        /Invalid profile name/,
      );
    });

    it("rejects empty string", () => {
      expect(() => setActiveProfile(vaultPath, "")).toThrow(
        /Invalid profile name/,
      );
    });

    it("error message includes regex source for user debugging", () => {
      expect(() => setActiveProfile(vaultPath, "bad name")).toThrow(
        /\^\[\\w\]\[\\w_-\]\*\$/,
      );
    });
  });

  describe("clearActiveProfile", () => {
    it("deletes existing state file (subsequent getActiveProfile returns null)", () => {
      setActiveProfile(vaultPath, "onboarding");
      expect(existsSync(join(vaultPath, STATE_FILE_NAME))).toBe(true);

      clearActiveProfile(vaultPath);

      expect(existsSync(join(vaultPath, STATE_FILE_NAME))).toBe(false);
      expect(getActiveProfile(vaultPath)).toBeNull();
    });

    it("is no-op when state file is missing (does not throw)", () => {
      expect(() => clearActiveProfile(vaultPath)).not.toThrow();
    });

    it("re-throws non-ENOENT errors (e.g. EISDIR when path is a directory)", () => {
      // Real-fixture coverage of the non-ENOENT branch in clearActiveProfile.
      // vi.mock is forbidden per conventions.md — use EISDIR via directory path.
      mkdirSync(join(vaultPath, STATE_FILE_NAME));

      expect(() => clearActiveProfile(vaultPath)).toThrow();
      // The thrown error preserves its errno code (not ENOENT).
      try {
        clearActiveProfile(vaultPath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        expect(code).not.toBe("ENOENT");
        expect(["EISDIR", "EPERM", "EACCES"]).toContain(code);
      }
    });
  });
});
