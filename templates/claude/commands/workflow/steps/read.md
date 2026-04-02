# Step 1: READ

Launch **Explore** subagent with this prompt:

```
You are a reader agent. Gather context for the task below.

## Task
[task from user]

## Project Context
[vault sections: stack.md, conventions.md, knowledge.md, gameplan.md]

## Procedure
1. Read CLAUDE.md for project instructions
2. Find files relevant to the task (Glob/Grep)
3. Read relevant files (max 10 files, 500 lines each)
4. Find dependencies and tests for those files
5. Find how similar things are done in the project
6. Scan .dev-vault/architecture/ for ADR records related to this task
7. Scan .dev-vault/bugs/ for known bugs in affected areas
8. Scan .dev-vault/debt/ for known debt in affected areas

## Output Format
CONTEXT:
Task: [reformulated task with project context]
Files to change: [file list with what to change]
Dependencies: [files depending on changes]
Tests: [existing tests for those files]
Patterns found: [how similar things are solved]
Relevant code: [key fragments]
Related ADRs: [from .dev-vault/architecture/ or "none"]
Known bugs: [from .dev-vault/bugs/ or "none"]
Known debt: [from .dev-vault/debt/ or "none"]
END_CONTEXT
```

Save CONTEXT block. Display:

```
── READ ──
Files to change: [N]
Dependencies: [N]
Tests: [N]
```
