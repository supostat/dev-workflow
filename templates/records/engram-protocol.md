## Engram Memory Protocol

Search/store/chains/tags/failure-store handled automatically by workflow engine.
These rules apply to **mid-work agent behavior** — when Claude makes decisions during task execution.

API reference: `~/.engram/AGENT.md`

### Judge previous step

After receiving context from a previous pipeline step, call `memory_judge` on memories that informed that step's output. Coder judges Planner's decisions. Reviewer judges Coder's patterns.

- 0.8-1.0: directly useful, applied the knowledge
- 0.5-0.7: relevant context, good to know
- 0.2-0.4: marginally relevant
- 0.0-0.1: not useful or misleading

Include explanation with every judgment.

### Address antipatterns from search results

If `memory_search` returns antipattern records — address them explicitly. Either explain why your approach is different, or change your approach. Never silently ignore antipatterns.

### Reactive search on errors

When hitting an error or unexpected behavior mid-work — `memory_search` BEFORE attempting a fix. If search returns relevant results, apply them and `memory_judge`. If nothing found, fix the issue, then `memory_store` as `bugfix`.

### Store decisions mid-work

When facing a choice between approaches — `memory_search` for precedents, then `memory_store` the decision with reasoning BEFORE implementing. Include: options considered, why chosen, trade-offs, revisit conditions.

### Store discoveries mid-work

When discovering something non-obvious — `memory_store` immediately. Library API differences, workarounds, edge cases, unexpected module interactions. Type: `pattern` (positive) or `antipattern` (negative). Do not filter by importance.
