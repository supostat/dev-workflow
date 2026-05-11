import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { search } from "../src/cli/search.js";

describe("search CLI — E2E", () => {
  let projectRoot: string;
  let vaultPath: string;
  let originalCwd: string;
  let logOutput: string[];
  let errOutput: string[];
  let origLog: typeof console.log;
  let origErr: typeof console.error;

  beforeEach(() => {
    originalCwd = process.cwd();
    projectRoot = mkdtempSync(join(tmpdir(), "cli-search-test-"));
    vaultPath = join(projectRoot, ".dev-vault");
    process.chdir(projectRoot);

    execFileSync("git", ["init", "-q"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: projectRoot });
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ name: "search-test" }), "utf-8");

    logOutput = [];
    errOutput = [];
    origLog = console.log;
    origErr = console.error;
    console.log = ((msg: string = "") => { logOutput.push(String(msg)); return true; }) as typeof console.log;
    console.error = ((msg: string) => { errOutput.push(String(msg)); return true; }) as typeof console.error;
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origErr;
    process.chdir(originalCwd);
    rmSync(projectRoot, { recursive: true, force: true });
    process.exitCode = 0;
  });

  function logJoined(): string { return logOutput.join("\n"); }
  function errJoined(): string { return errOutput.join("\n"); }

  it("missing query: usage + exitCode=1", () => {
    search("");
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain('Usage: dev-workflow search "query"');
  });

  it("not-in-git-repo: error + exitCode=1", () => {
    const nonGit = mkdtempSync(join(tmpdir(), "cli-search-non-git-"));
    process.chdir(nonGit);
    try {
      search("anything");
      expect(process.exitCode).toBe(1);
      expect(errJoined()).toContain("Not a git repository");
    } finally {
      process.chdir(projectRoot);
      rmSync(nonGit, { recursive: true, force: true });
    }
  });

  it("no vault: error + exitCode=1", () => {
    search("anything");
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("No vault found");
  });

  it("no matches: prints 'No results for ...'", () => {
    mkdirSync(vaultPath, { recursive: true });
    writeFileSync(join(vaultPath, "stack.md"), "# Stack\n\nNode.js, TypeScript\n", "utf-8");
    search("python");
    expect(logJoined()).toContain('No results for "python"');
  });

  it("single match: shows count, file path, line number, context", () => {
    mkdirSync(vaultPath, { recursive: true });
    writeFileSync(join(vaultPath, "knowledge.md"),
      "# Knowledge\n\n## Patterns\n\nUse builder pattern for complex objects.\n\n## Gotchas\n\nNothing yet.\n",
      "utf-8");
    search("builder");
    const out = logJoined();
    expect(out).toContain('Search: "builder" — 1 matches');
    expect(out).toContain("knowledge.md");
    expect(out).toContain("builder pattern");
  });

  it("case-insensitive match", () => {
    mkdirSync(vaultPath, { recursive: true });
    writeFileSync(join(vaultPath, "stack.md"), "# Stack\n\nTypeScript and Node.js\n", "utf-8");
    search("typescript");
    expect(logJoined()).toContain('Search: "typescript"');
  });

  it("groups results by top-level directory", () => {
    mkdirSync(join(vaultPath, "architecture"), { recursive: true });
    mkdirSync(join(vaultPath, "debt"), { recursive: true });
    writeFileSync(join(vaultPath, "architecture", "adr-1.md"), "# ADR\n\ntrigger event\n", "utf-8");
    writeFileSync(join(vaultPath, "debt", "old-bug.md"), "# Debt\n\ntrigger event\n", "utf-8");
    writeFileSync(join(vaultPath, "knowledge.md"), "# Knowledge\n\ntrigger event\n", "utf-8");
    search("trigger");
    const out = logJoined();
    expect(out).toContain("### architecture");
    expect(out).toContain("### debt");
    // root-level file groups under its filename
    expect(out).toContain("### knowledge.md");
  });

  it("ignores non-.md files", () => {
    mkdirSync(vaultPath, { recursive: true });
    writeFileSync(join(vaultPath, "stack.md"), "# Stack\n\nfindme\n", "utf-8");
    writeFileSync(join(vaultPath, "config.json"), '{"findme": true}', "utf-8");
    writeFileSync(join(vaultPath, "notes.txt"), "findme everywhere", "utf-8");
    search("findme");
    const out = logJoined();
    expect(out).toMatch(/1 match/); // Only stack.md hits
    expect(out).toContain("stack.md");
    expect(out).not.toContain("config.json");
    expect(out).not.toContain("notes.txt");
  });

  it("multiple matches in same file: each line reported separately", () => {
    mkdirSync(vaultPath, { recursive: true });
    writeFileSync(join(vaultPath, "knowledge.md"),
      "# Knowledge\n\nThis has the keyword.\n\nAnother line with keyword in it.\n\nMore content.\n",
      "utf-8");
    search("keyword");
    expect(logJoined()).toContain('2 matches');
  });

  it("recursive: searches subdirectories", () => {
    mkdirSync(join(vaultPath, "branches", "feature-x"), { recursive: true });
    writeFileSync(join(vaultPath, "branches", "feature-x", "context.md"),
      "# Branch\n\ndeepvalue here\n", "utf-8");
    search("deepvalue");
    const out = logJoined();
    expect(out).toContain("1 match");
    expect(out).toContain("branches/feature-x/context.md");
  });
});
