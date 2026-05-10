---
description: /workflow:graph <name> — render workflow as Mermaid DAG
---

# /workflow:graph

Render the Mermaid DAG for a workflow. Useful in chat to visualize a pipeline before running it.

## Usage

```
/workflow:graph <name>
```

## Procedure

1. Run `dev-workflow workflow graph <name> --mermaid` via Bash.
2. Wrap stdout in a fenced `mermaid` block and emit to chat.
3. If CLI exits non-zero, relay stderr (which lists available workflows on "unknown workflow" error).

## Notes

- ASCII variant for terminal: `dev-workflow workflow graph <name> --ascii`
- Full step bodies: `dev-workflow workflow show <name> --bodies`
- Resolved pipeline: `dev-workflow workflow effective <name>`
