import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import { parseSpecSections, type SpecSectionName } from "./spec-parser.js";
import { hashString, formatHash } from "./spec-hash.js";

export type SectionStatus = "match" | "drift" | "missing-in-spec" | "missing-in-vault";

export interface SectionDiff {
  section: SpecSectionName;
  status: SectionStatus;
  added: string[]; // lines in SPEC but not in vault
  removed: string[]; // lines in vault but not in SPEC
}

export interface DiffReport {
  hasDrift: boolean;
  sections: SectionDiff[];
  specHash: string; // raw "<hex>"
  vaultStoredHash: string | null; // "sha256:<hex>" or null if not stored yet
  hashMatch: boolean;
}

const VAULT_FILES: Record<SpecSectionName, string> = {
  stack: "stack.md",
  conventions: "conventions.md",
  knowledge: "knowledge.md",
  gameplan: "gameplan.md",
};

export function diffSpecVsVault(specPath: string, vaultPath: string): DiffReport {
  if (!existsSync(specPath)) throw new Error(`SPEC.md not found: ${specPath}`);
  if (!existsSync(vaultPath)) throw new Error(`Vault not initialized: ${vaultPath}`);

  const specContent = readFileSync(specPath, "utf-8");
  const specHash = hashString(specContent);
  const sections = parseSpecSections(specContent);

  // Read stored hash from gameplan.md frontmatter.
  let vaultStoredHash: string | null = null;
  const gameplanPath = join(vaultPath, "gameplan.md");
  if (existsSync(gameplanPath)) {
    const gameplanContent = readFileSync(gameplanPath, "utf-8");
    const { fields } = parseFrontmatter(gameplanContent);
    const stored = fields["spec-hash"];
    if (typeof stored === "string") vaultStoredHash = stored;
  }
  const hashMatch = vaultStoredHash === formatHash(specHash);

  const result: SectionDiff[] = [];
  for (const name of Object.keys(VAULT_FILES) as SpecSectionName[]) {
    const specSection = sections[name];
    const vaultFilepath = join(vaultPath, VAULT_FILES[name]);
    const vaultExists = existsSync(vaultFilepath);

    if (specSection === null && !vaultExists) continue; // both absent — skip
    if (specSection === null) {
      result.push({ section: name, status: "missing-in-spec", added: [], removed: [] });
      continue;
    }
    if (!vaultExists) {
      result.push({ section: name, status: "missing-in-vault", added: [], removed: [] });
      continue;
    }
    const vaultContent = readFileSync(vaultFilepath, "utf-8");
    const vaultBody = stripFrontmatterAndH1(vaultContent);
    const diff = lineDiff(specSection, vaultBody);
    const status: SectionStatus =
      diff.added.length === 0 && diff.removed.length === 0 ? "match" : "drift";
    result.push({ section: name, status, added: diff.added, removed: diff.removed });
  }

  const hasDrift = result.some((s) => s.status !== "match");
  return { hasDrift, sections: result, specHash, vaultStoredHash, hashMatch };
}

function stripFrontmatterAndH1(content: string): string {
  const { body } = parseFrontmatter(content);
  // Remove leading H1 line if present (e.g. "# project-name — Stack").
  const lines = body.split("\n");
  if (lines[0]?.startsWith("# ")) lines.shift();
  return lines.join("\n").trimEnd();
}

/**
 * Set-based line diff (trim + filter empty). Trade-offs:
 *   (a) order ignored — reordering content reports no diff;
 *   (b) duplicate lines collapsed — repeated lines counted once;
 *   (c) whitespace-only changes invisible — pure whitespace edits do not register.
 *
 * Trade-off accepted per debt entry — caller checks BOTH the line-diff result
 * AND `hashMatch` to detect whitespace-only drift (see `printDiffReport`).
 */
function lineDiff(spec: string, vault: string): { added: string[]; removed: string[] } {
  const normalize = (s: string): Set<string> =>
    new Set(s.split("\n").map((l) => l.trim()).filter((l) => l.length > 0));
  const specLines = normalize(spec);
  const vaultLines = normalize(vault);
  const added: string[] = [];
  const removed: string[] = [];
  for (const l of specLines) if (!vaultLines.has(l)) added.push(l);
  for (const l of vaultLines) if (!specLines.has(l)) removed.push(l);
  return { added, removed };
}

export function printDiffReport(report: DiffReport, specLabel: string): string {
  const lines: string[] = [];
  lines.push(`SPEC drift report: ${specLabel}`);
  lines.push("=".repeat(40));
  lines.push(
    `Stored hash:  ${report.vaultStoredHash ?? "(not yet recorded; run /vault:from-spec)"}`,
  );
  lines.push(`Current hash: ${formatHash(report.specHash)}`);
  lines.push(`Hash match:   ${report.hashMatch ? "yes" : "no"}`);
  lines.push("");
  for (const s of report.sections) {
    if (s.status === "match") {
      lines.push(`${s.section.padEnd(12)} match`);
    } else {
      lines.push(
        `${s.section.padEnd(12)} ${s.status.toUpperCase()} (${s.added.length} added, ${s.removed.length} removed)`,
      );
      for (const l of s.added.slice(0, 10)) lines.push(`  + ${l}`);
      if (s.added.length > 10) lines.push(`  + ... (${s.added.length - 10} more)`);
      for (const l of s.removed.slice(0, 10)) lines.push(`  - ${l}`);
      if (s.removed.length > 10) lines.push(`  - ... (${s.removed.length - 10} more)`);
    }
  }
  lines.push("");
  if (report.hasDrift) {
    lines.push("Run /vault:from-spec to re-ingest (interactive merge).");
  } else {
    lines.push("All sections match. No drift.");
    if (!report.hashMatch) {
      // Hash differs but set-based line-diff sees no changes — whitespace-only edits.
      lines.push(
        "⚠️  Hash mismatch with no line drift detected — likely whitespace-only changes. Re-ingest if needed.",
      );
    }
  }
  return lines.join("\n");
}
