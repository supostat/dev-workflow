---
name: session:handover
description: Save current session's work into .dev-vault/daily/ (append-only) with done/decisions/findings/open-questions/next-steps. Includes mandatory docs-vs-code currency check (CLI/MCP/pipeline/hook counts). Use at session end before context loss, or before switching branches.
allowed-tools: [Bash, Read, Edit, mcp__dev-workflow__workflow_status]
invocation: user
---

# /session:handover — Save detailed session context

Capture the current session's work into `.dev-vault/` for future sessions.

## Procedure

1. Run `git branch --show-current` and `git diff --stat`
2. Check workflow status via MCP tool `workflow_status`
3. Review what was done in this session
4. Show summary before saving:

📤 **Session Handover — \<date\>**

**Project:** \<name\> | **Branch:** \<branch\>

### ✅ Done
- \<accomplishment with file/commit reference\>

### 🧠 Key Decisions
- \<decision with reasoning\>

### ⚠️ Problems & Findings
- \<gotchas discovered\>

### ❓ Open Questions
- \<unresolved issues\>

### ➡️ Next Steps
- \<what to do next session\>

### 🔄 Status
- **Workflow:** \<state or idle\>
- **Tasks:** \<linked tasks and status\>
- **Uncommitted:** \<N files\>

**Save?** (yes / edit / skip)

5. If yes → APPEND to `.dev-vault/daily/<date>.md`
   - If file exists: read it first, then use Edit tool to append at the end (after `---` separator)
   - If file does not exist: create with Write tool
   - NEVER overwrite existing daily log content
6. Update branch context and knowledge.md if insights found
   - knowledge.md: use Edit tool to append to specific section, preserve existing
   - branch context: use Edit tool to update status field only

7. **Docs/website currency check** — verify code ↔ docs alignment.

   Canonical sources of truth (read these for current counts):

   | What | Source | How to count |
   |------|--------|--------------|
   | CLI commands | `src/cli/index.ts` | `grep -c '^\s*case "' src/cli/index.ts` |
   | MCP tools | `src/mcp/tools.ts` | entries in `getToolDefinitions()` array |
   | Pipeline steps | `templates/workflows/dev.yaml` | `grep -c '^  - name:' templates/workflows/dev.yaml` |
   | Hooks | `src/lib/settings-template.ts` | hook keys in `buildSettingsJson()` (e.g. `SessionStart`, `SessionEnd`, `TaskCompleted`) |

   Surfaces to verify (in order of likelihood to drift):

   - `website/app/page.tsx` — `STATS` array (numbers + labels), hero `<h1>` (e.g. "11 агентов"), Problem/Solution prose
   - `website/app/global.css` — `pipeline-step:nth-child(N)` animation rules must match `STATS[0]` step count
   - `README.md` — Features bullets ("N MCP tools", "N hooks"), CLI block, MCP Tools table, Slash Commands table, Pipeline section
   - `website/content/docs/index.mdx` — step-count claim
   - `website/content/docs/commands/cli.mdx` — Russian CLI table (must list all CLI commands)
   - `website/content/docs/commands/workflow.mdx` — pipeline table + step-file architecture diagram
   - `website/content/docs/mcp/tools.mdx` — tool count + Memory section table totals
   - `website/content/docs/quality/pipeline.mdx` — step diagram + gate table
   - `website/content/docs/installation.mdx` — tool count, hook count
   - `website/content/docs/concepts/intelligence.mdx` — Engram-related claims if changed

   Quick grep for stale numbers (run before saving):

   ```bash
   # Hunt for hard-coded counts that may be stale
   grep -rEn '\b(9|1[0-9]|20)[ -]?(MCP|tools?|hook|шаг|шагов|шаговый|step-?|агент|reviewer|хук[ао]в)\b' \
     README.md website/app/ website/content/docs/ 2>/dev/null | head -20
   ```

   Action by drift class:
   - ✅ **No drift** — note in handover Done section ("docs/website verified current")
   - 🔢 **Trivial drift** (number bump only) — fix inline before saving handover; mention in Done
   - 🏗️ **Structural drift** (missing rows, new sections needed, dead anchors) — record in "Open Questions" section AND ensure debt `2026-05-10-doc-vs-code-drift-unmonitored--pipeline-step--mcp-tool--cli-counts-not-invariant-tested.md` is still open (the planned `tests/docs-invariant.test.ts` will eventually automate this)
   - 🚨 **Production drift** (deployed website shows wrong number) — flag as high priority Next Step; consider hot-fix commit before merging branch

8. Offer to create records: /vault:bug, /vault:adr, /vault:debt
9. Commit vault changes

✅ **Saved** → `.dev-vault/daily/<date>.md`

## Rules

- **APPEND ONLY** — NEVER overwrite existing vault files. Read first, then Edit to append.
- **Edit tool ONLY** — NEVER use Write tool on existing files (it overwrites entirely)
- **Max 3 sentences per section** — reference material, not essays
- **MUST include** file paths or commit hashes in "Done" section — no vague descriptions
- **MUST create** vault records (/vault:bug, /vault:adr, /vault:debt) if findings qualify — not "offer", DO IT
- **MUST run docs/website currency check (Step 7)** — drift here is the most common regression after feature work that ships new CLI commands, MCP tools, pipeline steps, or hooks. Cheap to verify (~30s grep), expensive to discover later via screenshots from production deployment. Skipping this step is the leading cause of "we just shipped 0.2.0 but the website still says 13 tools" incidents.
- NEVER include secrets or tokens
