import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultReader } from "../src/lib/reader.js";
import { VaultWriter } from "../src/lib/writer.js";
import type { ProjectContext } from "../src/lib/types.js";

function createTempContext(): ProjectContext {
  const projectRoot = join(tmpdir(), `dev-vault-test-${Date.now()}`);
  mkdirSync(projectRoot, { recursive: true });

  return {
    projectName: "test-project",
    branch: "feature/test",
    parentBranch: "main",
    vaultPath: join(projectRoot, ".dev-vault"),
    projectRoot,
    gitRemote: null,
  };
}

describe("VaultWriter", () => {
  let context: ProjectContext;

  beforeEach(() => {
    context = createTempContext();
  });

  afterEach(() => {
    rmSync(context.projectRoot, { recursive: true, force: true });
  });

  it("scaffolds vault directory structure", () => {
    const writer = new VaultWriter(context);
    writer.scaffold();

    expect(existsSync(join(context.vaultPath, "stack.md"))).toBe(true);
    expect(existsSync(join(context.vaultPath, "conventions.md"))).toBe(true);
    expect(existsSync(join(context.vaultPath, "knowledge.md"))).toBe(true);
    expect(existsSync(join(context.vaultPath, "gameplan.md"))).toBe(true);
    expect(existsSync(join(context.vaultPath, "daily"))).toBe(true);
    expect(existsSync(join(context.vaultPath, "branches"))).toBe(true);
    expect(existsSync(join(context.vaultPath, "architecture"))).toBe(true);
    expect(existsSync(join(context.vaultPath, "bugs"))).toBe(true);
    expect(existsSync(join(context.vaultPath, "debt"))).toBe(true);
  });

  it("does not overwrite existing vault files", () => {
    const writer = new VaultWriter(context);
    writer.scaffold();

    const stackPath = join(context.vaultPath, "stack.md");
    writeFileSync(stackPath, "# Custom content", "utf-8");

    writer.scaffold();

    expect(readFileSync(stackPath, "utf-8")).toBe("# Custom content");
  });

  it("writes daily log", () => {
    const writer = new VaultWriter(context);
    writer.scaffold();

    const filepath = writer.writeDailyLog("# Test session", "2026-03-31");

    expect(filepath).toContain("2026-03-31.md");
    expect(readFileSync(filepath, "utf-8")).toBe("# Test session");
  });

  it("appends to existing daily log", () => {
    const writer = new VaultWriter(context);
    writer.scaffold();

    writer.writeDailyLog("# Session 1", "2026-03-31");
    writer.writeDailyLog("# Session 2", "2026-03-31");

    const filepath = join(context.vaultPath, "daily", "2026-03-31.md");
    const content = readFileSync(filepath, "utf-8");

    expect(content).toContain("# Session 1");
    expect(content).toContain("---");
    expect(content).toContain("# Session 2");
  });

  it("writes branch context", () => {
    const writer = new VaultWriter(context);
    writer.scaffold();

    const filepath = writer.writeBranch("feature/auth", "# Auth branch");

    expect(filepath).toContain("feature-auth.md");
    expect(readFileSync(filepath, "utf-8")).toBe("# Auth branch");
  });

  it("writes record", () => {
    const writer = new VaultWriter(context);
    writer.scaffold();

    const filepath = writer.writeRecord("adr", "use-graphql", "# Use GraphQL");

    expect(filepath).toContain("architecture");
    expect(filepath).toContain("use-graphql.md");
    expect(readFileSync(filepath, "utf-8")).toBe("# Use GraphQL");
  });

  it("appends to knowledge section", () => {
    const writer = new VaultWriter(context);
    writer.scaffold();

    writer.appendKnowledge("Gotchas", "- NestJS DI conflicts with @IsOptional");

    const knowledge = readFileSync(join(context.vaultPath, "knowledge.md"), "utf-8");
    expect(knowledge).toContain("- NestJS DI conflicts with @IsOptional");
  });
});

describe("VaultReader", () => {
  let context: ProjectContext;

  beforeEach(() => {
    context = createTempContext();
    const writer = new VaultWriter(context);
    writer.scaffold();
  });

  afterEach(() => {
    rmSync(context.projectRoot, { recursive: true, force: true });
  });

  it("detects vault existence", () => {
    const reader = new VaultReader(context);
    expect(reader.exists()).toBe(true);
  });

  it("reads vault files", () => {
    const reader = new VaultReader(context);

    expect(reader.readStack()).toContain("Stack");
    expect(reader.readKnowledge()).toContain("Knowledge");
    expect(reader.readGameplan()).toContain("Gameplan");
    expect(reader.readConventions()).toContain("Conventions");
  });

  it("returns null for missing branch", () => {
    const reader = new VaultReader(context);
    expect(reader.readBranch("nonexistent")).toBeNull();
  });

  it("reads branch context", () => {
    const writer = new VaultWriter(context);
    writer.writeBranch("feature/test", [
      "---",
      "branch: feature/test",
      "status: in-progress",
      "created: 2026-03-31",
      "parent: main",
      "---",
      "# feature/test",
    ].join("\n"));

    const reader = new VaultReader(context);
    const branch = reader.readBranch("feature/test");

    expect(branch).not.toBeNull();
    expect(branch!.branch).toBe("feature/test");
    expect(branch!.status).toBe("in-progress");
    expect(branch!.parent).toBe("main");
  });

  it("reads recent daily logs sorted by date desc", () => {
    const writer = new VaultWriter(context);
    writer.writeDailyLog("Day 1", "2026-03-28");
    writer.writeDailyLog("Day 2", "2026-03-29");
    writer.writeDailyLog("Day 3", "2026-03-30");

    const reader = new VaultReader(context);
    const logs = reader.readRecentDailyLogs(2);

    expect(logs).toHaveLength(2);
    expect(logs[0]!.date).toBe("2026-03-30");
    expect(logs[1]!.date).toBe("2026-03-29");
  });

  it("readAll returns complete vault data", () => {
    const writer = new VaultWriter(context);
    writer.writeBranch("feature/test", [
      "---",
      "branch: feature/test",
      "status: in-progress",
      "created: 2026-03-31",
      "parent: main",
      "---",
      "# feature/test",
    ].join("\n"));
    writer.writeDailyLog("Session log", "2026-03-31");

    const reader = new VaultReader(context);
    const data = reader.readAll("feature/test");

    expect(data.stack).not.toBeNull();
    expect(data.knowledge).not.toBeNull();
    expect(data.gameplan).not.toBeNull();
    expect(data.conventions).not.toBeNull();
    expect(data.branch).not.toBeNull();
    expect(data.recentDailyLogs).toHaveLength(1);
  });
});
