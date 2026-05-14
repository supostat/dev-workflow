---
name: workflow:review
description: Three-perspective code review (security, quality, coverage) with findings auto-recorded to vault as patterns, debt, or knowledge entries. Read-only — never modifies code. Use to audit a branch before commit or PR.
allowed-tools: [Read, Grep, Bash, Agent, mcp__dev-workflow__workflow_start, mcp__dev-workflow__step_start, mcp__dev-workflow__step_complete, mcp__dev-workflow__memory_search, mcp__dev-workflow__memory_judge, mcp__dev-workflow__vault_record, mcp__dev-workflow__vault_knowledge, mcp__dev-workflow__vault_pattern]
invocation: user
---

---
source: templates/workflows/review.yaml
---

# /workflow:review — Code review with vault findings record

Code review with vault findings record: read → review → vault-updates. Read-only analysis that records CRITICAL/HIGH findings as ADR/bug/debt entries.

**Dispatch:** apply the generic dispatcher at `templates/claude/commands/workflow/_dispatch.md` with:

- `workflow = "review"`
- `args = ` the ARGUMENTS value supplied by the harness

See `templates/workflows/review.yaml` for the pipeline definition.
