# Step 7: TEST (mandatory gate)

Orchestrator runs build and test commands directly (no subagent):

```bash
npm run build    # or cargo build, go build — must pass
npm run lint     # if configured — must pass
npm test         # must pass
```

Detect test command from `.dev-vault/stack.md` or `package.json` / `Cargo.toml` / `Makefile`.

**Compare against BASELINE from Step 0:** if a test was already failing before pipeline started, it is NOT a new failure. Only count failures that are NOT in BASELINE as coder's responsibility.

**If any command fails:**

```
── TEST ──
FAIL: [command]
[error output — last 50 lines]
Sending to CODER for fix...
```

Pass error output to CODER as a fix iteration (same as REVIEW CHANGES_REQUESTED).
After CODER fix → re-run TEST. **Max 3 TEST iterations.**

After limit:
- **Interactive:** show error, ask user whether to commit anyway or stop
- **Autonomous:** stop without commit. Failing tests = no commit.

**If all pass:**

```
── TEST ──
Build: passed
Lint: passed (or skipped)
Tests: passed (N tests)
```
