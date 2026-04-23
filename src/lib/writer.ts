import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectContext, BranchContext } from "./types.js";
import { renderTemplate } from "./templates.js";
import { writeFileSafe, slugify, todayDate } from "./fs-helpers.js";

export type AppendReason = "file-missing" | "section-missing" | "duplicate";

export interface AppendResult {
  appended: boolean;
  reason?: AppendReason;
}

interface AppendOptions {
  requireSectionExists?: boolean;
  checkDuplicate?: boolean;
}

export class VaultWriter {
  private readonly vaultPath: string;
  private readonly context: ProjectContext;

  constructor(context: ProjectContext) {
    this.vaultPath = context.vaultPath;
    this.context = context;
  }

  scaffold(): void {
    const dirs = [
      "daily",
      "branches",
      "architecture",
      "bugs",
      "debt",
      "tasks",
      "phases",
      "plans",
      "workflows",
    ];

    for (const dir of dirs) {
      mkdirSync(join(this.vaultPath, dir), { recursive: true });
    }

    const files: Array<[string, string]> = [
      ["stack.md", renderTemplate("vault/stack", { projectName: this.context.projectName })],
      ["conventions.md", renderTemplate("vault/conventions", { projectName: this.context.projectName })],
      ["knowledge.md", renderTemplate("vault/knowledge", { projectName: this.context.projectName })],
      ["gameplan.md", renderTemplate("vault/gameplan", { projectName: this.context.projectName })],
    ];

    for (const [filename, content] of files) {
      const filepath = join(this.vaultPath, filename);
      if (!existsSync(filepath)) {
        writeFileSafe(filepath, content);
      }
    }
  }

  writeDailyLog(content: string, date: string = todayDate()): string {
    const filepath = join(this.vaultPath, "daily", `${date}.md`);

    if (existsSync(filepath)) {
      const existing = readFileSync(filepath, "utf-8");
      writeFileSafe(filepath, existing + "\n\n---\n\n" + content);
    } else {
      writeFileSafe(filepath, content);
    }

    return filepath;
  }

  writeBranch(branchName: string, content: string): string {
    const slug = slugify(branchName);
    const filepath = join(this.vaultPath, "branches", `${slug}.md`);
    writeFileSafe(filepath, content);
    return filepath;
  }

  updateBranchStatus(branchName: string, status: BranchContext["status"]): void {
    const slug = slugify(branchName);
    const filepath = join(this.vaultPath, "branches", `${slug}.md`);
    if (!existsSync(filepath)) return;

    const content = readFileSync(filepath, "utf-8");
    const updated = content.replace(
      /^status:\s*.+$/m,
      `status: ${status}`,
    );
    writeFileSync(filepath, updated, "utf-8");
  }

  writeRecord(type: string, slug: string, content: string): string {
    const dirMap: Record<string, string> = {
      adr: "architecture",
      bug: "bugs",
      debt: "debt",
    };

    const dir = dirMap[type] ?? type;
    const date = todayDate();
    const filepath = join(this.vaultPath, dir, `${date}-${slug}.md`);
    writeFileSafe(filepath, content);
    return filepath;
  }

  appendKnowledge(section: string, content: string): void {
    this.appendToSection(
      join(this.vaultPath, "knowledge.md"),
      section,
      content,
    );
  }

  appendConventions(section: string = "Patterns", content: string): AppendResult {
    return this.appendToSection(
      join(this.vaultPath, "conventions.md"),
      section,
      content,
      { requireSectionExists: true, checkDuplicate: true },
    );
  }

  private appendToSection(
    filepath: string,
    section: string,
    content: string,
    options: AppendOptions = {},
  ): AppendResult {
    if (!existsSync(filepath)) {
      return { appended: false, reason: "file-missing" };
    }

    const existing = readFileSync(filepath, "utf-8");
    const sectionHeader = `## ${section}`;
    const sectionIndex = existing.indexOf(sectionHeader);

    if (sectionIndex === -1) {
      if (options.requireSectionExists) {
        return { appended: false, reason: "section-missing" };
      }
      writeFileSync(
        filepath,
        existing.trimEnd() + `\n\n${sectionHeader}\n\n${content}\n`,
        "utf-8",
      );
      return { appended: true };
    }

    const nextSectionMatch = existing
      .slice(sectionIndex + sectionHeader.length)
      .match(/\n## /);
    const insertAt = nextSectionMatch
      ? sectionIndex + sectionHeader.length + (nextSectionMatch.index ?? 0)
      : existing.length;

    if (options.checkDuplicate) {
      const sectionBody = existing.slice(
        sectionIndex + sectionHeader.length,
        insertAt,
      );
      if (this.isDuplicateBullet(sectionBody, content)) {
        return { appended: false, reason: "duplicate" };
      }
    }

    const updated =
      existing.slice(0, insertAt).trimEnd() +
      `\n\n${content}\n` +
      existing.slice(insertAt);
    writeFileSync(filepath, updated, "utf-8");
    return { appended: true };
  }

  private isDuplicateBullet(sectionBody: string, newContent: string): boolean {
    const normalize = (s: string) => s.trim().replace(/\s+/g, " ");
    const newNormalized = normalize(newContent);
    if (newNormalized === "") return false;
    for (const line of sectionBody.split("\n")) {
      if (normalize(line) === newNormalized) return true;
    }
    return false;
  }
}
