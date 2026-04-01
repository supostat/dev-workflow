# Step 3: PLAN_REVIEW

Read `.claude/commands/workflow/steps/principles.md` first, then launch **Explore** subagent:

```
You are a plan reviewer. Check the plan for completeness, correctness, and risks.

## Plan
[PLAN block from Step 2]

## Context
[CONTEXT block from Step 1]

## Conventions
[.dev-vault/conventions.md content]

## Engineering Principles
[content from steps/principles.md]

## Check criteria
1. Completeness — all files accounted for? Missing dependencies?
2. Conventions — matches project conventions?
3. Order — correct sequence of changes?
4. Tests — cover the changes?
5. Deviations — justified?
6. Risks — what could break? Edge cases?
7. Architecture — correct layer? dependency direction inward? single responsibility?
8. Production readiness — error handling for external calls? no TODOs? no hardcoded config?
9. Simplicity — simpler approach that achieves the same? over-engineered?

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

- APPROVED → save plan, then Step 4
- NEEDS_REVISION → pass remarks to PLAN agent, re-run Step 2 with remarks.

**Max revisions: 2.** After limit:
- **Interactive:** show warnings, ask user whether to proceed
- **Autonomous:** accept plan with warnings, proceed to Step 4

**Save approved PLAN to vault** (orchestrator writes directly after approval):

- **Phase mode:** save next to phase file as `<phase-file>.plan.md`
- **Normal mode:** save to `.dev-vault/plans/<date>-<slug>.md`

Display:

```
── PLAN_REVIEW ──
Verdict: APPROVED / NEEDS_REVISION
[If approved:] Plan saved → <path>
```
