import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ProjectContext, VaultData, BranchContext, DailyLog } from "./types.js";
import { readFileOrNull, slugify } from "./fs-helpers.js";
import { parseFrontmatter } from "./frontmatter.js";

function parseBranchFrontmatter(raw: string): Partial<BranchContext> {
  const { fields } = parseFrontmatter(raw);

  return {
    branch: (fields["branch"] as string) ?? "",
    status: (fields["status"] as BranchContext["status"]) ?? "in-progress",
    created: (fields["created"] as string) ?? "",
    parent: (fields["parent"] as string) ?? "",
  };
}

export class VaultReader {
  private readonly vaultPath: string;

  constructor(context: ProjectContext) {
    this.vaultPath = context.vaultPath;
  }

  exists(): boolean {
    return existsSync(this.vaultPath);
  }

  readStack(): string | null {
    return readFileOrNull(join(this.vaultPath, "stack.md"));
  }

  readConventions(): string | null {
    return readFileOrNull(join(this.vaultPath, "conventions.md"));
  }

  readKnowledge(): string | null {
    return readFileOrNull(join(this.vaultPath, "knowledge.md"));
  }

  readGameplan(): string | null {
    return readFileOrNull(join(this.vaultPath, "gameplan.md"));
  }

  readBranch(branchName: string): BranchContext | null {
    const slug = slugify(branchName);
    const branchPath = join(this.vaultPath, "branches", `${slug}.md`);
    const raw = readFileOrNull(branchPath);
    if (!raw) return null;

    const parsed = parseBranchFrontmatter(raw);
    return {
      raw,
      branch: parsed.branch ?? branchName,
      status: parsed.status ?? "in-progress",
      created: parsed.created ?? "",
      parent: parsed.parent ?? "",
    };
  }

  readRecentDailyLogs(count: number = 3): DailyLog[] {
    const dailyPath = join(this.vaultPath, "daily");
    if (!existsSync(dailyPath)) return [];

    const files = readdirSync(dailyPath)
      .filter((f: string) => f.endsWith(".md"))
      .sort()
      .reverse()
      .slice(0, count);

    return files.map((filename: string) => ({
      date: filename.replace(".md", ""),
      filename,
      content: readFileSync(join(dailyPath, filename), "utf-8"),
    }));
  }

  readAll(branchName: string): VaultData {
    return {
      stack: this.readStack(),
      conventions: this.readConventions(),
      knowledge: this.readKnowledge(),
      gameplan: this.readGameplan(),
      branch: this.readBranch(branchName),
      recentDailyLogs: this.readRecentDailyLogs(),
    };
  }
}
