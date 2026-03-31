# /session:resume — Restore session context

Read the project's `.dev-vault/` and load full context for the current session.

## Procedure

1. Run `git branch --show-current`
2. Read vault files: stack.md, conventions.md, knowledge.md, gameplan.md
3. Read branch context and 3 most recent daily logs
4. Check for active tasks and paused workflows

## Output format

Use this exact format (markdown, not code block):

📥 **Session Resume — \<projectName\>**

- **Branch:** \<branch\> (\<status\>)
- **Last session:** \<date\>
- **Current phase:** \<from gameplan\>

### 🔄 Where we left off
- \<from branch context or latest daily log\>

### ❓ Open questions
- \<from branch context\>

### ➡️ Next steps
- \<from branch context or gameplan\>

### 📋 Active tasks
- \<task id\> — \<title\> (\<status\>)

### ⏸️ Paused workflow
- \<workflow name\> — step: \<step\> (run: \<id\>)
- Resume with: `/workflow resume`

## Special cases

- **Branch main/master** → show gameplan overview and list active branches
- **New branch without context** → ask user about goal, create branch file
- **No vault** → suggest `dev-workflow init`
- **Empty vault files** → suggest `/vault:analyze`
