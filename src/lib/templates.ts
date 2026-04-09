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
| \`/intake "prompt"\` | Classify free-form input and recommend a workflow |
| \`/vault:from-spec\` | Fill vault from SPEC.md (new project) |
| \`/vault:analyze\` | Fill vault from codebase (existing project) |
| \`/workflow:dev "task"\` | Full 10-step pipeline: plan, code, review, test, verify, commit |
| \`/session:resume\` | Restore session context |
| \`/session:review\` | Multi-perspective code review |
| \`/session:handover\` | Save session context |

### Routing free-form input

When the user drops a loose idea, file, or copy/paste content (not a clearly scoped task), start with \`/intake "<request>"\` or \`/intake --file <path>\`. The intake agent classifies the request, proposes 2-3 workflow options with trade-offs, and recommends one. **Do not start coding immediately on free-form input.**

The intake agent ends its output with an exact next command, e.g. \`Next step: /workflow:dev dev "refined task description"\`. Run that command verbatim once the user confirms — or pick a different option from the proposed list if the user prefers.

Use \`/intake\` for: vague feature requests, exploratory questions, "should we X or Y?" decisions, files or specs to analyse before acting.

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

### Vault write rules (ALWAYS ACTIVE)

When a scope change, architecture decision, deferred work, or new gotcha is **mentioned, confirmed, or implied** — record IMMEDIATELY. Do NOT wait for explicit "yes". Triggers:

- User writes "defer X", "move X to phase Y", "postpone", "skip for now" → **debt** + **gameplan update**
- User writes "let's use X instead of Y", "chose X", "decided on X" → **ADR**
- User writes "X doesn't work because Y", "blocker: X" → **gotcha** in knowledge.md
- User writes "change phase scope", "reduce phase", "add to phase" → **gameplan update** + **ADR**
- Pipeline REVIEW finds blocker → **ADR** (decision to stop/change) + **debt** (deferred work)
- User updates task status with reason → **debt** if blocked/deferred, **ADR** if scope change

Actions:
- **Architecture/scope decision** → \`vault_record(type: "adr", title, content)\`
- **Work deferred** → \`vault_record(type: "debt", title, content)\`
- **New gotcha** → append to \`.dev-vault/knowledge.md\` section "Gotchas" (Edit tool, APPEND)
- **Gameplan changed** → update \`.dev-vault/gameplan.md\` (Edit tool)

This applies in ALL contexts: /workflow:dev (including aborted), free conversation, /vault:arch, task updates. Do NOT wait for pipeline completion. Record the moment the decision becomes clear.

Use Edit tool to APPEND to existing vault files. NEVER use Write tool on existing files.

### Questions to user (ALWAYS ACTIVE)

Questions MUST be unambiguous. User's answer must map to exactly one action.

- **NEVER ask OR-questions answerable with yes/no:**
  BAD: "Continue or stash first?" (what does "yes" mean?)
  GOOD: "1. Continue with uncommitted changes  2. Stash first  3. Commit first"
- **Use numbered options** for choices (2-4 options). User answers with number.
- **Use yes/no ONLY** for binary questions with one clear action:
  GOOD: "Commit these changes? (yes/no)"
  BAD: "Should we fix this or skip it?" (yes = fix? yes = skip?)
- **Default option**: mark with "(default)" if one option is recommended.

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
