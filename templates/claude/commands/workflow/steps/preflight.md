# Step 0: PREFLIGHT

Orchestrator runs directly (no subagent).

## Phase mode: auto-create tasks

If argument is a phase file, call MCP tool `task_create_from_phase`:

```
task_create_from_phase(phaseFile: "<path to phase file>")
```

This parses `## Tasks` from the phase file and creates missing tasks automatically.
Returns: `{ created: [...], skipped: [...] }`.

Display the result before proceeding.

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
