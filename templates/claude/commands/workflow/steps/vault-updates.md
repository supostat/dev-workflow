# Step 9b: Vault updates (after commit)

Orchestrator writes directly to vault after successful commit.
Use **Edit tool** to append — **never overwrite** existing vault files.

## 1. Daily log

Append to `.dev-vault/daily/<today>.md`:

```
> workflow:dev completed at HH:MM — "<task summary>"
> Commit: <hash> | Files: <N> changed, <N> created | Tests: <N>
> [If review findings:] Gotchas recorded in knowledge.md
```

If file exists — read first, then Edit to append after `---` separator.
If file does not exist — create with Write tool.

## 2. Phase status (phase mode only)

Update frontmatter in phase file:

```yaml
status: done  # was: pending
```

## 3. Task status (if task linked)

Update task file:

```yaml
status: done  # was: in-progress
```

## 4. Gameplan progress (phase mode only)

Check off completed items in `.dev-vault/gameplan.md`:

```markdown
- [x] <completed task>  # was: - [ ]
```

## Phase mode: vault refresh between subtasks

After each subtask complete:
- Re-read `.dev-vault/conventions.md` (may have new patterns from review)
- Re-read `.dev-vault/knowledge.md` (may have new gotchas from review)
- Pass updated vault content to next subtask's CODER and REVIEW agents

## 5. Suggest vault records

If the pipeline produced notable findings, suggest (do not auto-create):

- **Architecture decision made** (e.g., chose pattern, changed layer structure) → suggest `/vault:adr`
- **Non-trivial bug fixed** (root cause worth remembering) → suggest `/vault:bug`
- **Work deferred** (known issue left for later) → suggest `/vault:debt`

Display:

```
Suggest vault records:
  → /vault:adr — "<decision title>"
  → /vault:bug — "<bug title>"
  → /vault:debt — "<deferred work>"
```

Only suggest if there are actual findings. Do not suggest if pipeline was clean.
