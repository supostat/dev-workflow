---
source: templates/workflows/hotfix.yaml
---

# /workflow:hotfix — Quick fix workflow

Quick fix workflow: preflight → read → code → test → verify → commit → vault-updates. Skips planning and review for rapid fixes.

**Dispatch:** apply the generic dispatcher at `templates/claude/commands/workflow/_dispatch.md` with:

- `workflow = "hotfix"`
- `args = ` the ARGUMENTS value supplied by the harness

See `templates/workflows/hotfix.yaml` for the pipeline definition.
