# /resume — Restore session context

Read the project's `.dev-vault/` and load full context for the current session.

## Procedure

1. Run `git branch --show-current` to determine the current branch
2. Read these files from `.dev-vault/`:
   - `stack.md` — tech stack and tools
   - `conventions.md` — code style and patterns
   - `knowledge.md` — accumulated knowledge and gotchas
   - `gameplan.md` — roadmap and current phase
3. Read `.dev-vault/branches/<branch-slug>.md` for branch context
4. Read the 3 most recent files from `.dev-vault/daily/` for session history
5. Check for related branches (dependencies, blockers)

## Output format

Present a concise summary:

```
**Project:** <name>
**Branch:** <branch> (<status>)
**Last session:** <date>
**Current phase:** <from gameplan>

**Where we left off:**
- <from branch context or latest daily log>

**Open questions:**
- <from branch context>

**Next steps:**
- <from branch context or gameplan>
```

## Special cases

- **Branch main/master** → show gameplan overview and list active branches
- **New branch without context file** → ask user about the branch goal, then create `.dev-vault/branches/<slug>.md`
- **No vault found** → suggest running `dev-vault init`
- **Empty vault files** → ask user to fill stack.md and gameplan.md first
