import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { syncWorkflowShims } from "../src/hooks/workflow-shim-sync.js";
import { parseFrontmatter } from "../src/lib/frontmatter.js";
import type { WorkflowDefinition } from "../src/workflow/types.js";

function createWorkflow(
  name: string,
  description: string = `${name} description`,
): WorkflowDefinition {
  return {
    name,
    description,
    match: [],
    steps: [
      { name: "read", agent: "reader", input: [], gate: "none", onFail: null, maxAttempts: 3 },
    ],
  };
}

describe("syncWorkflowShims", () => {
  let projectRoot: string;
  let commandsPath: string;
  let workflowDir: string;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `shim-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    commandsPath = join(projectRoot, ".claude", "commands");
    workflowDir = join(commandsPath, "workflow");
    mkdirSync(projectRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("creates shim for new workflow", () => {
    const result = syncWorkflowShims([createWorkflow("deploy")], commandsPath);

    expect(result.synced).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);

    const shimPath = join(workflowDir, "deploy.md");
    expect(existsSync(shimPath)).toBe(true);
    const content = readFileSync(shimPath, "utf-8");
    expect(content).toContain("generated: true");
    expect(content).toContain("# /workflow:deploy");
  });

  it("skips existing auto-generated shim with matching content", () => {
    const workflow = createWorkflow("deploy");

    const first = syncWorkflowShims([workflow], commandsPath);
    expect(first.synced).toBe(1);

    const second = syncWorkflowShims([workflow], commandsPath);
    expect(second.synced).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.errors).toEqual([]);
  });

  it("overwrites auto-generated shim when description changes", () => {
    const workflow = createWorkflow("deploy", "old description");
    syncWorkflowShims([workflow], commandsPath);

    const updated = createWorkflow("deploy", "new description");
    const result = syncWorkflowShims([updated], commandsPath);

    expect(result.synced).toBe(1);
    expect(result.skipped).toBe(0);

    const content = readFileSync(join(workflowDir, "deploy.md"), "utf-8");
    expect(content).toContain("new description");
    expect(content).not.toContain("old description");
  });

  it("never touches builtin shim lacking generated:true", () => {
    mkdirSync(workflowDir, { recursive: true });
    const builtinContent = `---\nsource: templates/workflows/dev.yaml\n---\n\n# /workflow:dev — Hand-maintained\n\nBuiltin body that must not be touched.\n`;
    const shimPath = join(workflowDir, "dev.md");
    writeFileSync(shimPath, builtinContent, "utf-8");

    const result = syncWorkflowShims([createWorkflow("dev", "auto description")], commandsPath);

    expect(result.synced).toBe(0);
    expect(result.skipped).toBe(1);

    const actual = readFileSync(shimPath, "utf-8");
    expect(actual).toBe(builtinContent);
  });

  it("creates .claude/commands/workflow directory if missing", () => {
    expect(existsSync(workflowDir)).toBe(false);

    syncWorkflowShims([createWorkflow("deploy")], commandsPath);

    expect(existsSync(workflowDir)).toBe(true);
  });

  it("processes multiple workflows in one call", () => {
    const workflows = [
      createWorkflow("deploy"),
      createWorkflow("migrate"),
      createWorkflow("audit"),
    ];

    const result = syncWorkflowShims(workflows, commandsPath);

    expect(result.synced).toBe(3);
    expect(result.skipped).toBe(0);
    expect(existsSync(join(workflowDir, "deploy.md"))).toBe(true);
    expect(existsSync(join(workflowDir, "migrate.md"))).toBe(true);
    expect(existsSync(join(workflowDir, "audit.md"))).toBe(true);
  });

  it("logs fs errors to result.errors and continues", () => {
    const forbidden = "/nonexistent-root-shim-sync/.claude/commands";
    const result = syncWorkflowShims([createWorkflow("deploy")], forbidden);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.synced).toBe(0);
  });

  it("includes generated:true + source + H1 + Dispatch block in shim", () => {
    syncWorkflowShims([createWorkflow("deploy", "Deploy pipeline")], commandsPath);

    const content = readFileSync(join(workflowDir, "deploy.md"), "utf-8");
    const parsed = parseFrontmatter(content);

    expect(parsed.fields.generated).toBe("true");
    expect(parsed.fields.source).toBe(".dev-vault/workflows/deploy.yaml");
    expect(parsed.body).toContain("# /workflow:deploy");
    expect(parsed.body).toContain("Deploy pipeline");
    expect(parsed.body).toContain("**Dispatch:**");
    expect(parsed.body).toContain('workflow = "deploy"');
    expect(parsed.body).toContain("args =");
  });

  it("uses parsed-structure compare for idempotency (line-ending tolerance)", () => {
    const workflow = createWorkflow("deploy", "Deploy pipeline");
    syncWorkflowShims([workflow], commandsPath);

    const shimPath = join(workflowDir, "deploy.md");
    const original = readFileSync(shimPath, "utf-8");

    const trailingExtraWhitespace = original + "\n\n";
    writeFileSync(shimPath, trailingExtraWhitespace, "utf-8");

    const result = syncWorkflowShims([workflow], commandsPath);

    expect(result.skipped).toBe(1);
    expect(result.synced).toBe(0);
  });

  it("normalizes CRLF line endings when comparing shim content", () => {
    const workflow = createWorkflow("deploy", "Deploy pipeline");
    syncWorkflowShims([workflow], commandsPath);

    const shimPath = join(workflowDir, "deploy.md");
    const original = readFileSync(shimPath, "utf-8");
    const crlf = original.replace(/\n/g, "\r\n");
    writeFileSync(shimPath, crlf, "utf-8");

    const result = syncWorkflowShims([workflow], commandsPath);

    expect(result.skipped).toBe(1);
    expect(result.synced).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("isolates errors per workflow so later workflows still sync", () => {
    mkdirSync(workflowDir, { recursive: true });
    mkdirSync(join(workflowDir, "b.md"), { recursive: true });

    const result = syncWorkflowShims(
      [createWorkflow("a"), createWorkflow("b"), createWorkflow("c")],
      commandsPath,
    );

    expect(result.synced).toBe(2);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("b");
    expect(existsSync(join(workflowDir, "a.md"))).toBe(true);
    expect(existsSync(join(workflowDir, "c.md"))).toBe(true);
  });

  it("is a no-op for empty workflow list", () => {
    const result = syncWorkflowShims([], commandsPath);

    expect(result.synced).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);

    if (existsSync(workflowDir)) {
      expect(readdirSync(workflowDir)).toEqual([]);
    }
  });
});
