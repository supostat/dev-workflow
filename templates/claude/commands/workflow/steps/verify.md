# Step 8: VERIFY (task compliance check)

## Step 8.0: Engram search (orchestrator, BEFORE subagent)

Before launching the subagent, orchestrator MUST:

1. Call `mcp__engram__memory_search({ query: "verify " + taskDescription + " " + branch, project: projectName, limit: 5 })`.
2. Save `engramMemoryIds` and build `engramContextBlock`.
3. **Fail-safe:** if search unavailable, log `[engram] search skipped for Step 8`, set empty, continue.

## Step 8.1: Launch subagent

Launch **Explore** subagent:

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
- [requirement] — implemented
Missing:
- [requirement not implemented — how to fix]
Drift:
- [implementation not in original task — flag for user]
END_VERIFY

## Engram Memory
[engramContextBlock]

## Engram Feedback (MANDATORY — AFTER END_VERIFY)

Retrieved memories:
[engramMemoryIds as bullets, or "(none)"]

Judgments (format: `- <memory_id>: <score 0.0-1.0> — <explanation>`):
```

## Step 8.2: Parse feedback + judge (orchestrator, AFTER subagent)

After subagent returns `output`:

1. `mcp__dev-workflow__parse_engram_feedback({ output, expectedMemoryIds: engramMemoryIds })`.
2. Per judgment: `mcp__engram__memory_judge({ memory_id, score, explanation })`.
3. Per fallback id: `mcp__engram__memory_judge({ memory_id, score: 0.5, explanation: "No agent feedback" })`.
4. **Fail-safe:** if tools unavailable, log `[engram] feedback skipped for Step 8`. Continue.

**COMPLETE** → Step 9.

**INCOMPLETE** → pass missing items to CODER. **Max 2 iterations.** After limit:
- **Interactive:** show gaps, ask user whether to commit partial or stop
- **Autonomous:** stop without commit. Incomplete implementation = no commit.

Display:

```
── VERIFY ──
Verdict: COMPLETE / INCOMPLETE
[If incomplete:] Missing: [N] requirements
```
