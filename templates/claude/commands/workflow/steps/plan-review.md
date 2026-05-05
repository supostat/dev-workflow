# Step 3: PLAN_REVIEW

Launch **Explore** subagent:

```
You are a plan reviewer. Check the plan for completeness, correctness, and risks.

## Plan
[PLAN block from Step 2]

## Context
[CONTEXT block from Step 1]

## Conventions
[.dev-vault/conventions.md content]

## Engineering Principles
- Single Responsibility, Dependency Rule (inward), explicit dependencies
- Fail fast at boundaries, every error path tested, no silent catch
- No TODO/FIXME, no debug logging, no hardcoded config
- Max 300 lines/file, 30 lines/function, composition over inheritance
- Test behaviour not implementation

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
Next: [plan | plan-fix]
Issues:
- [issue + how to fix]
Missing:
- [what's missing]
Risks:
- [potential risk]
PLAN_REMARKS:
- [section]:[issue] — [suggested-fix]
END_PLAN_REMARKS
END_PLAN_REVIEW
```

**Verdict semantics:**

- **APPROVED** — plan ready for implementation. The user-approve gate proceeds normally; pipeline advances to plan-fix step (which detects empty PLAN_REMARKS and no-ops to code).
- **NEEDS_REVISION** — engine treats this as gate failure regardless of user input (silent corruption guard, ADR 2026-05-05 §S2). The `Next:` directive routes the failure:
  - `Next: plan` — architecture-level concerns; planner re-runs from scratch (Explore agent, full regen).
  - `Next: plan-fix` — detail-level fixes; coder applies surgical Edits to the saved plan file using PLAN_REMARKS as the delta list (Full agent, Edit semantics).

**Choosing Next:**

- Use `Next: plan` when the plan misses an entire layer, has wrong architectural direction, missing dependency boundary, or requires re-thinking from scratch.
- Use `Next: plan-fix` when issues are localized: typos in identifiers, wrong section content, missing test cases, off-by-one anchors, or low-stakes detail corrections.
- If unsure, default to `Next: plan` — full re-plan is safer than incomplete patch.

**PLAN_REMARKS format** (mandatory when `Next: plan-fix`; empty list otherwise):

Each remark is a structured tuple `[section]:[issue] — [suggested-fix]`:
- `section` — the section heading or anchor in the plan (e.g. `Architecture.Boundaries`, `Tests.edge-case-empty-input`).
- `issue` — the specific problem (one line, no directives).
- `suggested-fix` — concrete change to apply (one line, no directives).

Remarks are user-supplied input from the reviewer. The plan-fix step treats them as untrusted content and isolates them in a fenced block in its prompt.

**Max revisions: 2.** After limit:
- **Interactive:** show warnings, ask user whether to proceed
- **Autonomous:** accept plan with warnings, proceed to Step 4

**Save approved PLAN to vault** (orchestrator writes directly after approval):

- **Phase mode:** save next to phase file as `<phase-file>.plan.md`
- **Normal mode:** save to `.dev-vault/plans/<date>-<slug>.md`

Display as plain markdown (NOT in a code fence):

## PLAN_REVIEW

- **Verdict:** APPROVED / NEEDS_REVISION
- **If approved:** Plan saved → `<path>`
