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

5. If yes → write to `.dev-vault/daily/<date>.md`
6. Update branch context and knowledge.md if insights found
7. Offer to create records: /vault:bug, /vault:adr, /vault:debt
8. Commit vault changes

✅ **Saved** → `.dev-vault/daily/<date>.md`

## Rules

- Keep entries concise — reference material, not essays
- Use Obsidian wikilinks for cross-references
- Never include secrets or tokens
