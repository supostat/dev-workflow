# Step 2: PLAN

## Engram (orchestrator — before launching subagent)
Search for architecture decisions and antipatterns:
1. memory_search(query="<module> architecture decision")
2. memory_search(query="<technology> antipattern")
Pass results as "Engram memories" section in the subagent prompt below.

After subagent returns PLAN, store key decisions:
memory_store(type: "decision", context: "<what was decided>", action: "<options considered, why chosen>", result: "<trade-offs, revisit conditions>", tags: "<module>,<technology>,plan")

Launch **Explore** subagent:

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

## Engram memories (from orchestrator search)
[paste memory_search results here, or "none"]
If antipatterns found — address them in the plan. Explain why your approach avoids the issue.

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
```

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

Save PLAN block. Display:

```
── PLAN ──
[Summary]
Files: [N] change, [N] create, [N] tests
Scope: [small / large]
```
