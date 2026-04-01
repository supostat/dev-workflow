import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { interpolate } from "./interpolate.js";
import { todayDate } from "./fs-helpers.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TEMPLATES_DIR = join(PACKAGE_ROOT, "templates");

const BUILTIN_TEMPLATES: Record<string, string> = {
  "vault/stack": `---
updated: {{date}}
tags: [stack, {{projectName}}]
---
# {{projectName}} — Stack

## Languages

## Frameworks

## Database

## Testing

## Infrastructure

## Dev Tools
`,

  "vault/conventions": `---
updated: {{date}}
tags: [conventions, {{projectName}}]
---
# {{projectName}} — Conventions

## File Structure

## Naming

## Code Style

## Patterns

## Git

## Testing
`,

  "vault/knowledge": `---
updated: {{date}}
tags: [knowledge, {{projectName}}]
---
# {{projectName}} — Knowledge

## Architecture

## Gotchas

## Patterns
`,

  "vault/gameplan": `---
updated: {{date}}
tags: [gameplan, {{projectName}}]
---
# {{projectName}} — Gameplan

## Current Phase

## Phases

## Backlog
`,

  "records/branch": `---
branch: {{branch}}
status: in-progress
created: {{date}}
parent: {{parent}}
tags: [branch, {{projectName}}]
---
# {{branch}}

## Goal

{{goal}}

## Tasks

## Decisions

## Open Questions

## Issues
`,

  "records/daily": `---
date: {{date}}
projects: [{{projectName}}]
branches: [{{branch}}]
tags: [session-log]
---
# Session — {{date}}

## Done

## Key Decisions

## Problems & Findings

## Open Questions

## Next Steps
`,

  "records/adr": `---
date: {{date}}
status: accepted
tags: [adr, {{projectName}}]
---
# {{title}}

## Context

## Decision

## Alternatives

## Consequences
`,

  "records/bug": `---
date: {{date}}
severity: {{severity}}
tags: [bug, {{projectName}}]
---
# {{title}}

## Symptoms

## Root Cause

## Fix

## Prevention
`,

  "records/debt": `---
date: {{date}}
priority: {{priority}}
effort: {{effort}}
tags: [debt, {{projectName}}]
---
# {{title}}

## Problem

## Why Deferred

## Proposal

## Risk If Ignored
`,

  "project/claude-md": `# {{projectName}}

## Dev Workflow

This project uses [dev-workflow](https://github.com/supostat/dev-workflow) for structured development with Claude Code.

### Available Commands

| Command | Description |
|---------|------------|
| \`/vault:from-spec\` | Fill vault from SPEC.md (new project) |
| \`/vault:analyze\` | Fill vault from codebase (existing project) |
| \`/workflow:dev "task"\` | Full 10-step pipeline: plan, code, review, test, verify, commit |
| \`/session:resume\` | Restore session context |
| \`/session:review\` | Multi-perspective code review |
| \`/session:handover\` | Save session context |

### Vault

Project knowledge is stored in \`.dev-vault/\`:
- \`stack.md\` — technology stack
- \`conventions.md\` — code conventions
- \`knowledge.md\` — architecture, gotchas, patterns
- \`gameplan.md\` — roadmap and phases

### Workflow

1. Create task: \`dev-workflow task create "title"\`
2. Start: \`dev-workflow task start <id>\`
3. Implement: \`/workflow:dev "task description"\`
4. Review: \`/session:review\`
5. Handover: \`/session:handover\`

## Project

<!-- Add project-specific instructions below -->
`,
};

export function renderTemplate(
  templateName: string,
  variables: Record<string, string> = {},
): string {
  const vars: Record<string, string> = { date: todayDate(), ...variables };

  const externalPath = join(TEMPLATES_DIR, `${templateName}.md`);
  let template: string;

  if (existsSync(externalPath)) {
    template = readFileSync(externalPath, "utf-8");
  } else {
    const builtin = BUILTIN_TEMPLATES[templateName];
    if (!builtin) {
      throw new Error(`Template not found: ${templateName}`);
    }
    template = builtin;
  }

  return interpolate(template, vars);
}

export function listTemplates(): string[] {
  return Object.keys(BUILTIN_TEMPLATES);
}
