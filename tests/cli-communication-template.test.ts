import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { communicationTemplate } from "../src/cli/communication-template.js";
import { readCommunicationTemplate } from "../src/lib/communication-template.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCommunicationConfig } from "../src/lib/communication.js";

describe("communication-template CLI command", () => {
  let logOutput: string[];
  let origLog: typeof console.log;

  beforeEach(() => {
    logOutput = [];
    origLog = console.log;
    console.log = ((msg: string) => {
      logOutput.push(String(msg));
      return true;
    }) as typeof console.log;
  });

  afterEach(() => {
    console.log = origLog;
  });

  function captured(): string {
    return logOutput.join("\n");
  }

  it("prints the bootstrap header docblock", () => {
    communicationTemplate();
    const out = captured();
    expect(out).toContain("# Communication profiles for dev-workflow agents.");
    expect(out).toContain("# Bootstrap (run once):");
    expect(out).toContain("`/profile <name>`");
  });

  it("prints active_profile = senior_fast as default", () => {
    communicationTemplate();
    const out = captured();
    expect(out).toMatch(/^active_profile: senior_fast$/m);
  });

  it("prints all 4 ADR profile headers (onboarding, senior_fast, code_review, bilingual)", () => {
    communicationTemplate();
    const out = captured();
    for (const name of ["onboarding:", "senior_fast:", "code_review:", "bilingual:"]) {
      expect(out).toMatch(new RegExp(`^  ${name}$`, "m"));
    }
  });

  it("prints the allowed-values reference block", () => {
    communicationTemplate();
    const out = captured();
    expect(out).toContain("language          : ru | en | auto");
    expect(out).toContain("tone              : friendly | terse | formal");
    expect(out).toContain("severity_levels   : inline array");
  });
});

describe("readCommunicationTemplate (lib)", () => {
  it("returns string content (PACKAGE_ROOT-resolved)", () => {
    const content = readCommunicationTemplate();
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("output round-trips through loadCommunicationConfig parser without error", () => {
    // Integration: bundled template + lib parser invariant.
    // Symmetric to tests/lib-communication.test.ts "bundled template" — there we
    // read via copyFileSync; here via the CLI-oracle lib function. Both must agree.
    const tmpVault = mkdtempSync(join(tmpdir(), "comm-tpl-cli-test-"));
    try {
      writeFileSync(join(tmpVault, "communication.yaml"), readCommunicationTemplate());
      const config = loadCommunicationConfig(tmpVault);
      expect(config).not.toBeNull();
      expect(config!.active_profile).toBe("senior_fast");
      expect(Object.keys(config!.profiles).sort()).toEqual([
        "bilingual",
        "code_review",
        "onboarding",
        "senior_fast",
      ]);
    } finally {
      rmSync(tmpVault, { recursive: true, force: true });
    }
  });
});
