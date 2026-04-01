# /workflow:dev — Multi-agent development cycle

Orchestrates 6 agents in an 8-step cycle: read → plan → plan-review → coder ↔ review (loop) → commit.
Each agent has strict permission boundaries. Context passes between agents as blocks.
Steps 4-6 form an iterative CODER↔REVIEW loop (max 3 iterations).

## Arguments

`/workflow:dev <task>` — task description as text.
`/workflow:dev <path>` — task from file (.md, .txt).

## Permission matrix (violation = ABORT)

```
Agent          Read   Write   Bash           Subagent
─────────────  ─────  ──────  ─────────────  ────────
READ           ✅     ❌      ❌             Explore
PLAN           ✅     ❌      ❌             Explore
PLAN_REVIEW    ✅     ❌      ❌             Explore
CODER          ✅     ✅      ✅ build/test  Full
REVIEW         ✅     ❌      ❌             Explore
COMMIT         ❌     ❌      ✅ git only    Full
```

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

## Output Format
PLAN:
Summary: [what we're doing — 1-2 sentences]
Scope: [small: 1-4 files / large: 5+ files]

Changes:
1. [file] — [what to change]
   - [specific change]

New files:
- [file] — [purpose]

Tests:
- [test file] — [what to test: happy path, edge cases, errors]

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

**Max revisions: 2.** After limit — accept plan with warnings and proceed to Step 4.

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

### Step 5: REVIEW

Launch Explore subagent:

```
You are a code reviewer. Check code quality. NEVER modify code — only report issues.

## Plan
[PLAN block]

## What coder did
[CODE_DONE or CODE_FIX block from current iteration]

## Conventions
[.dev-vault/conventions.md if exists]

## Security guidelines
[.dev-vault/knowledge.md — Security section. If project has separate security.md, use that instead.]

## Review criteria (all mandatory)
1. Plan adherence — everything implemented? Nothing extra?
2. Conventions — naming, error handling, structure per project conventions
3. Security — injection, XSS, hardcoded secrets, missing auth
4. Tests — happy path + edge cases + error cases
5. Quality — duplication, dead code, unused imports
6. Edge cases — null/undefined, empty arrays, concurrent access

## Severity
CRITICAL: bug, vulnerability, data loss → must fix
HIGH: convention violation, missing tests → must fix
MEDIUM: quality improvement → optional
LOW: style, formatting → ignore in cycle

## Output Format
REVIEW:
Verdict: [APPROVED / CHANGES_REQUESTED]
Issues:
- [SEVERITY]: [file]:[line] — [issue + how to fix]
END_REVIEW
```

Display:

```
── REVIEW (iteration [N]) ──
Verdict: ✅ APPROVED / ❌ CHANGES_REQUESTED
[Critical: N, High: N, Medium: N, Low: N]
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

```
⚠️ Review iteration limit (3).

Remaining issues:
[list]

1. Accept and commit
2. Stop without commit
```

### Step 7: COMMIT

Orchestrator forms commit message:

```
[type](scope): [brief from PLAN Summary]

[What was done from PLAN Summary]

Files:
[from CODE_DONE — file list]
```

Stage changes and show to user:

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

### Step 8: Summary

```
═══════════════════════════════
          DEV COMPLETE
═══════════════════════════════

Task: [description]
Scope: [small / large]

Agents:
  ✅ READ          [Explore]  — [N] files
  ✅ PLAN          [Explore]  — [N] files in plan
  ✅ PLAN_REVIEW   [Explore]  — [verdict]
  ✅ CODER         [Full]     — [N] changed, [N] created
  ✅ REVIEW        [Explore]  — APPROVED in [N] iterations
  ✅ COMMIT        [git]      — [hash]

[If deviations:] ⚠️ Convention deviations
[If unresolved:] ⚠️ Known issues

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
| REVIEW | Explore | Write/Bash in response → ABORT |
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
