import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hashString, hashFile, formatHash } from "../src/lib/spec-hash.js";
import { parseSpecSections } from "../src/lib/spec-parser.js";
import { diffSpecVsVault, printDiffReport } from "../src/lib/spec-diff.js";

describe("hashString", () => {
  it("returns stable sha256 hex for the same input", () => {
    const a = hashString("hello world");
    const b = hashString("hello world");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns different hashes for different inputs", () => {
    expect(hashString("a")).not.toBe(hashString("b"));
  });

  it("handles UTF-8 multi-byte content (cyrillic, emoji)", () => {
    const a = hashString("Привет, мир 🎉");
    const b = hashString("Привет, мир 🎉");
    expect(a).toBe(b);
    expect(a).not.toBe(hashString("Hello, world"));
  });
});

describe("hashFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "spec-hash-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("matches hashString of identical content", () => {
    const path = join(dir, "spec.md");
    const content = "# Stack\n- TypeScript 5.4\n";
    writeFileSync(path, content);
    expect(hashFile(path)).toBe(hashString(content));
  });
});

describe("parseSpecSections", () => {
  it("extracts all 4 sections when present", () => {
    const content = [
      "# Stack",
      "- TypeScript",
      "",
      "# Conventions",
      "- naming: camelCase",
      "",
      "# Knowledge",
      "- arch: clean",
      "",
      "# Gameplan",
      "- phase 1",
    ].join("\n");
    const sections = parseSpecSections(content);
    expect(sections.stack).toBe("- TypeScript");
    expect(sections.conventions).toBe("- naming: camelCase");
    expect(sections.knowledge).toBe("- arch: clean");
    expect(sections.gameplan).toBe("- phase 1");
  });

  it("returns null for missing sections", () => {
    const content = "# Stack\n- TS\n\n# Gameplan\n- p1";
    const sections = parseSpecSections(content);
    expect(sections.stack).toBe("- TS");
    expect(sections.conventions).toBeNull();
    expect(sections.knowledge).toBeNull();
    expect(sections.gameplan).toBe("- p1");
  });

  it("preserves sub-headings inside section content", () => {
    const content = "# Stack\n## Languages\n- TypeScript\n## Frameworks\n- Express";
    const sections = parseSpecSections(content);
    expect(sections.stack).toContain("## Languages");
    expect(sections.stack).toContain("## Frameworks");
    expect(sections.stack).toContain("- TypeScript");
  });

  it("handles non-standard section order", () => {
    const content = [
      "# Knowledge",
      "- k1",
      "# Gameplan",
      "- g1",
      "# Stack",
      "- s1",
      "# Conventions",
      "- c1",
    ].join("\n");
    const sections = parseSpecSections(content);
    expect(sections.stack).toBe("- s1");
    expect(sections.conventions).toBe("- c1");
    expect(sections.knowledge).toBe("- k1");
    expect(sections.gameplan).toBe("- g1");
  });

  it("ignores unknown top-level headings (Bootstrap) without polluting neighbors", () => {
    const content = [
      "# Stack",
      "- TypeScript",
      "# Bootstrap",
      "- npm install",
      "# Gameplan",
      "- phase 1",
    ].join("\n");
    const sections = parseSpecSections(content);
    expect(sections.stack).toBe("- TypeScript");
    expect(sections.gameplan).toBe("- phase 1");
    expect(sections.knowledge).toBeNull();
    expect(sections.conventions).toBeNull();
  });

  it("returns all-null on empty content", () => {
    const sections = parseSpecSections("");
    expect(sections).toEqual({
      stack: null,
      conventions: null,
      knowledge: null,
      gameplan: null,
    });
  });

  it("recognises heading with em-dash suffix", () => {
    const content = "# Stack — Backend Platform\n- TypeScript";
    const sections = parseSpecSections(content);
    expect(sections.stack).toBe("- TypeScript");
  });

  it("recognises heading with parenthetical suffix", () => {
    const content = "# Conventions (v2)\n- camelCase";
    const sections = parseSpecSections(content);
    expect(sections.conventions).toBe("- camelCase");
  });

  it("matches first word case-insensitively", () => {
    const content = "# stack\n- ts";
    const sections = parseSpecSections(content);
    expect(sections.stack).toBe("- ts");
  });
});

describe("diffSpecVsVault", () => {
  let dir: string;
  let vaultPath: string;

  function writeSpec(content: string): string {
    const p = join(dir, "SPEC.md");
    writeFileSync(p, content);
    return p;
  }

  function writeVaultFile(name: string, content: string): void {
    writeFileSync(join(vaultPath, name), content);
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "spec-diff-test-"));
    vaultPath = join(dir, ".dev-vault");
    mkdirSync(vaultPath, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns hasDrift=false when SPEC and vault match", () => {
    const specPath = writeSpec("# Stack\n- TypeScript 5.4\n\n# Gameplan\n- phase 1");
    writeVaultFile("stack.md", "# Stack\n- TypeScript 5.4\n");
    writeVaultFile("gameplan.md", "# Gameplan\n- phase 1\n");
    const report = diffSpecVsVault(specPath, vaultPath);
    expect(report.hasDrift).toBe(false);
    const stack = report.sections.find((s) => s.section === "stack")!;
    expect(stack.status).toBe("match");
  });

  it("detects added lines on SPEC side", () => {
    const specPath = writeSpec("# Stack\n- TypeScript\n- Bun\n");
    writeVaultFile("stack.md", "# Stack\n- TypeScript\n");
    const report = diffSpecVsVault(specPath, vaultPath);
    expect(report.hasDrift).toBe(true);
    const stack = report.sections.find((s) => s.section === "stack")!;
    expect(stack.status).toBe("drift");
    expect(stack.added).toContain("- Bun");
    expect(stack.removed).toEqual([]);
  });

  it("detects removed lines (vault has lines SPEC dropped)", () => {
    const specPath = writeSpec("# Stack\n- TypeScript\n");
    writeVaultFile("stack.md", "# Stack\n- TypeScript\n- Old\n");
    const report = diffSpecVsVault(specPath, vaultPath);
    expect(report.hasDrift).toBe(true);
    const stack = report.sections.find((s) => s.section === "stack")!;
    expect(stack.status).toBe("drift");
    expect(stack.added).toEqual([]);
    expect(stack.removed).toContain("- Old");
  });

  it("detects independent additions on both sides", () => {
    const specPath = writeSpec("# Stack\n- TypeScript\n- New\n");
    writeVaultFile("stack.md", "# Stack\n- TypeScript\n- Old\n");
    const report = diffSpecVsVault(specPath, vaultPath);
    expect(report.hasDrift).toBe(true);
    const stack = report.sections.find((s) => s.section === "stack")!;
    expect(stack.added).toContain("- New");
    expect(stack.removed).toContain("- Old");
  });

  it("reports missing-in-vault when SPEC has section but vault file absent", () => {
    const specPath = writeSpec("# Stack\n- TypeScript\n\n# Knowledge\n- k1");
    writeVaultFile("stack.md", "# Stack\n- TypeScript\n");
    // knowledge.md absent
    const report = diffSpecVsVault(specPath, vaultPath);
    expect(report.hasDrift).toBe(true);
    const knowledge = report.sections.find((s) => s.section === "knowledge")!;
    expect(knowledge.status).toBe("missing-in-vault");
  });

  it("reports missing-in-spec when vault has file but SPEC has no section", () => {
    const specPath = writeSpec("# Stack\n- TypeScript\n");
    writeVaultFile("stack.md", "# Stack\n- TypeScript\n");
    writeVaultFile("knowledge.md", "# Knowledge\n- k1\n");
    const report = diffSpecVsVault(specPath, vaultPath);
    expect(report.hasDrift).toBe(true);
    const knowledge = report.sections.find((s) => s.section === "knowledge")!;
    expect(knowledge.status).toBe("missing-in-spec");
  });

  it("hashMatch is true when stored hash equals current", () => {
    const specContent = "# Stack\n- TS\n";
    const specPath = writeSpec(specContent);
    const expectedHash = formatHash(hashString(specContent));
    writeVaultFile(
      "gameplan.md",
      `---\nspec-hash: ${expectedHash}\n---\n# Gameplan\n`,
    );
    const report = diffSpecVsVault(specPath, vaultPath);
    expect(report.hashMatch).toBe(true);
    expect(report.vaultStoredHash).toBe(expectedHash);
  });

  it("hashMatch is false when stored hash differs", () => {
    const specPath = writeSpec("# Stack\n- TS\n");
    writeVaultFile(
      "gameplan.md",
      "---\nspec-hash: sha256:0000000000000000000000000000000000000000000000000000000000000000\n---\n# Gameplan\n",
    );
    const report = diffSpecVsVault(specPath, vaultPath);
    expect(report.hashMatch).toBe(false);
  });

  it("vaultStoredHash is null when frontmatter has no spec-hash", () => {
    const specPath = writeSpec("# Stack\n- TS\n");
    writeVaultFile("gameplan.md", "---\nupdated: 2026-05-10\n---\n# Gameplan\n");
    const report = diffSpecVsVault(specPath, vaultPath);
    expect(report.vaultStoredHash).toBeNull();
    expect(report.hashMatch).toBe(false);
  });

  it("throws when SPEC.md is missing", () => {
    expect(() => diffSpecVsVault(join(dir, "no-such.md"), vaultPath)).toThrow(
      /SPEC\.md not found/,
    );
  });

  it("throws when vault path does not exist", () => {
    const specPath = writeSpec("# Stack\n- TS\n");
    expect(() => diffSpecVsVault(specPath, join(dir, "no-vault"))).toThrow(
      /Vault not initialized/,
    );
  });

  it("strips vault file H1 heading before diffing", () => {
    const specPath = writeSpec("# Stack\n- TypeScript 5.4\n");
    // Vault file has its own H1 like "# project-name — Stack" + body identical to SPEC body
    writeVaultFile("stack.md", "# project — Stack\n- TypeScript 5.4\n");
    const report = diffSpecVsVault(specPath, vaultPath);
    const stack = report.sections.find((s) => s.section === "stack")!;
    expect(stack.status).toBe("match");
  });
});

describe("printDiffReport", () => {
  let dir: string;
  let vaultPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "spec-diff-print-"));
    vaultPath = join(dir, ".dev-vault");
    mkdirSync(vaultPath, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends whitespace-only warning when hashMatch=false but no line drift", () => {
    const specContent = "# Stack\n- TypeScript 5.4\n\n# Gameplan\n- phase 1\n";
    const specPath = join(dir, "SPEC.md");
    writeFileSync(specPath, specContent);
    // Vault content normalises to same lines but has trailing whitespace.
    writeFileSync(join(vaultPath, "stack.md"), "# Stack\n- TypeScript 5.4   \n");
    // gameplan.md has wrong stored hash to force hashMatch=false; body matches SPEC.
    writeFileSync(
      join(vaultPath, "gameplan.md"),
      "---\nspec-hash: sha256:1111111111111111111111111111111111111111111111111111111111111111\n---\n# Gameplan\n- phase 1\n",
    );
    const report = diffSpecVsVault(specPath, vaultPath);
    expect(report.hasDrift).toBe(false);
    expect(report.hashMatch).toBe(false);
    const out = printDiffReport(report, "SPEC.md");
    expect(out).toContain("All sections match");
    expect(out).toContain("Hash mismatch with no line drift detected");
  });

  it("prints drift summary lines for sections with drift", () => {
    const specPath = join(dir, "SPEC.md");
    writeFileSync(specPath, "# Stack\n- TS\n- Bun\n");
    writeFileSync(join(vaultPath, "stack.md"), "# Stack\n- TS\n");
    const report = diffSpecVsVault(specPath, vaultPath);
    const out = printDiffReport(report, "SPEC.md");
    expect(out).toContain("stack");
    expect(out).toContain("DRIFT");
    expect(out).toContain("+ - Bun");
    expect(out).toContain("Run /vault:from-spec to re-ingest");
  });

  it("truncates added lines beyond 10 with ellipsis", () => {
    const specLines = Array.from({ length: 15 }, (_, i) => `- lib-${i + 1}`).join("\n");
    const specPath = join(dir, "SPEC.md");
    writeFileSync(specPath, `# Stack\n${specLines}\n`);
    writeFileSync(join(vaultPath, "stack.md"), "# Stack\n");
    const report = diffSpecVsVault(specPath, vaultPath);
    const stack = report.sections.find((s) => s.section === "stack")!;
    expect(stack.added.length).toBe(15);
    const out = printDiffReport(report, "SPEC.md");
    const plusLines = out.split("\n").filter((l) => /^ {2}\+ - lib-/.test(l));
    expect(plusLines.length).toBe(10);
    expect(out).toContain("+ ... (5 more)");
  });

  it("truncates removed lines beyond 10 with ellipsis", () => {
    const vaultLines = Array.from({ length: 15 }, (_, i) => `- old-${i + 1}`).join("\n");
    const specPath = join(dir, "SPEC.md");
    writeFileSync(specPath, "# Stack\n");
    writeFileSync(join(vaultPath, "stack.md"), `# Stack\n${vaultLines}\n`);
    const report = diffSpecVsVault(specPath, vaultPath);
    const stack = report.sections.find((s) => s.section === "stack")!;
    expect(stack.removed.length).toBe(15);
    const out = printDiffReport(report, "SPEC.md");
    const minusLines = out.split("\n").filter((l) => /^ {2}- - old-/.test(l));
    expect(minusLines.length).toBe(10);
    expect(out).toContain("- ... (5 more)");
  });
});
