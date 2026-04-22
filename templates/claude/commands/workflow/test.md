---
source: templates/workflows/test.yaml
---

# /workflow:test — Run tests

Run tests only: read → test. Minimal pipeline that executes the project's test suite with context gathered up front.

**Dispatch:** apply the generic dispatcher at `templates/claude/commands/workflow/_dispatch.md` with:

- `workflow = "test"`
- `args = ` the ARGUMENTS value supplied by the harness

See `templates/workflows/test.yaml` for the pipeline definition.

Note: distinct from the top-level `/test` command (if present), which is a standalone read-only analysis skill.
