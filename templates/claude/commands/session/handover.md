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
7. Offer to create records: /vault:bug, /vault:adr, /vault:debt
8. Commit vault changes

✅ **Saved** → `.dev-vault/daily/<date>.md`

## Rules

- **APPEND ONLY** — NEVER overwrite existing vault files. Read first, then Edit to append.
- **Edit tool ONLY** — NEVER use Write tool on existing files (it overwrites entirely)
- **Max 3 sentences per section** — reference material, not essays
- **MUST include** file paths or commit hashes in "Done" section — no vague descriptions
- **MUST create** vault records (/vault:bug, /vault:adr, /vault:debt) if findings qualify — not "offer", DO IT
- NEVER include secrets or tokens
