---
name: workflow:hotfix
description: Quick fix workflow: preflight, code, test, commit. Skips planning and review for trivial production bug fixes where speed matters more than process. Use only for genuinely simple changes (one-line fixes, typo corrections). For anything ambiguous use /workflow:dev instead.
allowed-tools: [Bash, Agent, mcp__dev-workflow__workflow_start, mcp__dev-workflow__step_start, mcp__dev-workflow__step_complete, mcp__dev-workflow__memory_search, mcp__dev-workflow__memory_judge]
invocation: user
---

---
source: templates/workflows/hotfix.yaml
---

# /workflow:hotfix — Quick fix workflow

Quick fix workflow: preflight → read → code → test → verify → commit → vault-updates. Skips planning and review for rapid fixes.

**Dispatch:** apply the generic dispatcher at `templates/claude/commands/workflow/_dispatch.md` with:

- `workflow = "hotfix"`
- `args = ` the ARGUMENTS value supplied by the harness

See `templates/workflows/hotfix.yaml` for the pipeline definition.
