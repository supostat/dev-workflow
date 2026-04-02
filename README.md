# dev-workflow

[![npm](https://img.shields.io/npm/v/@engramm/dev-workflow)](https://www.npmjs.com/package/@engramm/dev-workflow)
[![CI](https://github.com/supostat/dev-workflow/actions/workflows/website.yml/badge.svg)](https://github.com/supostat/dev-workflow/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Multi-agent development pipeline for Claude Code.** 10 steps from task to commit, with quality gates, isolated agent permissions, and persistent project vault.

```
PREFLIGHT → READ → PLAN → PLAN_REVIEW → CODER → REVIEW×3 → TEST → VERIFY → COMMIT
   bash     Explore Explore  Explore      Full    Explore×3   bash  Explore   Full
```

## Why

Claude Code is powerful, but without structure it improvises. It skips reviews, forgets tests, loses context between sessions, and drifts from the original task.

dev-workflow gives it a **strict protocol**: every task goes through a 10-step pipeline with quality gates. Each agent is isolated by permissions. Context persists across sessions.

## Features

- **10-step quality pipeline** — preflight, plan with pseudo-code, plan review (9 criteria), test-first coding, 3 parallel reviewers, mandatory test gate, task verification, commit
- **Agent isolation** — reader can't write, coder can't commit, reviewer can't modify code
- **3 specialized reviewers** — security, quality, and coverage run in parallel on real `git diff`
- **Vault** — persistent project knowledge: stack, conventions, architecture, gameplan
- **Intelligence** — pattern graph with scoring (recency, frequency, context match)
- **Phase mode** — break large specs into phases, code each subtask separately
- **Interactive & autonomous** — ask before commit (default) or auto-commit for swarm use
- **13 MCP tools** — programmatic access to vault, tasks, intelligence (via `.mcp.json`)
- **5 hooks** — SessionStart, SessionEnd, PostToolUse, TaskCompleted, PreCompact
- **From spec to code** — `/vault:from-spec` fills vault from SPEC.md in 4 phased steps
- **Auto-setup** — `init` generates CLAUDE.md, permissions, .mcp.json, stack-based .gitignore
- **Plan persistence** — approved plans saved to vault for audit and session resume
- **Modular prompts** — orchestrator (153 lines) + 11 step files read on demand

## Quick Start

```bash
npm install -g @engramm/dev-workflow
cd your-project
dev-workflow init
```

Then in Claude Code (VS Code or CLI):

```
/vault:analyze                  # fill vault from existing codebase
/workflow:dev "add email validation"   # run the full pipeline
```

### New project from specification

```
/vault:from-spec                # fill vault from SPEC.md
/workflow:dev .dev-vault/phases/phase-1-foundation.md   # implement phase 1
```

## Pipeline

| Step | Agent | What it does |
|------|-------|-------------|
| 0. PREFLIGHT | bash | Baseline: git status, build, tests |
| 1. READ | Explore | Gather context from codebase |
| 2. PLAN | Explore | Architecture analysis + pseudo-code |
| 3. PLAN_REVIEW | Explore | 9 criteria: completeness, architecture, production readiness |
| 4. CODER | Full | Test-first implementation |
| 5. REVIEW | Explore ×3 | Security + Quality + Coverage (parallel, real git diff) |
| 6. FIX LOOP | Full + Explore | Coder fixes, reviewer re-checks (max 3 iterations) |
| 7. TEST | bash | Build + lint + tests (compared against baseline) |
| 8. VERIFY | Explore | Does the code match the original task? |
| 9. COMMIT | Full | Stage + commit (interactive or autonomous) |

## Permission Matrix

```
Agent          Read   Write   Bash           Subagent
─────────────  ─────  ──────  ─────────────  ────────
READ           yes    no      no             Explore
PLAN           yes    no      no             Explore
PLAN_REVIEW    yes    no      no             Explore
CODER          yes    yes     build/test     Full
REVIEW ×3      yes    no      no             Explore
TEST           no     no      build/test     bash
VERIFY         yes    no      no             Explore
COMMIT         no     no      git only       Full
```

Violation = immediate pipeline abort.

## Slash Commands

### Vault

| Command | Description |
|---------|------------|
| `/vault:from-spec` | Fill vault from project specification (4 phases with approval gates) |
| `/vault:analyze` | Deep codebase analysis, fill conventions + knowledge |
| `/vault:bug` | Record a resolved bug |
| `/vault:adr` | Record an architecture decision |
| `/vault:debt` | Record tech debt |
| `/vault:arch` | Architecture analysis: 2-3 options with trade-offs |
| `/vault:project-review` | Full project audit: 7 perspectives, A-F scoring |
| `/vault:deps` | Map module dependencies |
| `/vault:security-scan` | Security audit |
| `/vault:test-gaps` | Find untested code |

### Workflow

| Command | Description |
|---------|------------|
| `/workflow:dev "task"` | Full 10-step pipeline |
| `/workflow:dev path/phase.md` | Phase mode (subtask loop) |
| `/workflow:dev "task" --auto-commit` | Autonomous mode for swarm |

### Session

| Command | Description |
|---------|------------|
| `/session:resume` | Restore session context |
| `/session:handover` | Save detailed session notes |
| `/session:review` | Multi-perspective code review (5 perspectives) |

### Git

| Command | Description |
|---------|------------|
| `/git:new-branch` | Create branch context |
| `/git:pr-review` | PR review with vault context |
| `/git:changelog` | Generate changelog |
| `/git:merge` | Transfer knowledge after merge |

## CLI

```bash
dev-workflow init [--force] [--detect]   # Initialize vault, hooks, CLAUDE.md, .mcp.json
dev-workflow update                      # Update commands/agents from package
dev-workflow status                      # Vault and workflow status
dev-workflow doctor [--fix]              # Health check (vault, hooks, .mcp.json, permissions)
dev-workflow task create|list|start|done # Task management
dev-workflow agent list|show|run         # Agent management
dev-workflow run dev|hotfix|review|test  # CLI workflows
dev-workflow search "query"              # Search vault
dev-workflow config show|get|set         # Configuration
dev-workflow export|import               # Vault backup
dev-workflow serve                       # Start MCP server
```

## MCP Tools

14 tools available via MCP server:

| Tool | Description |
|------|------------|
| `vault_status` | Full vault state in one call |
| `vault_read` | Read vault section |
| `vault_search` | Search vault files |
| `vault_record` | Create ADR/bug/debt record |
| `vault_knowledge` | Append to knowledge.md |
| `intelligence_query` | Query pattern graph with scoring |
| `task_create` | Create task |
| `task_list` | List tasks |
| `task_update` | Update task |
| `task_start` | Start task (link to branch) |
| `task_create_from_phase` | Parse phase file and create missing tasks |
| `workflow_status` | Current workflow status |
| `agent_list` | List agents with permissions |
| `agent_run` | Generate agent prompt with vault context |

## Documentation

Full documentation: [supostat.github.io/dev-workflow](https://supostat.github.io/dev-workflow/)

## License

MIT
