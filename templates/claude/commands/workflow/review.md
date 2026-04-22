---
source: templates/workflows/review.yaml
---

# /workflow:review — Code review with vault findings record

Code review with vault findings record: read → review → vault-updates. Read-only analysis that records CRITICAL/HIGH findings as ADR/bug/debt entries.

**Dispatch:** apply the generic dispatcher at `templates/claude/commands/workflow/_dispatch.md` with:

- `workflow = "review"`
- `args = ` the ARGUMENTS value supplied by the harness

See `templates/workflows/review.yaml` for the pipeline definition.
