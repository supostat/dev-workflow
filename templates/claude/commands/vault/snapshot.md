# /vault:snapshot — Create, list, or inspect vault snapshots

Point-in-time copy of `.dev-vault/` for recovery purposes. Thin slash
wrapper around `dev-workflow snapshot` CLI commands.

## Subcommands

| Slash | Underlying CLI |
|-------|----------------|
| `/vault:snapshot` | `dev-workflow snapshot list` (no args = list) |
| `/vault:snapshot create [name]` | `dev-workflow snapshot create [name]` |
| `/vault:snapshot list` | `dev-workflow snapshot list` |
| `/vault:snapshot show <name>` | `dev-workflow snapshot show <name>` |
| `/vault:snapshot delete <name>` | `dev-workflow snapshot delete <name> --force` (slash always passes --force after user confirmation) |

For rollback (separate slash because of destructive semantics):
`/vault:rollback <name>`

## Procedure

1. Parse the user's arguments. First token after the slash is the
   subcommand. Default to `list` when no argument is given.
2. **For `create`**: if no name provided, generate one (CLI default
   `snap-<ISO>` is fine — let CLI handle it).
3. **For `delete`**: ALWAYS show the snapshot manifest first via
   `dev-workflow snapshot show <name>` so the user sees what's being
   removed. Then ask for confirmation. Only on explicit yes invoke
   `dev-workflow snapshot delete <name> --force`. Never auto-delete.
4. Invoke the CLI via Bash tool. Capture stdout + stderr + exit code.
5. **Display output** as plain markdown (NOT in a code fence).

## Output format

### create

📸 **Snapshot created**

- **Name:** `<name>`
- **Files:** N
- **Size:** <human-readable>
- **Path:** `<absolute path>`

Run `/vault:rollback <name>` to restore.

### list

📋 **Vault snapshots** (N total, newest first)

| Name | Created | Branch | Files | Size |
|------|---------|--------|-------|------|
| `<name>` | YYYY-MM-DD HH:MMZ | main | N | <size> |
| ... |

No snapshots? Suggest: `/vault:snapshot create [name]`.

### show

🔎 **Snapshot:** `<name>`

```json
<manifest JSON>
```

### delete

⚠️ **Snapshot deletion**

About to delete:

- **Name:** `<name>`
- **Files:** N
- **Size:** <size>
- **Created:** YYYY-MM-DD HH:MMZ

Confirm? Reply `yes` or `no`. (Slash will pass `--force` to CLI on
confirmation.)

## Rules

- NEVER auto-confirm `delete` — always ask user even when --force is
  in the args
- NEVER attempt rollback from this slash — direct user to
  `/vault:rollback <name>` (separate slash with destructive UX)
- If CLI exits non-zero, surface the stderr message verbatim to the
  user and STOP — do not retry or guess
- Snapshot names must match `/^[a-z0-9][a-z0-9._-]{0,79}$/i` — if
  user provides something invalid, surface the CLI's error message
- `.dev-vault/snapshots/` is gitignored along with the rest of vault;
  snapshots are local-only by design
