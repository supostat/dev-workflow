# /handover — Save detailed session context

Capture the current session's work into `.dev-vault/` for future sessions.

## Procedure

1. Run `git branch --show-current` and `git diff --stat` to understand current state
2. Check workflow status via MCP tool `workflow_status` or `dev-workflow status`
3. Review what was done in this session (from conversation context)
4. Create/update `.dev-vault/daily/<YYYY-MM-DD>.md`:

```markdown
---
date: <today>
projects: [<project>]
branches: [<branch>]
tags: [session-log]
---
# Session — <date>

## Done
- <specific accomplishments with file/commit references>

## Key Decisions
- <architectural or design decisions made, with reasoning>

## Problems & Findings
- <bugs found, gotchas discovered, workarounds applied>

## Open Questions
- <unresolved issues>

## Next Steps
- <what to do in the next session>

## Workflow Status
- <current workflow state if any, paused step, pending actions>

## Task Status
- <linked tasks and their current status>
```

5. Update `.dev-vault/branches/<branch-slug>.md`:
   - Mark completed tasks with `[x]`
   - Add new decisions and findings
   - Update open questions
6. Update `.dev-vault/knowledge.md` if session produced lasting insights:
   - New gotchas or patterns
   - Architecture decisions
   - Important findings about dependencies
   Use MCP tool `vault_knowledge` to append to specific sections.
7. Check if any records should be created:
   - Non-trivial bug fixed → `/bug`
   - Architecture decision made → `/adr`
   - Tech debt discovered → `/debt`
8. Update task status if applicable:
   - Use MCP tool `task_update` to set status
9. Commit vault changes: `git add .dev-vault/ && git commit -m "session: <brief description>"`

## Rules

- Daily log entries use Obsidian wikilinks to reference branch and knowledge sections
- Keep entries concise — reference material, not essays
- If multiple sessions in one day, append with `---` separator
- Never include secrets, passwords, or tokens
