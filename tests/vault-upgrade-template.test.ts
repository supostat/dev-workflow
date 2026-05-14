import { describe, it, expect } from "vitest";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Drift-detection tests for templates/claude/skills/vault__upgrade/SKILL.md.
// The skill body is template-static (not unit-runnable), so these tests
// are essentially grep-against-canonical: assert that key invariant phrases
// exist. Catches accidental deletion / refactor breakage in CI.

const PACKAGE_ROOT = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."));
const UPGRADE_MD = join(PACKAGE_ROOT, "templates/claude/skills/vault__upgrade/SKILL.md");

function readUpgrade(): string {
  return readFileSync(UPGRADE_MD, "utf-8");
}

describe("vault/upgrade.md — communication-config classification (task-017)", () => {
  it("documents communication.yaml as user-modified (never overwritten)", () => {
    const md = readUpgrade();
    expect(md).toMatch(/communication\.yaml.*user-modified/);
    expect(md).toContain("never overwritten by /vault:upgrade");
  });

  it("documents missing-case bootstrap via dev-workflow communication-template", () => {
    const md = readUpgrade();
    expect(md).toContain("dev-workflow communication-template > .dev-vault/communication.yaml");
    expect(md).toMatch(/Missing:.*bootstrap/);
  });

  it("documents .profile-state runtime-state advisory + reset hint", () => {
    const md = readUpgrade();
    expect(md).toContain(".profile-state");
    expect(md).toContain("/profile clear");
    expect(md).toMatch(/runtime override/);
  });

  it("communication.yaml advisory lives inside Category F (READ-ONLY)", () => {
    // Defense: ensure single-file advisories sit AFTER the Category F header,
    // BEFORE any subsequent ## heading. Drift would move them out of read-only
    // scope, risking accidental write semantics being applied later.
    const md = readUpgrade();
    const fHeaderIdx = md.indexOf("#### Category F — User customization advisory (READ-ONLY)");
    const commYamlIdx = md.indexOf("communication.yaml");
    const nextH4Idx = md.indexOf("####", fHeaderIdx + 1);
    expect(fHeaderIdx).toBeGreaterThan(-1);
    expect(commYamlIdx).toBeGreaterThan(fHeaderIdx);
    if (nextH4Idx > -1) {
      expect(commYamlIdx).toBeLessThan(nextH4Idx);
    }
  });
});
