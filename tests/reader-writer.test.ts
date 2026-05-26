import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultReader } from "../src/lib/reader.js";
import { VaultWriter } from "../src/lib/writer.js";
import { sliceMarkdownSection } from "../src/lib/knowledge-slicer.js";
import type { ProjectContext } from "../src/lib/types.js";

// Deterministic knowledge.md with the 5 canonical headers + distinct body
// markers per section. Used by readKnowledgeSection tests — do NOT rely on the
// scaffold being empty; assert against these markers.
const FIXTURE_KNOWLEDGE = [
  "---",
  "updated: 2026-05-26",
  "tags: [knowledge, fixture]",
  "---",
  "# fixture — Knowledge",
  "",
  "## Architecture",
  "",
  "- ARCH_MARKER barrel exports",
  "",
  "## Gotchas",
  "",
  "- GOTCHA_MARKER ENV stub fail-fast",
  "",
  "## Security",
  "",
  "- SECURITY_MARKER prototype pollution defense",
  "",
  "## Patterns",
  "",
  "- PATTERN_MARKER workflow loop",
  "",
  "## Engram",
  "",
  "- ENGRAM_MARKER MCP proxy auto-tags",
  "",
].join("\n");

// Mirrors the real restructured .dev-vault/knowledge.md hazard: section BODIES
// contain `## ` substrings in prose BEFORE the real headers. A substring
// (non-line-anchored) slicer would match the Architecture-body `## Engram
// Feedback` mention for the engram slice and the Security-body inline
// `` `## Patterns` `` for the patterns slice — returning the WRONG section.
// This is the regression fixture that exercises the line-anchored find.
const FIXTURE_KNOWLEDGE_PROSE_SUBSTRINGS = [
  "---",
  "updated: 2026-05-26",
  "tags: [knowledge, fixture]",
  "---",
  "# fixture — Knowledge",
  "",
  "## Architecture",
  "",
  "- ARCH_MARKER step files carry a `## Engram Feedback` section read at runtime",
  "",
  "## Security",
  "",
  "- SECURITY_MARKER see the `## Patterns` invariant for remediation",
  "",
  "## Patterns",
  "",
  "- PATTERN_MARKER workflow loop: executeLoop -> checkGate -> execute",
  "- Gate types: none, user-approve, tests-pass, review-pass",
  "",
  "## Engram",
  "",
  "- ENGRAM_MARKER MCP proxy auto-tags step/branch/task/run",
  "",
].join("\n");

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

describe("VaultWriter.appendConventions", () => {
  let context: ProjectContext;

  beforeEach(() => {
    context = createTempContext();
  });

  afterEach(() => {
    rmSync(context.projectRoot, { recursive: true, force: true });
  });

  function seedConventions(body: string): string {
    const filepath = join(context.vaultPath, "conventions.md");
    mkdirSync(context.vaultPath, { recursive: true });
    writeFileSync(filepath, body, "utf-8");
    return filepath;
  }

  it("appends bullet to existing Patterns section", () => {
    const filepath = seedConventions(
      "# Conventions\n\n## Patterns\n\n- existing pattern\n\n## Git\n\n- rule\n",
    );

    const writer = new VaultWriter(context);
    const result = writer.appendConventions("Patterns", "- new pattern");

    expect(result).toEqual({ appended: true });
    const updated = readFileSync(filepath, "utf-8");
    expect(updated).toContain("- existing pattern");
    expect(updated).toContain("- new pattern");
    expect(updated.indexOf("- new pattern")).toBeLessThan(updated.indexOf("## Git"));
  });

  it("returns file-missing when conventions.md is absent", () => {
    const writer = new VaultWriter(context);
    const result = writer.appendConventions("Patterns", "- rule");

    expect(result).toEqual({ appended: false, reason: "file-missing" });
  });

  it("returns section-missing when target section not found", () => {
    seedConventions("# Conventions\n\n## Git\n\n- rule\n");

    const writer = new VaultWriter(context);
    const result = writer.appendConventions("Patterns", "- rule");

    expect(result).toEqual({ appended: false, reason: "section-missing" });
  });

  it("returns duplicate when exact bullet already present", () => {
    seedConventions("# Conventions\n\n## Patterns\n\n- one\n- two\n");

    const writer = new VaultWriter(context);
    const result = writer.appendConventions("Patterns", "- one");

    expect(result).toEqual({ appended: false, reason: "duplicate" });
  });

  it("dedup is whitespace-insensitive", () => {
    seedConventions("# Conventions\n\n## Patterns\n\n- my  pattern\n");

    const writer = new VaultWriter(context);
    const result = writer.appendConventions("Patterns", "-   my pattern   ");

    expect(result).toEqual({ appended: false, reason: "duplicate" });
  });

  it("dedup is case-sensitive", () => {
    const filepath = seedConventions("# Conventions\n\n## Patterns\n\n- my pattern\n");

    const writer = new VaultWriter(context);
    const result = writer.appendConventions("Patterns", "- My pattern");

    expect(result).toEqual({ appended: true });
    const updated = readFileSync(filepath, "utf-8");
    expect(updated).toContain("- my pattern");
    expect(updated).toContain("- My pattern");
  });

  it("defaults section to 'Patterns' when no section argument passed", () => {
    const filepath = seedConventions("# Conventions\n\n## Patterns\n\n- existing\n");

    const writer = new VaultWriter(context);
    const result = writer.appendConventions(undefined as unknown as string, "- default-target");

    expect(result).toEqual({ appended: true });
    expect(readFileSync(filepath, "utf-8")).toContain("- default-target");
  });

  it("respects explicit section override", () => {
    const filepath = seedConventions(
      "# Conventions\n\n## Patterns\n\n- p\n\n## Testing\n\n- existing test rule\n",
    );

    const writer = new VaultWriter(context);
    const result = writer.appendConventions("Testing", "- new test rule");

    expect(result).toEqual({ appended: true });
    const updated = readFileSync(filepath, "utf-8");
    const patternsEnd = updated.indexOf("## Testing");
    expect(updated.indexOf("- new test rule")).toBeGreaterThan(patternsEnd);
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

describe("VaultReader.readKnowledgeSection", () => {
  let context: ProjectContext;

  beforeEach(() => {
    context = createTempContext();
    const writer = new VaultWriter(context);
    writer.scaffold();
    // Overwrite the scaffold with a deterministic fixture carrying all 5
    // headers + distinct body markers (scaffold sections are empty).
    writeFileSync(join(context.vaultPath, "knowledge.md"), FIXTURE_KNOWLEDGE, "utf-8");
  });

  afterEach(() => {
    rmSync(context.projectRoot, { recursive: true, force: true });
  });

  it("gotchas slice is boundary-correct: contains its own marker, not the next section's", () => {
    const reader = new VaultReader(context);
    const slice = reader.readKnowledgeSection("gotchas")!;
    expect(slice).toContain("## Gotchas");
    expect(slice).toContain("GOTCHA_MARKER");
    expect(slice).not.toContain("## Security");
    expect(slice).not.toContain("SECURITY_MARKER");
  });

  it("engram slice is EOF-bounded (last section captures to end of file)", () => {
    const reader = new VaultReader(context);
    const slice = reader.readKnowledgeSection("engram")!;
    expect(slice).toContain("## Engram");
    expect(slice).toContain("ENGRAM_MARKER");
    expect(slice).not.toContain("## Patterns");
  });

  it("architecture (first section) excludes frontmatter, H1, and the next section", () => {
    const reader = new VaultReader(context);
    const slice = reader.readKnowledgeSection("architecture")!;
    expect(slice.startsWith("## Architecture")).toBe(true);
    expect(slice).toContain("ARCH_MARKER");
    expect(slice).not.toContain("---");
    expect(slice).not.toContain("# fixture — Knowledge");
    expect(slice).not.toContain("## Gotchas");
  });

  it("returns null for a valid registry name whose header is absent", () => {
    // Fixture without the Engram header — valid name, missing section.
    const withoutEngram = FIXTURE_KNOWLEDGE.replace("## Engram\n\n- ENGRAM_MARKER MCP proxy auto-tags\n", "");
    writeFileSync(join(context.vaultPath, "knowledge.md"), withoutEngram, "utf-8");
    const reader = new VaultReader(context);
    expect(reader.readKnowledgeSection("engram")).toBeNull();
  });

  it("returns null when knowledge.md is missing", () => {
    rmSync(join(context.vaultPath, "knowledge.md"), { force: true });
    const reader = new VaultReader(context);
    expect(reader.readKnowledgeSection("gotchas")).toBeNull();
  });

  it("throws for an unknown sub-section name", () => {
    const reader = new VaultReader(context);
    expect(() => reader.readKnowledgeSection("bogus")).toThrow("Unknown knowledge sub-section: bogus");
  });

  it("throws for the empty sub-section name", () => {
    const reader = new VaultReader(context);
    expect(() => reader.readKnowledgeSection("")).toThrow("Unknown knowledge sub-section");
  });

  it("engram slice resolves the REAL ## Engram header, not a body `## Engram Feedback` mention", () => {
    writeFileSync(join(context.vaultPath, "knowledge.md"), FIXTURE_KNOWLEDGE_PROSE_SUBSTRINGS, "utf-8");
    const reader = new VaultReader(context);
    const slice = reader.readKnowledgeSection("engram")!;
    expect(slice.startsWith("## Engram\n")).toBe(true);
    expect(slice).toContain("ENGRAM_MARKER");
    // The Architecture-body `## Engram Feedback` mention must NOT be the match.
    expect(slice).not.toContain("ARCH_MARKER");
    expect(slice).not.toContain("## Engram Feedback");
  });

  it("patterns slice resolves the REAL ## Patterns header, not the Security-body inline `## Patterns`", () => {
    writeFileSync(join(context.vaultPath, "knowledge.md"), FIXTURE_KNOWLEDGE_PROSE_SUBSTRINGS, "utf-8");
    const reader = new VaultReader(context);
    const slice = reader.readKnowledgeSection("patterns")!;
    expect(slice.startsWith("## Patterns\n")).toBe(true);
    expect(slice).toContain("PATTERN_MARKER");
    expect(slice).toContain("Gate types");
    // The Security-body inline `## Patterns` must NOT be the match.
    expect(slice).not.toContain("SECURITY_MARKER");
    expect(slice).not.toContain("## Security");
  });

  it("readKnowledge() whole-file read is unaffected by sub-section addressing", () => {
    const reader = new VaultReader(context);
    expect(reader.readKnowledge()).toBe(FIXTURE_KNOWLEDGE);
  });
});

describe("sliceMarkdownSection", () => {
  it("returns null when the header is absent", () => {
    expect(sliceMarkdownSection("## Other\n\nbody\n", "Gotchas")).toBeNull();
  });

  it("slices a middle section bounded by the next ## header", () => {
    const source = "## A\n\n- a body\n\n## B\n\n- b body\n\n## C\n\n- c body\n";
    expect(sliceMarkdownSection(source, "B")).toBe("## B\n\n- b body\n");
  });

  // Documents the KNOWN inherited false-boundary limitation: a `## ` line
  // inside a code fence is treated as a real section boundary and truncates
  // the slice early. This is NOT a bug fix — it pins the behavior so the
  // fence-free invariant (knowledge.md carries no fenced ## lines) stays
  // load-bearing. If this expectation ever flips, the slicer learned to parse
  // fences and the invariant test can relax.
  it("truncates early at a ## line inside a code fence (known limitation)", () => {
    const source = "## A\n\n```\n## NotAHeader\n```\n\n- real body\n";
    const slice = sliceMarkdownSection(source, "A");
    expect(slice).toBe("## A\n\n```\n");
    expect(slice).not.toContain("real body");
  });
});
