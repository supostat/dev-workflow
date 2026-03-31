# /task — Manage development tasks

Create, track, and manage tasks linked to git branches and workflows.

## Usage

- `/task create "title"` — Create a new task
- `/task list` — List all tasks
- `/task start <id>` — Start task (set in-progress)
- `/task done <id>` — Mark as done
- `/task show <id>` — Show details

## Output format for /task create

📋 **Task created**

- **ID:** task-001
- **Title:** \<title\>
- **Status:** ⚪ pending
- **Priority:** medium

💡 Start working? `/task start task-001`

## Output format for /task list

📋 **Tasks**

- 🟢 **task-001** — \<title\> (done, high)
- 🔵 **task-002** — \<title\> (in-progress, medium)
- ⚪ **task-003** — \<title\> (pending, low)
- 🔴 **task-004** — \<title\> (blocked, high)

**N tasks** (done: N, in-progress: N, pending: N)

## Output format for /task show

📋 **task-001** — \<title\>

- **Status:** 🟢 done
- **Priority:** high
- **Branch:** \<branch or none\>
- **Workflow:** \<run id or none\>
- **Created:** \<date\>
- **Updated:** \<date\>

\<description if any\>

## Task Lifecycle

⚪ pending → 🔵 in-progress → 🟠 review → 🟢 done

↘ 🔴 blocked
