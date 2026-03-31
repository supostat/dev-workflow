# /merge — Process branch merge

Transfer knowledge from a merged branch into permanent storage.

## Procedure

1. Identify the merged branch (from git or user input)
2. Read `.dev-vault/branches/<branch-slug>.md`
3. Extract from branch context:
   - **Decisions** → append to `.dev-vault/knowledge.md`
   - **Findings/gotchas** → append to `.dev-vault/knowledge.md`
   - **Unfinished tasks** → move to `.dev-vault/gameplan.md` backlog
   - **Open questions** → flag to user
4. Update branch file:
   - Set `status: merged`
   - Add `merged: <today>`
5. Update `.dev-vault/gameplan.md`:
   - Mark completed phase/tasks
   - Add any follow-up items
6. Check related branches — update dependency references
7. Commit: `git add .dev-vault/ && git commit -m "vault: merge <branch-name>"`

## Rules

- Never delete the branch file — keep it as historical record
- Transfer only lasting knowledge, not session-specific details
- If branch was abandoned, set `status: abandoned` with reason
