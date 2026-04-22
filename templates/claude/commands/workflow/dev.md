---
source: templates/workflows/dev.yaml
---

# /workflow:dev — Multi-agent development cycle

Full development workflow: preflight → read → plan → plan-review → code → review → test → verify → commit → vault-updates.

**Dispatch:** apply the generic dispatcher at `templates/claude/commands/workflow/_dispatch.md` with:

- `workflow = "dev"`
- `args = ` the ARGUMENTS value supplied by the harness

The dispatcher resolves `dev` from `templates/workflows/dev.yaml` (or from `.dev-vault/workflows/dev.yaml` if the project overrides the builtin), runs each step via the step-file resolution order, enforces gates and permissions, and records findings to the vault.
