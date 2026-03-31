# /vault:analyze — Deep project analysis and vault population

Analyze the codebase and fill all vault sections with discovered information.

## Step 1: Check existing vault state

Read all vault files and show current state:

🔍 **Analyzing \<projectName\>...**

**Step 1/3 — Vault state**

| Section | Status | Content |
|---------|--------|---------|
| stack.md | ✅ / ○ | N items / empty |
| conventions.md | ✅ / ○ | N rules / empty |
| knowledge.md | ✅ / ○ | N entries / empty |
| gameplan.md | ✅ / ○ | N phases / empty |

Read: `.dev-vault/stack.md`, `.dev-vault/conventions.md`, `.dev-vault/knowledge.md`, `.dev-vault/gameplan.md`

## Step 2: Scan project structure

1. Run `find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/target/*' -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/.dev-vault/*' | head -100`
2. Identify project layout

Output:

📁 **Project:** \<layout type\> — N source files across M directories

## Step 3: Analyze code (5-10 representative files)

**IMPORTANT:** Use a single Agent (subagent_type: Explore) to read all files at once.
Do NOT read files one by one — this creates too many tool calls in the UI.
Spawn one agent with the list of files to read and patterns to extract.

Pick diverse areas: entry points, core modules, tests, configs.

Extract: File Structure, Naming, Code Style, Patterns, Testing conventions.

## Step 4: Show plan and ask for approval

📋 **Analysis plan:**

**Will update:**
- → **conventions.md** — add File Structure (N), Naming (N), Code Style (N)
- → **knowledge.md** — add Architecture (N), Gotchas (N)

**Will skip:**
- ✅ **stack.md** — already filled
- ○ **gameplan.md** — human input needed

**Proceed?** (yes / preview / skip)

**Wait for user confirmation before writing.**

- "preview" → show exactly what will be written
- "skip" → abort without changes
- "yes" → proceed to write

## Step 5: Write to vault (only after approval)

**Preserve existing content** — only append new information.

### conventions.md sections to fill:
- `## File Structure`: `- <directory> — <purpose>`
- `## Naming`: `- Functions: <convention>`, `- Types: <convention>`, `- Files: <convention>`
- `## Code Style`: `- Error handling: <pattern>`, `- Logging: <library>`
- `## Patterns`: `- <pattern>: <where used>`

### knowledge.md sections to fill:
- `## Architecture`: `- <component> → <component>: <relationship>`
- `## Gotchas`: `- <gotcha from code or README>`

## Step 6: Summary

✅ **Analyze complete**

| Section | Change |
|---------|--------|
| conventions.md | +N items (File Structure, Naming, Code Style) |
| knowledge.md | +N items (Architecture, Gotchas) |
| stack.md | unchanged |
| gameplan.md | skipped |

**Key findings:**
- \<most important discovery\>
- \<second finding\>
- \<third finding\>

💡 **Next:** fill gameplan.md manually, then /session:review

## Rules

- **Always ask before writing** — show plan, wait for approval
- **Preserve existing content** — never overwrite, only append
- **Be specific** — "functions use snake_case" not "standard naming"
- **Reference files** — "error handling in cli/src/main.rs uses anyhow"
- **Skip gameplan.md** — roadmap is human-authored
- Read max 15 files
- Never include secrets or credentials
