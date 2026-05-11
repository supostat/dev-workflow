import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getToolDefinitions } from "../src/mcp/tools.js";
import { PACKAGE_ROOT } from "../src/lib/package-root.js";

function readSrc(relative: string): string {
  return readFileSync(join(PACKAGE_ROOT, relative), "utf-8");
}

describe("docs-invariant: pipeline step count", () => {
  const dev = readSrc("templates/workflows/dev.yaml");
  const stepCount = (dev.match(/^\s*-\s*name:/gm) ?? []).length;

  it("templates/workflows/dev.yaml has > 5 steps (sanity)", () => {
    expect(stepCount).toBeGreaterThan(5);
  });

  const numericSurfaces = [
    "README.md",
    "website/content/docs/index.mdx",
    "website/content/docs/quality/pipeline.mdx",
    "website/content/docs/commands/workflow.mdx",
    "website/content/docs/concepts/workflows.mdx",
    "src/lib/templates.ts",
  ];
  for (const surface of numericSurfaces) {
    it(`${surface} cites the canonical step count (${stepCount})`, () => {
      const content = readSrc(surface);
      const pattern = new RegExp(`\\b${stepCount}[- ](?:step|шаг)`);
      expect(content).toMatch(pattern);
    });
  }

  it("website/app/page.tsx STATS array entry for pipeline matches step count", () => {
    const tsx = readSrc("website/app/page.tsx");
    const pattern = new RegExp(`value:\\s*"${stepCount}"\\s*,\\s*label:\\s*"шагов pipeline"`);
    expect(tsx).toMatch(pattern);
  });

  it("website/app/page.tsx PIPELINE_STEPS array length matches step count", () => {
    const tsx = readSrc("website/app/page.tsx");
    const arrayMatch = tsx.match(/const PIPELINE_STEPS\s*=\s*\[([\s\S]*?)^\]/m);
    expect(arrayMatch, "PIPELINE_STEPS array not found").not.toBeNull();
    const entryCount = (arrayMatch![1].match(/^\s*\{/gm) ?? []).length;
    expect(entryCount).toBe(stepCount);
  });
});

describe("docs-invariant: MCP tool count", () => {
  const toolCount = getToolDefinitions().length;

  it("getToolDefinitions() returns > 10 tools (sanity)", () => {
    expect(toolCount).toBeGreaterThan(10);
  });

  const numericSurfaces = [
    "README.md",
    "website/content/docs/installation.mdx",
    "website/content/docs/mcp/tools.mdx",
  ];
  for (const surface of numericSurfaces) {
    it(`${surface} cites the canonical tool count (${toolCount})`, () => {
      const content = readSrc(surface);
      const pattern = new RegExp(`\\b${toolCount}\\s+(?:MCP\\s+)?(?:tool|програм|инструмент)`, "i");
      expect(content).toMatch(pattern);
    });
  }

  it("website/app/page.tsx STATS array entry for MCP tools matches tool count", () => {
    const tsx = readSrc("website/app/page.tsx");
    const pattern = new RegExp(`value:\\s*"${toolCount}"\\s*,\\s*label:\\s*"MCP tools"`);
    expect(tsx).toMatch(pattern);
  });
});

describe("docs-invariant: hook count", () => {
  const settingsSrc = readSrc("src/lib/settings-template.ts");
  const hookEvents = ["SessionStart", "SessionEnd", "TaskCompleted", "PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop", "SubagentStop", "PreCompact", "Notification"];
  const declared = hookEvents.filter((event) => new RegExp(`^\\s+${event}:\\s*\\[`, "m").test(settingsSrc));
  const hookCount = declared.length;

  it("settings-template.ts declares > 0 hook events (sanity)", () => {
    expect(hookCount).toBeGreaterThan(0);
  });

  it(`README.md cites the canonical hook count (${hookCount})`, () => {
    const readme = readSrc("README.md");
    expect(readme).toMatch(new RegExp(`\\*\\*${hookCount} hooks?\\*\\*`));
  });

  it("README.md names every declared hook", () => {
    const readme = readSrc("README.md");
    for (const event of declared) {
      expect(readme, `README.md is missing hook ${event}`).toContain(event);
    }
  });

  it("website/app/page.tsx STATS array entry for hooks matches hook count", () => {
    const tsx = readSrc("website/app/page.tsx");
    const pattern = new RegExp(`value:\\s*"${hookCount}"\\s*,\\s*label:\\s*"хука`);
    expect(tsx).toMatch(pattern);
  });

  it("website/content/docs/concepts/hooks.mdx names every declared hook", () => {
    const mdx = readSrc("website/content/docs/concepts/hooks.mdx");
    for (const event of declared) {
      expect(mdx, `hooks.mdx is missing hook ${event}`).toContain(event);
    }
  });
});

describe("docs-invariant: CLI command coverage", () => {
  const cliSrc = readSrc("src/cli/index.ts");
  const caseMatches = cliSrc.match(/case\s+"([a-z][a-z0-9-]*)":/g) ?? [];
  const allCommands = [...new Set(caseMatches.map((c) => c.match(/"([^"]+)"/)![1]))];
  const STDLIB_COMMANDS = new Set([
    "version",
  ]);
  const documentedCommands = allCommands.filter((cmd) => !STDLIB_COMMANDS.has(cmd));
  const cliMdx = readSrc("website/content/docs/commands/cli.mdx");

  it("extracts > 10 commands from src/cli/index.ts (sanity)", () => {
    expect(documentedCommands.length).toBeGreaterThan(10);
  });

  for (const cmd of documentedCommands) {
    it("commands/cli.mdx documents `" + cmd + "`", () => {
      const escaped = cmd.replace(/-/g, "\\-");
      const pattern = new RegExp("(?:`|dev\\-workflow\\s+)" + escaped + "(?:\\s|`|$)", "m");
      expect(cliMdx, "commands/cli.mdx is missing `" + cmd + "`").toMatch(pattern);
    });
  }
});
