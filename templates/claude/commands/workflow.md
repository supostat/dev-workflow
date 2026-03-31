# /workflow — Manage development workflows

Run, resume, or check status of development workflows.

## Usage

- `/workflow run dev "task"` — Full dev workflow
- `/workflow run hotfix "fix"` — Quick hotfix
- `/workflow run review` — Code review only
- `/workflow run test` — Run tests only
- `/workflow status` — Current workflow status
- `/workflow resume` — Resume paused workflow

## Output format for /workflow run

🔄 **Workflow:** \<name\> — "\<task description\>"

| # | Step | Agent | Gate | Status |
|---|------|-------|------|--------|
| 1 | read | reader | — | ✅ done |
| 2 | plan | planner | approval | ⏸️ paused |
| 3 | code | coder | — | ○ pending |
| 4 | review | reviewer | review-pass | ○ pending |
| 5 | test | tester | tests-pass | ○ pending |
| 6 | commit | committer | — | ○ pending |

⏸️ **Step 'plan' requires approval.**

\<plan content\>

**Approve?** (yes / no / edit)

## Output format for /workflow status

🔄 **Workflow:** \<name\> (\<run id\>)

- **Status:** ✅ completed / ⏸️ paused / 🔴 failed
- **Step:** \<current\> (N/M)
- **Task:** \<linked task or none\>
- **Started:** \<timestamp\>

## Available Workflows

- **dev** — read → plan → code → review → test → commit
- **hotfix** — read → code → test → commit
- **review** — read → review
- **test** — read → test
