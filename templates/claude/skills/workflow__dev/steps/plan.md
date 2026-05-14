# Step 2: PLAN

## Step 2.0: Engram search (orchestrator, BEFORE subagent)

Before launching the subagent, orchestrator MUST:

1. Call `mcp__dev-workflow__step_start({ stepName: "plan", runId })` — updates run state to current step (accurate engram step tags).
2. Call `mcp__dev-workflow__memory_search({ query: "plan " + taskDescription + " " + branch, project: projectName, limit: 5 })`.
3. Save `engramMemories = results.map(m => ({ id: m.id, memoryType: m.memory_type }))` — enriched objects (id + memoryType) required by `step_complete` in Step 2.2. Build `engramContextBlock` (bullet list `- [<type>] <context> — <action>`, or `"(none)"`).
4. Note any `antipattern` records — the planner MUST address them explicitly.
5. **Fail-safe:** if `mcp__dev-workflow__memory_search` unavailable, log `[engram] search skipped for Step 2` to stderr, set `engramMemories = []` and `engramContextBlock = "(engram unavailable)"`. Continue.

## Step 2.1: Launch subagent

Dispatch a general-purpose subagent with the planner agent prompt (permission class: Explore):

```
You are a planner agent. Create a detailed implementation plan.

## Task
[task from user]

## Context (from READ)
[CONTEXT block from Step 1]

## Project Conventions
[.dev-vault/conventions.md content]

## Architecture
[.dev-vault/knowledge.md — Architecture section]

## Stack
[.dev-vault/stack.md content]

## Gameplan
[.dev-vault/gameplan.md — current phase]

## Engineering Principles
- Single Responsibility: one module/file = one reason to change
- Dependency Rule: inner layers never import from outer layers
- Explicit dependencies: constructor injection, no hidden globals
- Boundaries: validate at entry points, trust internal code
- Fail fast at boundaries, every error path tested, no silent catch
- External calls: always error handling + timeouts
- No TODO/FIXME, no debug logging, no hardcoded config
- Max 300 lines/file, 30 lines/function
- Composition over inheritance, no god objects
- Test behaviour not implementation, cover happy+edge+error paths

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

Architecture:
  Layer: [domain / infrastructure / presentation / API]
  Boundaries: [where this change sits, what calls it, what it calls]
  Dependencies: [new dependencies with direction →, justify each]
  Error boundaries: [external calls, user input, invariants]

Changes:
1. [file] — [what to change]
   ```[language]
   // after [anchor: function/line/class]
   [pseudo-code or signature sketch]
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

## Engram Memory
[engramContextBlock — memories retrieved before this step]

## Engram Feedback (MANDATORY — at end of output, after END_PLAN)

For each retrieved memory below, judge how useful it was for planning.
Format (one memory per line, single-line explanation):

`- <memory_id>: <score 0.0-1.0> — <brief explanation>`

Score scale: 0.8-1.0 applied, 0.5-0.7 relevant, 0.2-0.4 marginal, 0.0-0.1 not useful.

If no memories were retrieved (Retrieved memories list is empty or `(none)`), emit `(no memories retrieved for query N)` on its own line under Judgments. Do NOT fabricate placeholder lines like `none-returned: 0.1 — ...` — the parser rejects unknown memory IDs (see `src/lib/engram-feedback.ts:55`), so placeholder lines are silently dropped and produce zero recorded judgments.

Retrieved memories:
[engramMemoryIds as bullet list, or "(none)"]

Judgments:
```

## Step 2.2: Apply judgments via step_complete (orchestrator, AFTER subagent)

After subagent returns `output`:

1. Call `mcp__dev-workflow__step_complete({ stepName: "plan", runId, beforeSearchMemoryIds: engramMemories, output })`.
2. Result includes:
   - `judgmentsApplied`: count of explicit judgments parsed from the `## Engram Feedback` section
   - `fallbackIds`: ids without agent feedback (NO blanket fallback applied — Phase 1 design value per ADR 2026-05-13). Unjudged memories remain visible in `pendingJudgments` daemon counter.
   - `antipatternIdsInBefore` + `antipatternJudgmentDistribution`: observability fields for Phase 1.5 design-by-data decision
3. If `fallbackIds.length > 0`: log `[engram] step plan: <N> unjudged memories: <ids>` to stderr.
4. **Fail-safe:** if `step_complete` tool unavailable, log `[engram] step_complete skipped for Step 2` to stderr. Continue — do not abort pipeline.

**Phase mode addition:** if task is a phase file, add to prompt:
```
You are planning a PHASE with multiple subtasks.
Break this into ordered implementation steps.
Each step must be completable in one CODER iteration.

Add to output:
Subtasks:
1. [name]
   Files: [list]
   Tests: [list]
   Depends on: [previous subtask number or "none"]
```

Save PLAN block. Display as plain markdown (NOT in a code fence):

## PLAN

- **Summary:** [Summary]
- **Files:** [N] change, [N] create, [N] tests
- **Scope:** small / large
