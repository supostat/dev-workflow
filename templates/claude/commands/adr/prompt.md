# /adr — Create Architecture Decision Record

Record a significant architectural or design decision in `.dev-vault/architecture/`.

## Procedure

1. Gather from conversation context:
   - **Context** — why the decision was needed
   - **Decision** — what was decided
   - **Alternatives** — what was considered and rejected
   - **Consequences** — trade-offs and implications
2. Create `.dev-vault/architecture/<YYYY-MM-DD>-<slug>.md`:

```markdown
---
date: <today>
status: accepted
tags: [adr, <project>]
---
# <decision title>

## Context
<why we needed to decide>

## Decision
<what we decided>

## Alternatives
<what we rejected and why>

## Consequences
<what changes, trade-offs>
```

3. Reference the ADR from related branch context if applicable

## When to use

- Choosing between frameworks, libraries, or approaches
- Defining data models or API contracts
- Changing project structure or conventions
- Any decision that future-you would want context on
