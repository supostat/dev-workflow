# Step 8: VERIFY (task compliance check)

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
```

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
