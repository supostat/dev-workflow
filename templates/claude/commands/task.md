# /task — Manage development tasks

Create, track, and manage tasks linked to git branches and workflows.

## Usage

- `/task create "title"` — Create a new task
- `/task list` — List all tasks
- `/task start <id>` — Start a task (creates branch, sets in-progress)
- `/task done <id>` — Mark task as done
- `/task show <id>` — Show task details

## Procedure

### /task create

1. Use MCP tool `task_create` with the title and optional description
2. Report the created task ID

### /task list

1. Use MCP tool `task_list` (with optional `--status` filter)
2. Display as table: ID, Status, Title

### /task start

1. Run `dev-workflow task start <id>` via shell
2. This creates a git branch `task/<slug>` and sets status to in-progress
3. Report the branch name

### /task done

1. Use MCP tool `task_update` with `status: "done"`
2. Confirm completion

### /task show

1. Use MCP tool `task_list` and find by ID, or run `dev-workflow task show <id>`
2. Display all fields: id, title, status, branch, workflow, dates, description

## Task Lifecycle

```
pending → in-progress → review → done
                ↓
             blocked
```

Tasks are stored as markdown in `.dev-vault/tasks/` and linked to git branches.
