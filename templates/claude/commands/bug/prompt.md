# /bug — Record a resolved bug

Create a bug log in `.dev-vault/bugs/` for non-trivial bugs that were solved.

## Procedure

1. Gather from conversation context:
   - **Symptoms** — how the bug manifested
   - **Root cause** — why it happened
   - **Fix** — what was done to solve it
   - **Prevention** — how to avoid it in the future
   - **Severity** — critical / high / medium / low
2. Create `.dev-vault/bugs/<YYYY-MM-DD>-<slug>.md`:

```markdown
---
date: <today>
severity: <critical|high|medium|low>
tags: [bug, <project>]
---
# <brief description>

## Symptoms
<how it showed up>

## Root Cause
<why it happened>

## Fix
<what we did — reference files/commits>

## Prevention
<how to ensure it doesn't happen again>
```

3. If the bug revealed a pattern, update `.dev-vault/knowledge.md`

## When to use

Only for non-trivial bugs worth remembering. Simple typos or config mistakes don't need a record.
