import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getToolDefinitions } from "../src/mcp/tools.js";
import { KNOWLEDGE_SUB_SECTIONS } from "../src/lib/knowledge-slicer.js";
import { renderTemplate } from "../src/lib/templates.js";
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

  // Negative invariant — catches stale references to hook events that were
  // removed from settings-template.ts but lingered in mdx tables, JSON examples,
  // or section headings. Today's commit b7b9a6f cleared PostToolUse + PreCompact
  // from concepts/hooks.mdx; this test guards against reintroduction.
  const removedHooks = hookEvents.filter((event) => !declared.includes(event));

  it("hooks.mdx does NOT mention any non-declared hook event", () => {
    const mdx = readSrc("website/content/docs/concepts/hooks.mdx");
    for (const event of removedHooks) {
      expect(mdx, `hooks.mdx must not mention non-declared hook ${event}`).not.toContain(event);
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

describe("docs-invariant: Path D subagent dispatch wording (commit dcda8bb..., ADR 2026-05-13)", () => {
  // Conversational orchestrator MUST dispatch every pipeline subagent via
  // `subagent_type: general-purpose` (Path D). Pins the prose so future edits
  // don't regress: built-in Explore subagent is FULLY ISOLATED from MCP, the
  // only way subagents can call `mcp__dev-workflow__memory_*` is via
  // general-purpose dispatch.
  const dispatchMd = readSrc("templates/claude/skills/workflow__dev/SKILL.md");

  it("SKILL.md references subagent_type: general-purpose at least once", () => {
    expect(dispatchMd).toMatch(/subagent_type:\s*general-purpose/);
  });

  it("SKILL.md does NOT instruct passing subagent_type: Explore or Full", () => {
    expect(dispatchMd).not.toMatch(/subagent_type:\s*(Explore|Full)\b/);
  });

  // The 7 step files describe subagent dispatch directives. After Path D none
  // of them should say "Launch **Explore**" or "Launch **Full**" — that prose
  // pattern previously led the conversational orchestrator to pick the wrong
  // built-in subagent_type.
  const stepFiles = [
    "read.md",
    "plan.md",
    "plan-review.md",
    "review.md",
    "verify.md",
    "coder.md",
    "plan-fix.md",
  ];

  for (const stepFile of stepFiles) {
    it(`steps/${stepFile} uses "Dispatch" not "Launch Explore/Full"`, () => {
      const content = readSrc(`templates/claude/skills/workflow__dev/steps/${stepFile}`);
      expect(content).not.toMatch(/Launch\s+\*\*(?:Explore|Full)\*\*/);
    });
  }

  // Agents launched via the dev pipeline (or /intake) must carry the
  // explicit `## Dispatch context` preamble that compensates for the
  // looser general-purpose tool surface with prompt-level prohibitions.
  // preflight + vault-updates are orchestrator-only stubs (never dispatched
  // as subagents). architect/debugger/tester are not part of the dev pipeline.
  const dispatchedAgents = [
    "reader.md",
    "planner.md",
    "plan-reviewer.md",
    "reviewer.md",
    "verifier.md",
    "coder.md",
    "committer.md",
    "intake.md",
  ];

  for (const agentFile of dispatchedAgents) {
    it(`agents/${agentFile} contains ## Dispatch context preamble`, () => {
      const content = readSrc(`templates/agents/${agentFile}`);
      expect(content).toMatch(/^## Dispatch context$/m);
    });
  }

  // The pre-Path D `## Dispatch` heading (sans "context") used to describe
  // orchestration prose inside agent templates. Path D deleted both
  // occurrences (plan-reviewer.md, verifier.md) and replaced them with the
  // new `## Dispatch context` preamble. Re-introducing a bare `## Dispatch`
  // heading would shadow the new one and resurface the wrong dispatch story.
  for (const agentFile of dispatchedAgents) {
    it(`agents/${agentFile} does NOT contain legacy bare "## Dispatch" heading`, () => {
      const content = readSrc(`templates/agents/${agentFile}`);
      expect(content).not.toMatch(/^## Dispatch$/m);
    });
  }

  // The canonical permissions block is the prompt-level enforcement that
  // compensates for general-purpose's wide tool surface. A dispatched agent
  // missing this block effectively gets unrestricted access regardless of
  // its frontmatter declarations. Symmetric with the Dispatch context pin.
  for (const agentFile of dispatchedAgents) {
    it(`agents/${agentFile} contains canonical "## Permissions (VIOLATION = ABORT)" block`, () => {
      const content = readSrc(`templates/agents/${agentFile}`);
      expect(content).toMatch(/^## Permissions \(VIOLATION = ABORT\)$/m);
    });
  }
});

describe("docs-invariant: Engram Feedback empty-case guidance (run-432abc570e51)", () => {
  // After run-8e26aa913c50 surfaced a coverage reviewer emitting a placeholder
  // `none-returned: 0.1 — ...` line when memory_search returned 0 results, the
  // templates were updated to explicitly tell subagents to emit
  // `(no memories retrieved for query N)` instead. Regex anchors on two stable
  // substrings ("no memories retrieved" + "placeholder") so partial reverts
  // still fail the test.
  const EMPTY_CASE_REGEX = /no memories retrieved[\s\S]*?placeholder/ims;

  const EMPTY_CASE_FILES = [
    "templates/agents/reader.md",
    "templates/agents/planner.md",
    "templates/agents/coder.md",
    "templates/agents/reviewer.md",
    "templates/agents/architect.md",
    "templates/agents/debugger.md",
    "templates/claude/skills/workflow__dev/steps/read.md",
    "templates/claude/skills/workflow__dev/steps/plan.md",
    "templates/claude/skills/workflow__dev/steps/plan-fix.md",
    "templates/claude/skills/workflow__dev/steps/coder.md",
    "templates/claude/skills/workflow__dev/steps/review.md",
    "templates/claude/skills/workflow__dev/steps/verify.md",
  ];

  it("EMPTY_CASE_FILES has exactly 12 entries (sanity)", () => {
    expect(EMPTY_CASE_FILES.length).toBe(12);
  });

  for (const path of EMPTY_CASE_FILES) {
    it(`${path} contains empty-case Engram guidance`, () => {
      expect(readSrc(path)).toMatch(EMPTY_CASE_REGEX);
    });
  }

  it("review.md contains empty-case guidance in all 3 reviewer blocks", () => {
    // The three reviewer prompt blocks (security/quality/coverage) are
    // intentionally parallel — losing the guidance from just one is the
    // exact regression the docs-invariant guards against.
    const content = readSrc("templates/claude/skills/workflow__dev/steps/review.md");
    const matches = content.match(/no memories retrieved[\s\S]*?placeholder/gims);
    expect(matches?.length).toBe(3);
  });
});

describe("docs-invariant: skill directory frontmatter (commands-to-skills migration spec)", () => {
  // Every bundled skill MUST have a SKILL.md with `name:` and `description:`
  // fields. Namespaced skill dirs (`<ns>__<verb>`) MUST set `name: <ns>:<verb>`
  // — that frontmatter field is the slash-registration source, not the
  // directory layout. See knowledge.md 2026-05-14 addendum.
  const skillsRoot = join(PACKAGE_ROOT, "templates/claude/skills");
  const skillDirs = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  it("templates/claude/skills/ has > 5 skills (sanity)", () => {
    expect(skillDirs.length).toBeGreaterThan(5);
  });

  for (const dir of skillDirs) {
    it(`${dir}/SKILL.md exists with well-formed frontmatter`, () => {
      const skillPath = join(skillsRoot, dir, "SKILL.md");
      const content = readFileSync(skillPath, "utf-8");

      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch, `${dir}/SKILL.md missing frontmatter delimiter`).not.toBeNull();
      const frontmatter = fmMatch![1];

      const nameMatch = frontmatter.match(/^name:\s*(.+?)\s*$/m);
      const descMatch = frontmatter.match(/^description:\s*(.+?)\s*$/m);
      expect(nameMatch, `${dir}/SKILL.md missing 'name:' field`).not.toBeNull();
      expect(descMatch, `${dir}/SKILL.md missing 'description:' field`).not.toBeNull();
      expect(nameMatch![1].trim().length, `${dir}/SKILL.md 'name:' is empty`).toBeGreaterThan(0);
      expect(descMatch![1].trim().length, `${dir}/SKILL.md 'description:' is empty`).toBeGreaterThan(0);

      if (dir.includes("__")) {
        const expectedSlug = dir.replace("__", ":");
        expect(
          nameMatch![1].trim(),
          `${dir}/SKILL.md 'name:' must equal '${expectedSlug}' (commands-to-skills migration invariant)`,
        ).toBe(expectedSlug);
      }
    });
  }
});

describe("docs-invariant: workflow yaml name matches filename", () => {
  // Each templates/workflows/<name>.yaml MUST declare `name: <name>` matching
  // its filename basename. Accidental file rename without yaml-field update
  // breaks workflow resolution silently (resolveWorkflow looks up by yaml.name,
  // not by filename) — this invariant catches the drift at test time.
  const yamlRoot = join(PACKAGE_ROOT, "templates/workflows");
  const yamlFiles = readdirSync(yamlRoot)
    .filter((entry) => entry.endsWith(".yaml"))
    .sort();

  it("templates/workflows/ has > 3 yaml files (sanity)", () => {
    expect(yamlFiles.length).toBeGreaterThan(3);
  });

  for (const file of yamlFiles) {
    it(`${file} declares 'name:' matching filename basename`, () => {
      const content = readFileSync(join(yamlRoot, file), "utf-8");
      const nameMatch = content.match(/^name:\s*(.+?)\s*$/m);
      const basename = file.replace(/\.yaml$/, "");
      expect(nameMatch, `${file} missing 'name:' field`).not.toBeNull();
      expect(
        nameMatch![1].trim(),
        `${file} 'name:' must equal '${basename}' (filename basename — resolveWorkflow uses yaml.name as registry key)`,
      ).toBe(basename);
    });
  }
});

describe("docs-invariant: vault_read knowledge sub-section addressing", () => {
  // The vault_read `section` enum and the KNOWLEDGE_SUB_SECTIONS registry are
  // two coordinated surfaces: every registry key K must be addressable as
  // `knowledge:K` via the enum. Drift here means an MCP client could request a
  // slice the schema rejects, or vice versa.
  const vaultRead = getToolDefinitions().find((t) => t.name === "vault_read")!;
  const sectionSchema = vaultRead.inputSchema.properties["section"] as { enum: string[] };
  const sectionEnum = sectionSchema.enum;

  const EXPECTED_ENUM = [
    "stack",
    "conventions",
    "knowledge",
    "gameplan",
    "knowledge:architecture",
    "knowledge:gotchas",
    "knowledge:security",
    "knowledge:patterns",
    "knowledge:engram",
  ];

  it("vault_read section enum equals the verbatim 9-entry list", () => {
    expect(sectionEnum.length).toBe(9);
    expect(sectionEnum).toEqual(EXPECTED_ENUM);
  });

  it("every KNOWLEDGE_SUB_SECTIONS key has a knowledge:<key> enum entry", () => {
    for (const key of KNOWLEDGE_SUB_SECTIONS.keys()) {
      expect(sectionEnum, `enum missing knowledge:${key}`).toContain(`knowledge:${key}`);
    }
  });

  it("bare 'knowledge' whole-section read is retained alongside the slice addresses", () => {
    expect(sectionEnum).toContain("knowledge");
  });
});

describe("docs-invariant: knowledge.md scaffold fence-free header invariant", () => {
  // sliceMarkdownSection inherits a `\n## ` false-boundary limitation: a `## `
  // line inside a code fence truncates a slice early. The committed scaffold
  // template is the CI-stable target (the live .dev-vault/knowledge.md is
  // gitignored). Assert the scaffold carries exactly the 5 canonical headers
  // and no other body line begins with `## ` — so every registry slice is
  // addressable and no fenced/stray `## ` line can corrupt a boundary.
  const scaffold = renderTemplate("vault/knowledge", { projectName: "fixture" });
  const headerLines = scaffold.split("\n").filter((line) => /^## /.test(line));
  const CANONICAL = ["## Architecture", "## Gotchas", "## Security", "## Patterns", "## Engram"];

  it("scaffold contains exactly the 5 canonical headers in order", () => {
    expect(headerLines).toEqual(CANONICAL);
  });

  it("every KNOWLEDGE_SUB_SECTIONS header text appears as a scaffold ## header", () => {
    for (const header of KNOWLEDGE_SUB_SECTIONS.values()) {
      expect(headerLines, `scaffold missing ## ${header}`).toContain(`## ${header}`);
    }
  });
});

describe("docs-invariant: skill description min length", () => {
  // Floor on description length catches truncated / placeholder frontmatter
  // (e.g. `description: TODO`, `description: WIP`) that the existing skill
  // frontmatter test would accept because it only checks length > 0. The
  // shortest legitimate description today is well above 20 chars; 20 is a
  // conservative threshold that catches stub values without false positives.
  const skillsRoot = join(PACKAGE_ROOT, "templates/claude/skills");
  const skillDirsForDescCheck = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const MIN_DESCRIPTION_LENGTH = 20;

  for (const dir of skillDirsForDescCheck) {
    it(`${dir}/SKILL.md description has > ${MIN_DESCRIPTION_LENGTH} chars`, () => {
      const content = readFileSync(join(skillsRoot, dir, "SKILL.md"), "utf-8");
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      const frontmatter = fmMatch![1];
      const descMatch = frontmatter.match(/^description:\s*(.+?)\s*$/m);
      const description = descMatch![1].trim();
      const preview = description.length > 50 ? description.slice(0, 50) + "..." : description;
      expect(
        description.length,
        `${dir}/SKILL.md description must be > ${MIN_DESCRIPTION_LENGTH} chars (got '${preview}', length=${description.length})`,
      ).toBeGreaterThan(MIN_DESCRIPTION_LENGTH);
    });
  }
});
