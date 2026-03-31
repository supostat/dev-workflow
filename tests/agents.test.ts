import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseAgentFile } from "../src/agents/loader.js";
import { AgentRegistry } from "../src/agents/registry.js";
import { AgentContextBuilder } from "../src/agents/context-builder.js";
import { VaultReader } from "../src/lib/reader.js";
import { VaultWriter } from "../src/lib/writer.js";
import type { ProjectContext } from "../src/lib/types.js";
import type { AgentDefinition } from "../src/agents/types.js";

function createTempDir(): string {
  const dir = join(tmpdir(), `dev-vault-agents-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeAgentFile(dir: string, filename: string, content: string): string {
  const filepath = join(dir, filename);
  writeFileSync(filepath, content, "utf-8");
  return filepath;
}

const SAMPLE_AGENT = `---
name: coder
description: Writes code following project conventions
vault: [stack, conventions, branch]
read: true
write: [src/**, tests/**]
shell: [npm run build, npm run lint]
git: []
---

You are a coder for {{projectName}}.

## Stack
{{stack}}

## Task
{{taskDescription}}
`;

const MINIMAL_AGENT = `---
name: minimal
description: Minimal agent
vault: []
---

Do the task: {{taskDescription}}
`;

describe("parseAgentFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("parses frontmatter and body correctly", () => {
    const filepath = writeAgentFile(tempDir, "coder.md", SAMPLE_AGENT);
    const agent = parseAgentFile(filepath);

    expect(agent.name).toBe("coder");
    expect(agent.description).toBe("Writes code following project conventions");
    expect(agent.vaultSections).toEqual(["stack", "conventions", "branch"]);
    expect(agent.permissions.readFiles).toBe(true);
    expect(agent.permissions.writePatterns).toEqual(["src/**", "tests/**"]);
    expect(agent.permissions.shellCommands).toEqual(["npm run build", "npm run lint"]);
    expect(agent.permissions.gitOperations).toEqual([]);
    expect(agent.systemPrompt).toContain("You are a coder");
    expect(agent.systemPrompt).toContain("{{projectName}}");
  });

  it("throws error when name field is missing", () => {
    const filepath = writeAgentFile(tempDir, "broken.md", `---
description: No name
vault: []
---
Content
`);
    expect(() => parseAgentFile(filepath)).toThrow("missing 'name'");
  });

  it("defaults readFiles to true when not specified", () => {
    const filepath = writeAgentFile(tempDir, "minimal.md", MINIMAL_AGENT);
    const agent = parseAgentFile(filepath);

    expect(agent.permissions.readFiles).toBe(true);
  });

  it("sets readFiles to false when explicitly false", () => {
    const filepath = writeAgentFile(tempDir, "noread.md", `---
name: noread
description: Cannot read files
vault: []
read: false
---
Content
`);
    const agent = parseAgentFile(filepath);

    expect(agent.permissions.readFiles).toBe(false);
  });

  it("parses git operations", () => {
    const filepath = writeAgentFile(tempDir, "committer.md", `---
name: committer
description: Commits code
vault: [branch]
read: false
git: [status, diff, add, commit]
---
Commit the changes.
`);
    const agent = parseAgentFile(filepath);

    expect(agent.permissions.gitOperations).toEqual(["status", "diff", "add", "commit"]);
  });

  it("filters invalid vault sections", () => {
    const filepath = writeAgentFile(tempDir, "invalid.md", `---
name: invalid
description: Has invalid sections
vault: [stack, nonexistent, conventions]
---
Content
`);
    const agent = parseAgentFile(filepath);

    expect(agent.vaultSections).toEqual(["stack", "conventions"]);
  });
});

describe("AgentRegistry", () => {
  let builtinDir: string;
  let customDir: string;

  beforeEach(() => {
    builtinDir = createTempDir();
    customDir = createTempDir();
  });

  afterEach(() => {
    rmSync(builtinDir, { recursive: true, force: true });
    rmSync(customDir, { recursive: true, force: true });
  });

  it("loads agents from directory", () => {
    writeAgentFile(builtinDir, "coder.md", SAMPLE_AGENT);
    writeAgentFile(builtinDir, "minimal.md", MINIMAL_AGENT);

    const registry = new AgentRegistry(builtinDir);

    expect(registry.list()).toHaveLength(2);
    expect(registry.has("coder")).toBe(true);
    expect(registry.has("minimal")).toBe(true);
  });

  it("custom directory overrides builtin agents", () => {
    writeAgentFile(builtinDir, "coder.md", SAMPLE_AGENT);
    writeAgentFile(customDir, "custom-coder.md", `---
name: coder
description: Custom coder override
vault: [stack]
---
Custom prompt.
`);

    const registry = new AgentRegistry(builtinDir, customDir);
    const agent = registry.get("coder");

    expect(agent.description).toBe("Custom coder override");
  });

  it("get throws for nonexistent agent", () => {
    const registry = new AgentRegistry(builtinDir);

    expect(() => registry.get("nonexistent")).toThrow("Agent not found: nonexistent");
  });

  it("handles missing custom directory gracefully", () => {
    writeAgentFile(builtinDir, "coder.md", SAMPLE_AGENT);

    const registry = new AgentRegistry(builtinDir, "/nonexistent/path");

    expect(registry.list()).toHaveLength(1);
  });

  it("ignores non-markdown files", () => {
    writeAgentFile(builtinDir, "coder.md", SAMPLE_AGENT);
    writeFileSync(join(builtinDir, "notes.txt"), "not an agent", "utf-8");

    const registry = new AgentRegistry(builtinDir);

    expect(registry.list()).toHaveLength(1);
  });
});

describe("AgentContextBuilder", () => {
  let context: ProjectContext;

  beforeEach(() => {
    const projectRoot = createTempDir();
    context = {
      projectName: "test-project",
      branch: "feature/auth",
      parentBranch: "main",
      vaultPath: join(projectRoot, ".dev-vault"),
      projectRoot,
      gitRemote: null,
    };

    const writer = new VaultWriter(context);
    writer.scaffold();
  });

  afterEach(() => {
    rmSync(context.projectRoot, { recursive: true, force: true });
  });

  it("substitutes vault data into prompt", () => {
    const reader = new VaultReader(context);
    const builder = new AgentContextBuilder(reader, context);

    const agentDir = createTempDir();
    writeAgentFile(agentDir, "coder.md", SAMPLE_AGENT);
    const registry = new AgentRegistry(agentDir);
    const agent = registry.get("coder");

    const prepared = builder.prepare(agent, { taskDescription: "Add login page" });

    expect(prepared.resolvedPrompt).toContain("test-project");
    expect(prepared.resolvedPrompt).toContain("Add login page");
    expect(prepared.resolvedPrompt).toContain("Stack");
    expect(prepared.definition.name).toBe("coder");

    rmSync(agentDir, { recursive: true, force: true });
  });

  it("substitutes user-provided variables", () => {
    const reader = new VaultReader(context);
    const builder = new AgentContextBuilder(reader, context);

    const agentDir = createTempDir();
    writeAgentFile(agentDir, "minimal.md", MINIMAL_AGENT);
    const registry = new AgentRegistry(agentDir);
    const agent = registry.get("minimal");

    const prepared = builder.prepare(agent, { taskDescription: "Fix the bug" });

    expect(prepared.resolvedPrompt).toContain("Fix the bug");

    rmSync(agentDir, { recursive: true, force: true });
  });

  it("skips absent vault sections gracefully", () => {
    const reader = new VaultReader(context);
    const builder = new AgentContextBuilder(reader, context);

    const agent: AgentDefinition = {
      name: "test",
      description: "test",
      systemPrompt: "Context: {{branchContext}}, Logs: {{dailyLogs}}",
      vaultSections: ["branch", "dailyLogs"],
      permissions: {
        readFiles: true,
        writePatterns: [],
        gitOperations: [],
        shellCommands: [],
      },
    };

    const prepared = builder.prepare(agent, {});

    expect(prepared.resolvedPrompt).toContain("Context: ");
    expect(prepared.resolvedPrompt).toContain("Logs: ");
  });

  it("injects projectName and branch automatically", () => {
    const reader = new VaultReader(context);
    const builder = new AgentContextBuilder(reader, context);

    const agent: AgentDefinition = {
      name: "test",
      description: "test",
      systemPrompt: "Project: {{projectName}}, Branch: {{branch}}, Parent: {{parentBranch}}",
      vaultSections: [],
      permissions: {
        readFiles: true,
        writePatterns: [],
        gitOperations: [],
        shellCommands: [],
      },
    };

    const prepared = builder.prepare(agent);

    expect(prepared.resolvedPrompt).toBe(
      "Project: test-project, Branch: feature/auth, Parent: main",
    );
  });
});
