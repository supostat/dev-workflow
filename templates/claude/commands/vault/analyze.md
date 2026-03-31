# /vault:analyze — Deep project analysis with phased planning

Analyze the codebase and fill all vault sections with discovered information.
Uses phased approach with gate criteria before each write.

## Step 1: Check existing vault state

Read all vault files and show current state:

🔍 **Analyzing \<projectName\>...**

**Step 1/4 — Vault state**

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

📁 **Project:** \<layout type\> — N source files across M directories

## Step 3: Analyze code

**IMPORTANT:** Use a single Agent (subagent_type: Explore) to read all files at once.
Do NOT read files one by one — this creates too many tool calls in the UI.

Pick 5-10 diverse files: entry points, core modules, tests, configs.

Extract: File Structure, Naming, Code Style, Patterns, Testing conventions.

## Step 4: Phased plan with gate criteria

📋 **Analysis plan:**

### Phase 1: Conventions (gate: user approval)
- → **conventions.md** — add File Structure (N), Naming (N), Code Style (N)
- Gate: show items, user confirms

### Phase 2: Knowledge (gate: phase 1 complete)
- → **knowledge.md** — add Architecture (N), Gotchas (N)
- Gate: show items, user confirms

### Phase 3: Verification (gate: phase 2 complete)
- Verify no contradictions between conventions and knowledge
- Verify references point to real files

**Skip:**
- ✅ **stack.md** — already filled (verify only)
- ○ **gameplan.md** — requires human input

**Start Phase 1?** (yes / preview all / skip)

**Wait for user confirmation before each phase.**

## Step 5: Execute phases

For each phase:
1. Show exactly what will be written
2. Wait for approval
3. Write to vault via MCP tools or direct edit
4. Confirm what was written
5. Proceed to next phase

**Preserve existing content** — only append new information.

### conventions.md sections:
- `## File Structure`: `- <directory> — <purpose>`
- `## Naming`: `- Functions: <convention>`, `- Types: <convention>`, `- Files: <convention>`
- `## Code Style`: `- Error handling: <pattern>`, `- Logging: <library>`
- `## Patterns`: `- <pattern>: <where used>`

### knowledge.md sections:
- `## Architecture`: `- <component> → <component>: <relationship>`
- `## Gotchas`: `- <gotcha from code or README>`

## Step 6: Summary

✅ **Analyze complete**

| Phase | Section | Items added | Status |
|-------|---------|-------------|--------|
| 1 | conventions.md | +N | ✅ |
| 2 | knowledge.md | +N | ✅ |
| 3 | verification | N checks | ✅ / ⚠️ |

**Key findings:**
- \<most important discovery\>
- \<second finding\>
- \<third finding\>

💡 **Next:** fill gameplan.md manually, then /session:review

## Rules

- **Gate criteria:** each phase requires explicit user approval
- **Preserve existing content** — never overwrite, only append
- **Be specific** — "functions use snake_case" not "standard naming"
- **Reference files** — "error handling in cli/src/main.rs uses anyhow"
- **Skip gameplan.md** — roadmap is human-authored
- **Don't add utility crates/packages to stack.md** — only frameworks, ORMs, test runners
- Read max 15 files
- Never include secrets or credentials
