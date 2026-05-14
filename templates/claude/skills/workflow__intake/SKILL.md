---
name: workflow:intake
description: Workflow-mode wrapper around /intake. Runs the intake agent in pipeline context with proper engram correlation and step boundaries. Use when invoking intake from inside another workflow chain. For free-form intake use /intake instead.
allowed-tools: [Read, Bash, mcp__dev-workflow__workflow_start, mcp__dev-workflow__step_start, mcp__dev-workflow__step_complete, mcp__dev-workflow__memory_search]
invocation: user
---

---
source: templates/workflows/intake.yaml
---

# /workflow:intake — Classify free-form input

Classify free-form input and recommend a workflow. Single `classify` step with a user-approve gate — read-only, does not modify files.

**Dispatch:** apply the generic dispatcher at `templates/claude/commands/workflow/_dispatch.md` with:

- `workflow = "intake"`
- `args = ` the ARGUMENTS value supplied by the harness

See `templates/workflows/intake.yaml` for the pipeline definition.

Note: this is the unified-dispatcher-driven variant. The top-level `/intake` command (`templates/claude/commands/intake.md`) provides the same classification without going through the workflow dispatcher.
