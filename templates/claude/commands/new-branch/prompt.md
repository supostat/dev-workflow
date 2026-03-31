# /new-branch — Create branch context

Create a context file for the current git branch in `.dev-vault/branches/`.

## Procedure

1. Run `git branch --show-current` to get branch name
2. Determine parent branch (usually main/master)
3. Ask user about the branch goal if not clear from context
4. Create `.dev-vault/branches/<branch-slug>.md`:

```markdown
---
branch: <full branch name>
status: in-progress
created: <today>
parent: <parent branch>
tags: [branch, <project>]
---
# <branch-name>

## Goal
<what this branch aims to achieve>

## Tasks
- [ ] <task 1>
- [ ] <task 2>

## Decisions
- (none yet)

## Open Questions
- (none yet)

## Issues
- (none yet)

## Links
- ADR: (none)
- Depends on: (none)
- Blocks: (none)
```

5. Read `gameplan.md` to link branch to a phase if applicable

## Naming

Branch slug: replace `/` with `-`. Example: `feature/auth-flow` → `feature-auth-flow.md`
