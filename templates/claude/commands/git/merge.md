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
   - Append decisions/gotchas to knowledge.md
   - Move unfinished to gameplan.md backlog
   - Set branch status: `merged`, add `merged: <today>`
   - Update gameplan.md: mark completed tasks

✅ **Merged** — branch context archived, knowledge transferred

## Rules

- Never delete branch file — keep as historical record
- Transfer only lasting knowledge, not session-specific details
- If abandoned: set `status: abandoned` with reason
