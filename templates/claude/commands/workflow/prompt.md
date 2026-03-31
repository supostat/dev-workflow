# /workflow — Manage development workflows

Run, resume, or check status of development workflows.

## Usage

- `/workflow run dev "task description"` — Run full dev workflow
- `/workflow run hotfix "fix description"` — Quick hotfix workflow
- `/workflow run review` — Code review only
- `/workflow run test` — Run tests only
- `/workflow status` — Show current workflow status
- `/workflow resume` — Resume a paused workflow

## Procedure

### /workflow run

1. Determine the workflow type and task description from user input
2. Run `dev-workflow run <type> "<description>"` via shell
3. Report the result:
   - **completed** — all steps executed successfully
   - **paused** — waiting for user approval, suggest `/workflow resume`
   - **failed** — show which step failed and why

### /workflow status

1. Use MCP tool `workflow_status` or run `dev-workflow status`
2. Show: workflow name, current step, step progress (N/M), status

### /workflow resume

1. Run `dev-workflow resume` via shell
2. Report the result

## Available Workflows

| Name | Steps | When to use |
|------|-------|-------------|
| dev | read → plan → code → review → test → commit | Standard feature development |
| hotfix | read → code → test → commit | Urgent bug fixes, skip planning |
| review | read → review | Code review only |
| test | read → test | Run tests only |
