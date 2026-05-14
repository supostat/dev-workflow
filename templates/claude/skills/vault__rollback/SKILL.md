---
name: vault:rollback
description: Restore the vault to a previous snapshot with destructive safety: always shows pre-rollback manifest preview, requires exact yes confirmation (no fuzzy match), auto-creates a safety snapshot before deletion. Use when a vault edit caused data loss or corruption.
allowed-tools: [Bash]
invocation: user
---

# /vault:rollback — Restore vault to a previous snapshot

Destructive: replaces current vault contents with the named snapshot.
Reversible because the CLI auto-creates a `pre-rollback-<ISO>`
snapshot BEFORE the replacement.

## Procedure

1. Parse the user's argument: the snapshot name to restore.
2. If no name provided, run `dev-workflow snapshot list` first so the
   user sees options, then ask which to restore. Do NOT pick one
   automatically.
3. **Pre-rollback safety preview**: run `dev-workflow snapshot show
   <name>` and display the manifest summary. Confirm user knows what
   they're restoring (file count, branch, created date).
4. **Ask for confirmation explicitly**:
   - "About to restore vault to snapshot `<name>` (created
     YYYY-MM-DD, N files). This will:"
   - "  - Auto-create a `pre-rollback-<ISO>` snapshot of current state"
   - "  - Delete current vault files (except `snapshots/`, runtime
     state, trace files)"
   - "  - Copy snapshot contents over"
   - "Proceed? (yes/no)"
   - Wait for explicit `yes` reply. Treat anything else (including
     "y", "ok", silence) as NO.
5. On confirmation: invoke `dev-workflow snapshot rollback <name>`
   via Bash tool.
6. Surface CLI output. The CLI prints the pre-rollback snapshot name
   — relay it prominently so user knows the revert path.

## Output format

After rollback completes, display as plain markdown (NOT in a code fence):

✅ **Vault restored to `<name>`**

- **Files restored:** N
- **Pre-rollback snapshot:** `pre-rollback-<ISO>`
- **To revert:** `/vault:rollback pre-rollback-<ISO>`

Next: verify vault state via `/vault:search "<known content>"` or
`dev-workflow status` to confirm the restore landed as expected.

## Refusal cases (do NOT execute)

- **User reply is not exactly `yes`** — STOP. Print "Rollback
  aborted." and exit. Don't ask twice.
- **Snapshot doesn't exist** — surface CLI error verbatim. Suggest
  `/vault:snapshot list` to see available names.
- **Invalid snapshot name** (path traversal, special chars) — CLI
  rejects with `Invalid snapshot name` message. Relay it.
- **Not in a git repository** — CLI rejects with `Not a git
  repository`. Run `git init` is the user's call, not yours.

## Rules

- NEVER skip the confirmation step
- NEVER use `--force` or any other flag that would bypass safety
  (the CLI has no `--force` for rollback by design — pre-rollback
  snapshot IS the safety)
- NEVER attempt to interpret user's intent if they don't reply `yes`
  exactly — abort on ambiguity
- If the rollback CLI fails AFTER pre-rollback was created, the
  pre-rollback snapshot remains. Tell the user it's still available
  for their next attempt
