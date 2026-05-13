# Step 1: READ

## Step 1.0: Engram search (orchestrator, BEFORE subagent)

Before launching the subagent, orchestrator MUST:

1. Call `mcp__dev-workflow__memory_search({ query: "read " + taskDescription + " " + branch, project: projectName, limit: 5 })`.
2. Save the returned array of memory objects. Extract `engramMemories = results.map(m => ({ id: m.id, memoryType: m.memory_type }))` — enriched objects (id + memoryType) required by `step_complete` in Step 1.2.
3. Build a human-readable `engramContextBlock`: for each memory, a bullet `- [<type>] <context> — <action>`. If no results, set `engramContextBlock = "(none)"`.
4. Note any `antipattern` records — they MUST be addressed explicitly by the subagent.
5. **Fail-safe:** if `mcp__dev-workflow__memory_search` unavailable (engram daemon down, dev-workflow MCP not connected), log `[engram] search skipped for Step 1` to stderr, set `engramMemories = []` and `engramContextBlock = "(engram unavailable)"`. Continue.

## Step 1.1: Launch subagent

Launch **Explore** subagent with this prompt:

```
You are a reader agent. Gather context for the task below.

## Task
[task from user]

## Project Context
[vault sections: stack.md, conventions.md, knowledge.md, gameplan.md]

## Engram Memory
[engramContextBlock — memories retrieved before this step]

## Procedure
1. Read CLAUDE.md for project instructions
2. Find files relevant to the task (Glob/Grep)
3. Read relevant files (max 10 files, 500 lines each)
4. Find dependencies and tests for those files
5. Find how similar things are done in the project
6. Scan .dev-vault/architecture/ for ADR records related to this task
7. Scan .dev-vault/bugs/ for known bugs in affected areas
8. Scan .dev-vault/debt/ for known debt in affected areas
9. Address any antipattern records from Engram Memory explicitly

## Output Format
CONTEXT:
Task: [reformulated task with project context]
Files to change: [file list with what to change]
Dependencies: [files depending on changes]
Tests: [existing tests for those files]
Patterns found: [how similar things are solved]
Relevant code: [key fragments]
Related ADRs: [from .dev-vault/architecture/ or "none"]
Known bugs: [from .dev-vault/bugs/ or "none"]
Known debt: [from .dev-vault/debt/ or "none"]
END_CONTEXT

## Engram Feedback (MANDATORY — at end of output, after END_CONTEXT)

For each retrieved memory below, judge how useful it was for this step.
Format (one memory per line, single-line explanation):

`- <memory_id>: <score 0.0-1.0> — <brief explanation>`

Score scale:
- 0.8-1.0: directly useful, applied
- 0.5-0.7: relevant context
- 0.2-0.4: marginally relevant
- 0.0-0.1: not useful or misleading

Retrieved memories:
[engramMemoryIds as bullet list, or "(none)"]

Judgments:
```

## Step 1.2: Apply judgments via step_complete (orchestrator, AFTER subagent)

After subagent returns `output`:

1. Call `mcp__dev-workflow__step_complete({ stepName: "read", runId, beforeSearchMemoryIds: engramMemories, output })`.
2. Result includes:
   - `judgmentsApplied`: count of explicit judgments parsed from the `## Engram Feedback` section
   - `fallbackIds`: ids without agent feedback (NO blanket fallback applied — Phase 1 design value per ADR 2026-05-13). Unjudged memories remain visible in `pendingJudgments` daemon counter.
   - `antipatternIdsInBefore` + `antipatternJudgmentDistribution`: observability fields for Phase 1.5 design-by-data decision
3. If `fallbackIds.length > 0`: log `[engram] step read: <N> unjudged memories: <ids>` to stderr.
4. **Fail-safe:** if `step_complete` tool unavailable, log `[engram] step_complete skipped for Step 1` to stderr. Continue — do not abort pipeline.

Save CONTEXT block (without the `## Engram Feedback` section) for the next step. Display as plain markdown (NOT in a code fence):

## READ

- **Files to change:** [N]
- **Dependencies:** [N]
- **Tests:** [N]
