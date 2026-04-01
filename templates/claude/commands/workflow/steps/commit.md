# Step 9: COMMIT

Orchestrator forms commit message:

```
[type](scope): [brief from PLAN Summary]

[What was done from PLAN Summary]

Files:
[from CODE_DONE — file list]
```

Stage changes and show diff.

**Interactive mode (default):**

```
── COMMIT ──
[commit message]

Staged:
[abbreviated diff]

Commit? (yes / no / edit message)
```

- **yes** → `git add` relevant files, `git commit`
- **no** → cancel, changes remain staged
- **edit** → user edits, then commit

**Autonomous mode (--auto-commit):**

```
── COMMIT (auto) ──
[commit message]
Staged: [abbreviated diff]
Auto-committed: [hash]
```

`git add` relevant files, `git commit` immediately. No user prompt.

**Autonomous safety — will NOT auto-commit if any of these occurred:**
- TEST failed and fix limit reached
- VERIFY incomplete and fix limit reached
- Any unresolved CRITICAL review issue

In these cases the pipeline already stopped at the failing gate.

**Rollback on pipeline stop (all stop points):**
- **Interactive:** ask: keep changes / stash / discard (`git restore .`)
- **Autonomous:** always stash (`git stash push -m "workflow:dev — stopped at [step]"`)
