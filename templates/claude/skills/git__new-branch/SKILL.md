---
name: git:new-branch
description: Create a branch context file in .dev-vault/branches/ recording parent branch, linked task, and goal. Use after `git checkout -b` to give the new branch a vault-tracked purpose, linkable to gameplan phases and tasks.
allowed-tools: [Bash, Edit, mcp__dev-workflow__task_list]
invocation: user
---

# /git:new-branch — Create branch context

Create a context file for the current git branch in `.dev-vault/branches/`.

## Procedure

1. Run `git branch --show-current`
2. Determine parent branch
3. Check for linked tasks via MCP tool `task_list`
4. Ask user about branch goal if not clear

## Output format

Use this exact format (markdown, not code block):

🌿 **New Branch:** \<branch name\>

- **Parent:** \<parent branch\>
- **Created:** \<today\>
- **Linked task:** \<task id or none\>

**Goal:** \<what this branch aims to achieve\>

**Save?** (yes / edit goal / skip)

5. If yes → create `.dev-vault/branches/<branch-slug>.md`
6. Link to gameplan.md phase if applicable
7. If task exists → suggest `/task start <id>`

✅ **Created** → `.dev-vault/branches/<slug>.md`

## Naming

Branch slug: replace `/` with `-`. Example: `feature/auth-flow` → `feature-auth-flow.md`
