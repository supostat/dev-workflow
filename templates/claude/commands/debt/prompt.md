# /debt — Record tech debt

Create a tech debt record in `.dev-vault/debt/`.

## Procedure

1. Gather from user or conversation context:
   - **What** — the specific technical debt
   - **Why deferred** — reason it's not being fixed now
   - **Priority** — high / medium / low
   - **Effort** — small / medium / large
   - **Risk** — what happens if we don't fix it
2. Create `.dev-vault/debt/<YYYY-MM-DD>-<slug>.md`:

```markdown
---
date: <today>
priority: <high|medium|low>
effort: <small|medium|large>
tags: [debt, <project>]
---
# <title>

## Problem
<what's wrong>

## Why Deferred
<context>

## Proposal
<how to fix, estimated scope>

## Risk If Ignored
<consequences>
```

3. Add reference in `.dev-vault/gameplan.md` backlog section
