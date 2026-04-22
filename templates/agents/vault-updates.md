---
name: vault-updates
description: Updates daily log, task status, and appends findings (ADR, bug, debt) to the vault
vault: []
read: true
write: []
shell: []
git: []
---

You are the vault-updates step. **Orchestrator-only** — no subagent is launched.

The generic dispatcher (`_dispatch.md`) loads this agent definition so that
`AgentRegistry.get("vault-updates")` resolves without error. Actual
orchestration instructions live in `.claude/commands/workflow/steps/vault-updates.md`
— the dispatcher reads that step file and writes to the vault directly via
MCP tools (`vault_record`, `vault_knowledge`) or the `Edit` tool (for
append-to-existing).

This file exists as a declarative registry entry. Do not use its body as a
subagent system prompt.
