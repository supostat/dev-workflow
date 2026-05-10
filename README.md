# dev-workflow

[![npm](https://img.shields.io/npm/v/@engramm/dev-workflow)](https://www.npmjs.com/package/@engramm/dev-workflow)
[![CI](https://github.com/supostat/dev-workflow/actions/workflows/website.yml/badge.svg)](https://github.com/supostat/dev-workflow/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Multi-agent development pipeline for Claude Code.** 11 steps from task to commit, with quality gates, isolated agent permissions, and persistent project vault.

```
PREFLIGHT → READ → PLAN → PLAN_REVIEW → PLAN_FIX → CODER → REVIEW×3 → TEST → VERIFY → COMMIT
   bash     Explore Explore  Explore      Full       Full    Explore×3   bash  Explore   Full
```

## Why

Claude Code is powerful, but without structure it improvises. It skips reviews, forgets tests, loses context between sessions, and drifts from the original task.

dev-workflow gives it a **strict protocol**: every task goes through an 11-step pipeline with quality gates. Each agent is isolated by permissions. Context persists across sessions.

## Features

- **11-step quality pipeline** — preflight, plan with pseudo-code, plan review (9 criteria), surgical plan-fix on detail-level revisions, test-first coding, 3 parallel reviewers, mandatory test gate, task verification, commit
- **Agent isolation** — reader can't write, coder can't commit, reviewer can't modify code
- **3 specialized reviewers** — security, quality, and coverage run in parallel on real `git diff`
- **Vault** — persistent project knowledge: stack, conventions, architecture, gameplan
- **Intelligence** — pattern graph with scoring (recency, frequency, context match)
- **Phase mode** — break large specs into phases, code each subtask separately
- **Interactive & autonomous** — ask before commit (default) or auto-commit for swarm use
- **20 MCP tools** — programmatic access to vault, tasks, intelligence, memory, workflows, agents (via `.mcp.json`)
- **Engram memory** — persistent long-term store with semantic search via Voyage AI embeddings; auto-decorated with pipeline tags (step/branch/run/task)
- **3 hooks** — SessionStart, SessionEnd, TaskCompleted
- **From spec to code** — `/vault:from-spec` fills vault from SPEC.md in 4 phased steps
- **Auto-setup** — `init` generates CLAUDE.md, permissions, .mcp.json, stack-based .gitignore
- **Plan persistence** — approved plans saved to vault for audit and session resume
- **Modular prompts** — thin shim orchestrator (~14 lines) + 11 step files read on demand

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
| 3. PLAN_REVIEW | Explore | 9 criteria + verdict-aware gate (NEEDS_REVISION short-circuits user-approve) |
| 4. PLAN_FIX | Full | Apply surgical Edits to saved plan when reviewer emits `Next: plan-fix` (no-op pass-through if approved) |
| 5. CODER | Full | Test-first implementation |
| 6. REVIEW | Explore ×3 | Security + Quality + Coverage (parallel, real git diff) |
| 7. FIX LOOP | Full + Explore | Coder fixes, reviewer re-checks (max 3 iterations) |
| 8. TEST | bash | Build + lint + tests (compared against baseline) |
| 9. VERIFY | Explore | Does the code match the original task? |
| 10. COMMIT | Full | Stage + commit (interactive or autonomous) |

## Permission Matrix

```
Agent          Read   Write   Bash           Subagent
─────────────  ─────  ──────  ─────────────  ────────
READ           yes    no      no             Explore
PLAN           yes    no      no             Explore
PLAN_REVIEW    yes    no      no             Explore
PLAN_FIX       yes    yes     no             Full (coder)
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
| `/vault:pattern` | Append a pattern bullet to conventions.md |
| `/vault:debt` | Record tech debt |
| `/vault:arch` | Architecture analysis: 2-3 options with trade-offs |
| `/vault:project-review` | Full project audit: 7 perspectives, A-F scoring |
| `/vault:deps` | Map module dependencies |
| `/vault:security-scan` | Security audit |
| `/vault:test-gaps` | Find untested code |

### Workflow

| Command | Description |
|---------|------------|
| `/workflow:dev "task"` | Full 11-step pipeline |
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
dev-workflow templates-root              # Print absolute path to bundled templates/
dev-workflow settings-template           # Print bundled .claude/settings.json (absolute paths)
dev-workflow spec-template               # Print bundled SPEC.md template (Mirror Skeleton)
dev-workflow engram-trace <runId>        # Show engram socket trace summary [--raw]
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

20 tools available via MCP server:

| Tool | Description |
|------|------------|
| `vault_status` | Full vault state in one call |
| `vault_read` | Read vault section |
| `vault_search` | Search vault files |
| `vault_record` | Create ADR / bug / debt record (auto-mirrored to engram) |
| `vault_knowledge` | Append to knowledge.md |
| `vault_pattern` | Append a pattern bullet to conventions.md |
| `intelligence_query` | Query pattern graph with scoring |
| `task_create` | Create task |
| `task_list` | List tasks |
| `task_update` | Update task |
| `task_start` | Start task (link to branch) |
| `task_create_from_phase` | Parse phase file and create missing tasks |
| `workflow_status` | Current workflow status |
| `workflow_create` | Save a custom workflow YAML |
| `agent_list` | List agents with permissions |
| `agent_run` | Generate agent prompt with vault context |
| `parse_engram_feedback` | Parse `## Engram Feedback` block from agent output |
| `memory_search` | Search Engram memories with auto-decoration (step/branch/run/task tags) |
| `memory_store` | Store Engram memory with auto-decoration; throws daemon errors to caller |
| `memory_judge` | Rate Engram memory's usefulness (0.0–1.0) |

## Migration: 0.1.x → 0.2.0

`mcp__dev-workflow__memory_store` now **throws** daemon errors (Voyage 403,
offline, etc.) via JSON-RPC `isError: true` — previously returned silent
`{id: null}`. Wrap calls in `try/catch` if you depend on silent behavior, or
call `mcp__engram__memory_store` directly (no auto-decoration). Auto-mirror
via `vault_record` / `vault_knowledge` / `vault_pattern` is unchanged
(silent fail-safe; vault file is source of truth).

Engram socket resolution moved to per-project: `ENGRAM_SOCKET_PATH` →
`<project>/.engram/engram.sock` → `$HOME/.engram/engram.sock` (legacy).
Run `engram migrate` from the project root to copy legacy memories.

Pipeline gained 11th step `PLAN_FIX`. `dev-workflow validate` warns about
stale references in custom workflows.

Full notes: [CHANGELOG.md](CHANGELOG.md).

## Documentation

Full documentation: [supostat.github.io/dev-workflow](https://supostat.github.io/dev-workflow/)

## License

MIT
