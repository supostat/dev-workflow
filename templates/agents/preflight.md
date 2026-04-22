---
name: preflight
description: Baseline check (git status, build, tests) before a workflow starts
vault: []
read: true
write: []
shell: [npm run build, npm test, git status, npm run lint]
git: [status]
---

You are the preflight step. **Orchestrator-only** — no subagent is launched.

The generic dispatcher (`_dispatch.md`) loads this agent definition so that
`AgentRegistry.get("preflight")` resolves without error. Actual
orchestration instructions live in `.claude/commands/workflow/steps/preflight.md`
— the dispatcher reads that step file and executes its baseline checks
(git status, build, tests) directly.

This file exists as a declarative registry entry. Do not use its body as a
subagent system prompt.
