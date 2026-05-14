import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { updateSkillsAdditively } from "../src/lib/skills-update.js";

describe("updateSkillsAdditively", () => {
  let templateDir: string;
  let targetDir: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), "skills-update-test-"));
    templateDir = join(root, "template-skills");
    targetDir = join(root, "target-skills");
    mkdirSync(templateDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    rmSync(templateDir, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
  });

  function writeTemplate(rel: string, content: string): void {
    const full = join(templateDir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }

  function writeTarget(rel: string, content: string): void {
    const full = join(targetDir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }

  it("adds new skill files when target is empty", () => {
    writeTemplate("alpha/SKILL.md", "# alpha");
    writeTemplate("beta/SKILL.md", "# beta");

    const result = updateSkillsAdditively(templateDir, targetDir);

    expect(result).toEqual({ added: 2, skipped: 0 });
    expect(existsSync(join(targetDir, "alpha/SKILL.md"))).toBe(true);
    expect(existsSync(join(targetDir, "beta/SKILL.md"))).toBe(true);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("is idempotent — second run on identical files reports zero added zero skipped", () => {
    writeTemplate("alpha/SKILL.md", "# alpha");
    updateSkillsAdditively(templateDir, targetDir);

    const result = updateSkillsAdditively(templateDir, targetDir);

    expect(result).toEqual({ added: 0, skipped: 0 });
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("skips user-modified file and emits stderr warning with relative path", () => {
    writeTemplate("alpha/SKILL.md", "# alpha — bundled\n");
    writeTarget("alpha/SKILL.md", "# alpha — user-edited\n");

    const result = updateSkillsAdditively(templateDir, targetDir);

    expect(result).toEqual({ added: 0, skipped: 1 });
    expect(readFileSync(join(targetDir, "alpha/SKILL.md"), "utf-8")).toBe("# alpha — user-edited\n");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const msg = String(stderrSpy.mock.calls[0]![0]);
    expect(msg).toContain("note: skipping user-modified skill");
    expect(msg).toContain("alpha/SKILL.md");
  });

  it("mixed: adds new + skips modified + silent on unchanged in one pass", () => {
    writeTemplate("new/SKILL.md", "# new");
    writeTemplate("modified/SKILL.md", "# bundled");
    writeTemplate("unchanged/SKILL.md", "# same");

    // user has modified + unchanged files locally
    writeTarget("modified/SKILL.md", "# user edited this");
    writeTarget("unchanged/SKILL.md", "# same");

    const result = updateSkillsAdditively(templateDir, targetDir);

    expect(result).toEqual({ added: 1, skipped: 1 });
    expect(existsSync(join(targetDir, "new/SKILL.md"))).toBe(true);
    expect(readFileSync(join(targetDir, "modified/SKILL.md"), "utf-8")).toBe("# user edited this");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it("recurses into nested directories", () => {
    writeTemplate("group/nested/deep/SKILL.md", "# deep");

    const result = updateSkillsAdditively(templateDir, targetDir);

    expect(result).toEqual({ added: 1, skipped: 0 });
    expect(existsSync(join(targetDir, "group/nested/deep/SKILL.md"))).toBe(true);
  });

  it("copies sibling files inside a skill directory (SKILL.md + scripts)", () => {
    writeTemplate("toolkit/SKILL.md", "# toolkit");
    writeTemplate("toolkit/scripts/run.sh", "#!/bin/sh\necho hi");

    const result = updateSkillsAdditively(templateDir, targetDir);

    expect(result).toEqual({ added: 2, skipped: 0 });
    expect(existsSync(join(targetDir, "toolkit/SKILL.md"))).toBe(true);
    expect(existsSync(join(targetDir, "toolkit/scripts/run.sh"))).toBe(true);
  });

  it("returns zero-result and does not throw when template directory does not exist", () => {
    rmSync(templateDir, { recursive: true, force: true });

    const result = updateSkillsAdditively(templateDir, targetDir);

    expect(result).toEqual({ added: 0, skipped: 0 });
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("emits one warning per user-modified file when multiple are modified", () => {
    writeTemplate("one/SKILL.md", "# bundled-one");
    writeTemplate("two/SKILL.md", "# bundled-two");
    writeTarget("one/SKILL.md", "# user-one");
    writeTarget("two/SKILL.md", "# user-two");

    const result = updateSkillsAdditively(templateDir, targetDir);

    expect(result).toEqual({ added: 0, skipped: 2 });
    expect(stderrSpy).toHaveBeenCalledTimes(2);
    const messages = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("one/SKILL.md"))).toBe(true);
    expect(messages.some((m) => m.includes("two/SKILL.md"))).toBe(true);
  });
});
