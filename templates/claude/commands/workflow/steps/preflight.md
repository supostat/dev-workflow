# Step 0: PREFLIGHT

Orchestrator runs directly (no subagent).

## Phase mode: auto-create tasks

If argument is a phase file:
1. Read `## Tasks` section from phase file
2. Check `.dev-vault/tasks/` for matching tasks (by title substring match)
3. If tasks are missing — create them via `dev-workflow task create "<title>"` for each task in the phase
4. Display created tasks

## Baseline check

```bash
git status -s                # check for uncommitted changes
npm run build 2>&1 || true   # baseline build (or cargo build, go build)
npm test 2>&1 || true        # baseline tests
```

Save results as BASELINE block:

```
BASELINE:
Git: [clean / N uncommitted files]
Build: [pass / fail]
Tests: [N passed, M failed / no test command]
Lint: [pass / N warnings / no lint command]
END_BASELINE
```

Display:

```
── PREFLIGHT ──
Git: clean / N uncommitted files
Build: pass / fail (baseline)
Tests: N passed / M already failing
```

**If uncommitted changes:**
- **Interactive:** ask: stash / continue / abort
- **Autonomous:** continue (don't touch existing work)

**If tests already failing:** record failing test names in BASELINE. TEST step (Step 7) will compare against this — only NEW failures are coder's responsibility.
