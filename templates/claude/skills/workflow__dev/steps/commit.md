# Step 9: COMMIT

Orchestrator forms commit message:

```
[type](scope): [brief from PLAN Summary]

[What was done from PLAN Summary]

Files:
[from CODE_DONE — file list]
```

Stage changes and show diff.

**Interactive mode (default)** — display as plain markdown (NOT in a code fence). The commit message itself goes in a code fence as it's a literal string; the surrounding layout is markdown:

## COMMIT

**Message:**
```
[commit message here]
```

**Staged:**
```
[abbreviated diff]
```

Commit? (yes / no / edit message)

- **yes** → `git add` relevant files, `git commit`
- **no** → cancel, changes remain staged
- **edit** → user edits, then commit

**Autonomous mode (--auto-commit)** — display as plain markdown (NOT in a code fence):

## COMMIT (auto)

**Message:**
```
[commit message]
```

- **Staged:** [abbreviated diff]
- **Auto-committed:** `[hash]`

`git add` relevant files, `git commit` immediately. No user prompt.

**Autonomous safety — will NOT auto-commit if any of these occurred:**
- TEST failed and fix limit reached
- VERIFY incomplete and fix limit reached
- Any unresolved CRITICAL review issue

In these cases the pipeline already stopped at the failing gate.

**Rollback on pipeline stop (all stop points):**
- **Interactive:** ask: keep changes / stash / discard (`git restore .`)
- **Autonomous:** always stash (`git stash push -m "workflow:dev — stopped at [step]"`)

## Shell quoting for `git commit`

When the commit message contains backticks, dollar-signs, or other shell-special characters (typical for code references like `` `myFunction` `` or `` `path/to/file.ts` ``), **never** use `git commit -m "..."` — double quotes evaluate command substitution and parameter expansion, which silently corrupts the message body.

Always use a quoted-EOF heredoc piped via `-F -`:

```bash
git commit -F - <<'EOF'
title: short subject

Body with `inline code refs` and $VARIABLES preserved verbatim.
Backticks won't trigger command substitution because EOF is quoted.
EOF
```

`<<'EOF'` (single-quoted delimiter) disables all expansions: command substitution, variable expansion, backslash escapes. Bytes pass through unchanged.

Use `-m "..."` only for plain-text single-line subjects with no code fragments.
