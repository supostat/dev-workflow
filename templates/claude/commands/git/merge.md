# /git:merge — Process branch merge

Transfer knowledge from a merged branch into permanent storage.

## Procedure

1. Identify merged branch (from git or user input)
2. Read `.dev-vault/branches/<branch-slug>.md`
3. Show what will be transferred:

🔀 **Merge:** \<branch name\>

### Transfer to knowledge.md
- **Decisions:** \<list from branch context\>
- **Gotchas:** \<findings discovered\>

### Transfer to gameplan.md
- **Unfinished:** \<tasks to move to backlog\>

### ❓ Open questions
- \<flag for user attention\>

**Proceed?** (yes / skip)

4. If yes:
   - APPEND decisions/gotchas to knowledge.md (read first, Edit tool to append to section)
   - APPEND unfinished to gameplan.md backlog (read first, Edit tool to append)
   - Edit branch file: set `status: merged`, add `merged: <today>` (Edit tool, not Write)
   - Edit gameplan.md: mark completed tasks with `[x]` (Edit tool)

✅ **Merged** — branch context archived, knowledge transferred

## Rules

- **APPEND ONLY** — never overwrite existing vault files. Read first, then append with Edit tool.
- Use Edit tool for all vault modifications, not Write tool (Write overwrites the entire file)
- Never delete branch file — keep as historical record
- Transfer only lasting knowledge, not session-specific details
- If abandoned: set `status: abandoned` with reason
