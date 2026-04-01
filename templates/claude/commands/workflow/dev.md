# /workflow:dev — Multi-agent development cycle

Orchestrates agents in a 10-step quality pipeline:
read → plan (with pseudo-code) → plan-review → coder ↔ review×3 (loop) → test → verify → commit.
Each agent has strict permission boundaries. Context passes between agents as blocks.
Steps 4-6 form an iterative CODER↔REVIEW loop (max 3 iterations).

## Arguments

`/workflow:dev <task>` — interactive mode (default, asks before commit).
`/workflow:dev <path>` — task from file (.md, .txt).
`/workflow:dev <task> --auto-commit` — autonomous mode (commits automatically, for swarm use).

### Commit mode

| Mode | Flag | Commit | Gates on limit |
|------|------|--------|---------------|
| **Interactive** (default) | — | Ask user | Ask user |
| **Autonomous** | `--auto-commit` | Auto-commit | Stop without commit |

**Autonomous safety:** will NOT commit if any quality gate exhausts its retry limit.
Better to leave changes uncommitted than commit broken code.

## Mode detection

If argument is a file path, read the file and detect mode:

- **Single task** (no `## Tasks` section or only 1 task) → **Normal mode** (Steps 1-8 below)
- **Phase file** (has `## Tasks` with 2+ items, or has `phase:` in frontmatter) → **Phase mode**

### Phase mode

Phase mode plans the entire phase, then codes each subtask separately for focused quality.

```
READ (full phase) → PLAN (full phase, outputs subtasks) → PLAN_REVIEW
→ for each subtask:
    CODER(subtask) → REVIEW×3(subtask) → fix loop → TEST (all tests)
→ VERIFY (full phase against spec)
→ COMMIT (all changes, one commit)
→ Summary
```

**Step 2 (PLAN) in phase mode** — add to agent prompt:

```
You are planning a PHASE with multiple subtasks.
Break this into ordered implementation steps.
Each step must be completable in one CODER iteration.

Output format:
PLAN:
Summary: [phase goal]
Scope: large

Subtasks:
1. [name]
   Files: [list]
   Tests: [list]
   Depends on: [previous subtask number or "none"]

2. [name]
   Files: [list]
   Tests: [list]
   Depends on: 1

...
END_PLAN
```

**Steps 4-6 in phase mode** — loop over subtasks:

```
for each subtask in PLAN.Subtasks:
  display: ── SUBTASK [N/total]: [name] ──
  
  CODER receives:
  - Current subtask from PLAN
  - Accumulated context from previous subtasks (CODE_DONE blocks)
  - Vault context
  
  REVIEW×3 receives (parallel):
  - Current subtask from PLAN
  - CODE_DONE for this subtask
  - Vault context
  
  fix loop (max 3 iterations per subtask)
  
  TEST after each subtask:
  - Run ALL tests (not just new ones) — catches regressions
  - If fail → CODER fix → re-test
```

**Step 7 (COMMIT) in phase mode** — one commit for the entire phase:

```
feat(<scope>): implement Phase N — <phase name>

<summary of all subtasks completed>

Subtasks:
- <subtask 1>: <files>
- <subtask 2>: <files>
...
```

**Step 8 (Summary) in phase mode** — show subtask breakdown:

```
═══════════════════════════════
    PHASE [N] COMPLETE
═══════════════════════════════

Phase: [name]
Subtasks: [completed]/[total]

  ✅ 1. [subtask name] — [N] files
  ✅ 2. [subtask name] — [N] files
  ...

Agents:
  ✅ READ          [Explore]  — [N] files
  ✅ PLAN          [Explore]  — [N] subtasks
  ✅ PLAN_REVIEW   [Explore]  — APPROVED
  ✅ CODER         [Full]     — [total] changed, [total] created
  ✅ REVIEW        [Explore]  — [total iterations] across subtasks
  ✅ COMMIT        [git]      — [hash]

═══════════════════════════════
```

## Normal mode

Steps below describe normal mode (single task). Phase mode follows the same agents and permission matrix but with the subtask loop described above.

## Permission matrix (violation = ABORT)

```
Agent          Read   Write   Bash              Subagent
─────────────  ─────  ──────  ────────────────  ────────
READ           ✅     ❌      ❌                Explore
PLAN           ✅     ❌      ❌                Explore
PLAN_REVIEW    ✅     ❌      ❌                Explore
CODER          ✅     ✅      ✅ build/test     Full
REVIEW×3       ✅     ❌      ❌                Explore
TEST           ❌     ❌      ✅ build/test     Orchestrator (bash)
VERIFY         ✅     ❌      ❌                Explore
COMMIT         ❌     ❌      ✅ git only       Full
```

TEST is not a subagent — orchestrator runs bash commands directly.

These rules are law. The orchestrator MUST launch each agent with the correct subagent type.

## Procedure

### Step 1: READ

Read vault context files (if they exist):
- `.dev-vault/stack.md`
- `.dev-vault/conventions.md`
- `.dev-vault/knowledge.md`
- `.dev-vault/gameplan.md`

Launch Explore subagent:

```
You are a reader agent. Gather context for the task below.

## Task
[task from user]

## Project Context
[vault sections read above]

## Procedure
1. Read CLAUDE.md for project instructions
2. Find files relevant to the task (Glob/Grep)
3. Read relevant files (max 10 files, 500 lines each)
4. Find dependencies and tests for those files
5. Find how similar things are done in the project

## Output Format
CONTEXT:
Task: [reformulated task with project context]
Files to change: [file list with what to change]
Dependencies: [files depending on changes]
Tests: [existing tests for those files]
Patterns found: [how similar things are solved]
Relevant code: [key fragments]
END_CONTEXT
```

Save CONTEXT block. Display:

```
── READ ──
Files to change: [N]
Dependencies: [N]
Tests: [N]
```

### Step 2: PLAN

Launch Explore subagent:

```
You are a planner agent. Create a detailed implementation plan.

## Task
[task from user]

## Context (from READ)
[CONTEXT block from Step 1]

## Project Conventions
[.dev-vault/conventions.md or "Not defined"]

## Architecture
[.dev-vault/knowledge.md — Architecture section, or "Not defined"]

## Stack
[.dev-vault/stack.md or "Not defined"]

## Gameplan
[.dev-vault/gameplan.md — current phase, or "Not defined"]

## Rules
- STRICTLY follow project conventions (naming, structure, error handling)
- Each change tied to a specific file and location
- New files placed according to architecture
- Deviation from conventions — mark as DEVIATION with justification
- Include PSEUDO-CODE for each change — concrete enough for CODER to implement without guessing
- When adding dependencies: use context7 MCP (resolve-library-id → query-docs) to get current stable version. Specify exact version, not range

## Output Format
PLAN:
Summary: [what we're doing — 1-2 sentences]
Scope: [small: 1-4 files / large: 5+ files]

Changes:
1. [file] — [what to change]
   ```[language]
   // after [anchor: function/line/class]
   [pseudo-code or signature sketch]
   ```

2. [file] — [what to change]
   ```[language]
   // modify [function/block]
   [pseudo-code showing the change]
   ```

New files:
- [file] — [purpose]
  ```[language]
  [structure sketch: exports, key functions, types]
  ```

Tests:
- [test file] — [what to test]
  - happy path: [scenario]
  - edge case: [scenario]
  - error: [scenario]

Order:
1. [file] — [why first]
2. [file] — [depends on previous]

Deviations:
- [deviation + justification, or "None"]
END_PLAN
```

Save PLAN block. Display:

```
── PLAN ──
[Summary]
Files: [N] change, [N] create, [N] tests
Scope: [small / large]
```

### Step 3: PLAN_REVIEW

Launch Explore subagent:

```
You are a plan reviewer. Check the plan for completeness, correctness, and risks.

## Plan
[PLAN block from Step 2]

## Context
[CONTEXT block from Step 1]

## Conventions
[.dev-vault/conventions.md if exists]

## Check criteria
1. Completeness — all files accounted for? Missing dependencies?
2. Conventions — matches project conventions?
3. Order — correct sequence of changes?
4. Tests — cover the changes?
5. Deviations — justified?
6. Risks — what could break? Edge cases?

## Output Format
PLAN_REVIEW:
Verdict: [APPROVED / NEEDS_REVISION]
Issues:
- [issue + how to fix]
Missing:
- [what's missing]
Risks:
- [potential risk]
END_PLAN_REVIEW
```

**Result:**

- APPROVED → Step 4
- NEEDS_REVISION → pass remarks to PLAN agent, re-run Step 2 with remarks.

**Max revisions: 2.** After limit:
- **Interactive:** show warnings, ask user whether to proceed
- **Autonomous:** accept plan with warnings, proceed to Step 4

Display:

```
── PLAN_REVIEW ──
Verdict: ✅ APPROVED / ⚠️ NEEDS_REVISION
```

### Step 4: CODER

Launch Full subagent:

```
You are a coder agent. The ONLY agent allowed to modify files.

## Plan
[PLAN block (final)]

## Context
[CONTEXT block from Step 1]

## Conventions
[.dev-vault/conventions.md or "Follow existing code conventions"]

## Stack
[.dev-vault/stack.md — summary]

## Rules
- Follow the plan. No changes outside the plan. Scope creep FORBIDDEN.
- Follow project conventions: naming, error handling, file structure.
- If plan has DEVIATION — implement as described.
- Write tests from the Tests section of the plan.
- git commit/push FORBIDDEN.
- git checkout/reset/rebase FORBIDDEN.
- Allowed bash: build, test, lint commands only.

## Output Format
CODE_DONE:
Files changed:
- [file] — [what was done]
Files created:
- [file] — [purpose]
Tests written:
- [file] — [what it covers]
Notes:
- [notes if any]
END_CODE_DONE
```

Save CODE_DONE block. Display:

```
── CODER (iteration 1) ──
Changed: [N], Created: [N], Tests: [N]
```

### Step 5: REVIEW (3 specialized reviewers in parallel)

Launch **3 Explore subagents in parallel** (one Agent call with 3 tool uses):

**REVIEW:security** — Explore subagent:

```
You are a SECURITY reviewer. NEVER modify code — only report issues.
Focus EXCLUSIVELY on security. Ignore style, naming, structure.

## What coder did
[CODE_DONE or CODE_FIX block]

## Security guidelines
[.dev-vault/knowledge.md — Security section, or OWASP Top 10 defaults]

## Check (security ONLY)
- Injection (SQL, command, path traversal)
- XSS (unescaped user input)
- Hardcoded secrets, API keys, credentials
- Missing authentication/authorization
- Insecure deserialization
- Missing input validation at system boundaries
- Timing attacks, race conditions

## Severity
CRITICAL: vulnerability, data loss
HIGH: missing auth, missing validation on boundary
MEDIUM: defense-in-depth improvement
LOW: theoretical risk

## Output Format
REVIEW_SECURITY:
Verdict: [PASS / FAIL]
Issues:
- [SEVERITY]: [file]:[line] — [issue + fix]
END_REVIEW_SECURITY
```

**REVIEW:quality** — Explore subagent:

```
You are a QUALITY reviewer. NEVER modify code — only report issues.
Focus EXCLUSIVELY on code quality and conventions. Ignore security.

## Plan
[PLAN block]

## What coder did
[CODE_DONE or CODE_FIX block]

## Conventions
[.dev-vault/conventions.md if exists]

## Check (quality ONLY)
- Plan adherence — everything implemented? Nothing extra?
- Conventions — naming, error handling, structure per project
- Duplication — DRY violations
- Complexity — unnecessary abstractions, over-engineering
- Dead code — unused imports, unreachable branches
- Edge cases — null/undefined, empty arrays, boundary values

## Severity
CRITICAL: logic bug, data loss
HIGH: convention violation, plan deviation
MEDIUM: quality improvement
LOW: style nit

## Output Format
REVIEW_QUALITY:
Verdict: [PASS / FAIL]
Issues:
- [SEVERITY]: [file]:[line] — [issue + fix]
END_REVIEW_QUALITY
```

**REVIEW:coverage** — Explore subagent:

```
You are a TEST COVERAGE reviewer. NEVER modify code — only report issues.
Focus EXCLUSIVELY on test adequacy. Ignore security and style.

## Plan
[PLAN block — Tests section]

## What coder did
[CODE_DONE or CODE_FIX block]

## Check (coverage ONLY)
- All planned tests written?
- Happy path covered?
- Edge cases covered? (empty input, boundary values, null)
- Error paths covered? (network failure, invalid input, permissions)
- Assertions meaningful? (not just "no throw")
- Test isolation? (no shared state between tests)

## Severity
CRITICAL: core logic untested
HIGH: missing edge case test for public API
MEDIUM: missing error path test
LOW: test could be more descriptive

## Output Format
REVIEW_COVERAGE:
Verdict: [PASS / FAIL]
Issues:
- [SEVERITY]: [file]:[line] — [issue + fix]
END_REVIEW_COVERAGE
```

**Aggregate results:**

Merge all 3 REVIEW blocks into one verdict:
- Any CRITICAL or HIGH from ANY reviewer → **CHANGES_REQUESTED**
- All PASS with only MEDIUM/LOW → **APPROVED**

Display:

```
── REVIEW (iteration [N]) ──
  Security: ✅ PASS / ❌ FAIL [Critical: N, High: N]
  Quality:  ✅ PASS / ❌ FAIL [Critical: N, High: N]
  Coverage: ✅ PASS / ❌ FAIL [Critical: N, High: N]
Verdict: ✅ APPROVED / ❌ CHANGES_REQUESTED
```

### Step 6: CODER↔REVIEW loop

**APPROVED** → Step 7.

**CHANGES_REQUESTED** → launch CODER in fix mode (Full subagent):

```
You are a coder agent in FIX mode. Fix review issues.

## Plan
[PLAN block]

## Review issues
[REVIEW block with Issues]

## Conventions
[.dev-vault/conventions.md]

## Rules
- CRITICAL and HIGH — fix required.
- MEDIUM — fix if simple. If complex — explain in Skipped.
- LOW — ignore.
- Do NOT touch code outside review issues.

## Output Format
CODE_FIX:
Fixed:
- [file]:[line] — [fix] — addresses [issue]
Skipped:
- [issue] — [reason]
END_CODE_FIX
```

Then re-run REVIEW (Step 5).

**Limit: 3 iterations.**

After limit:

**Interactive:**
```
⚠️ Review iteration limit (3).

Remaining issues:
[list]

1. Accept and commit
2. Stop without commit
```

**Autonomous:** stop without commit. Report failure to orchestrator.
```
🛑 STOPPED: review limit reached with unresolved CRITICAL/HIGH issues.
Changes left uncommitted.
```

### Step 7: TEST (mandatory gate)

Orchestrator runs build and test commands directly (no subagent):

```bash
npm run build    # or cargo build, go build — must pass
npm run lint     # if configured — must pass
npm test         # must pass
```

Detect test command from `.dev-vault/stack.md` or `package.json` / `Cargo.toml` / `Makefile`.

**If any command fails:**

```
── TEST ──
❌ FAIL: [command]

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
✅ Build: passed
✅ Lint: passed (or skipped)
✅ Tests: passed (N tests)
```

### Step 8: VERIFY (task compliance check)

Launch Explore subagent:

```
You are a verification agent. Check if the implementation matches the ORIGINAL TASK.
Do NOT check code quality or security — that was already done.
Check ONLY: does the code do what was asked?

## Original task
[task from user — the ORIGINAL request, not the plan]

## Plan
[PLAN block]

## What was implemented
[final CODE_DONE or CODE_FIX block]

## Check
- Every requirement from the original task addressed?
- Any requirement missed or partially implemented?
- Any drift from the task? (implemented something not asked for)
- Acceptance criteria met? (if task specifies them)

## Output Format
VERIFY:
Verdict: [COMPLETE / INCOMPLETE]
Addressed:
- [requirement] — ✅ implemented
Missing:
- [requirement not implemented — how to fix]
Drift:
- [implementation not in original task — flag for user]
END_VERIFY
```

**COMPLETE** → Step 9.

**INCOMPLETE** → pass missing items to CODER. **Max 2 iterations.** After limit:
- **Interactive:** show gaps, ask user whether to commit partial or stop
- **Autonomous:** stop without commit. Incomplete implementation = no commit.

Display:

```
── VERIFY ──
Verdict: ✅ COMPLETE / ⚠️ INCOMPLETE
[If incomplete:] Missing: [N] requirements
```

### Step 9: COMMIT

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

**"yes"** → `git add` relevant files, `git commit`
**"no"** → cancel, changes remain staged
**"edit"** → user edits, then commit

**Autonomous mode (--auto-commit):**

```
── COMMIT (auto) ──

[commit message]

Staged:
[abbreviated diff]

✅ Auto-committed: [hash]
```

`git add` relevant files, `git commit` immediately. No user prompt.

**Autonomous safety — will NOT auto-commit if any of these occurred:**
- TEST failed and fix limit reached
- VERIFY incomplete and fix limit reached
- Any unresolved CRITICAL review issue

In these cases the pipeline already stopped at the failing gate.

### Step 10: Summary

```
═══════════════════════════════
          DEV COMPLETE
═══════════════════════════════

Task: [description]
Mode: [interactive / autonomous]
Scope: [small / large]

Agents:
  ✅ READ           [Explore]      — [N] files
  ✅ PLAN           [Explore]      — [N] files, pseudo-code
  ✅ PLAN_REVIEW    [Explore]      — [verdict]
  ✅ CODER          [Full]         — [N] changed, [N] created
  ✅ REVIEW:security [Explore]     — [verdict]
  ✅ REVIEW:quality  [Explore]     — [verdict]
  ✅ REVIEW:coverage [Explore]     — [verdict]
  ✅ TEST           [bash]         — [N] tests passed
  ✅ VERIFY         [Explore]      — [verdict]
  ✅ COMMIT         [git]          — [hash]

[If deviations:] ⚠️ Convention deviations
[If unresolved:] ⚠️ Known issues
[If verify incomplete:] ⚠️ Missing requirements

═══════════════════════════════
```

## Enforcement

Before launching each subagent — verify type:

| Agent | Subagent type | On violation |
|-------|--------------|--------------|
| READ | Explore | Write/Bash in response → ABORT |
| PLAN | Explore | Write/Bash in response → ABORT |
| PLAN_REVIEW | Explore | Write/Bash in response → ABORT |
| CODER | Full | git commit/push in response → ABORT |
| REVIEW×3 | Explore | Write/Bash in response → ABORT |
| TEST | Orchestrator bash | N/A — orchestrator runs directly |
| VERIFY | Explore | Write/Bash in response → ABORT |
| COMMIT | Full | Read/Write/non-git bash → ABORT |

```
🚨 PERMISSION VIOLATION: [agent] attempted [action].
Allowed: [permissions].
Process stopped.
```

## Rules

- Orchestrator reads vault files ONCE (Step 1), passes CONTENT (not paths) to agents
- Placeholders like `[.dev-vault/conventions.md]` mean "insert file content here"
- Context passes as arguments (CONTEXT, PLAN, CODE_DONE, REVIEW blocks)
- Agent response blocks (CONTEXT, PLAN, CODE_DONE, REVIEW, PLAN_REVIEW) have mandatory format
- No intermediate files — everything in orchestrator context
- Permission matrix is law. Explore agents ONLY read
- CODER is the only one who touches files
- REVIEWER never fixes code — only reports issues
- COMMIT — git add + git diff + git commit, nothing else
