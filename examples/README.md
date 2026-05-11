# Workflow examples

Copy-paste workflow YAMLs demonstrating common customization patterns.

## Installation

1. Pick an example.
2. Copy it into your project's `.dev-vault/workflows/<name>.yaml`.
3. Restart Claude Code (or run `dev-workflow update`) so the slash shim
   in `.claude/commands/workflow/<name>.md` is generated.
4. Invoke via `/workflow:<name> "your task"` from Claude Code.

## Gallery

| Example | Trigger | What it does |
|---|---|---|
| [hotfix-with-changelog.yaml](./hotfix-with-changelog.yaml) | `/workflow:hotfix-with-changelog` | Hotfix flow that requires a CHANGELOG entry before commit. |
| [doc-sync.yaml](./doc-sync.yaml) | `/workflow:doc-sync` | Documentation-only sync — planner + coder for docs + custom-command gate that runs `pnpm test`. |
| [scratch.yaml](./scratch.yaml) | `/workflow:scratch` | Minimal rapid-prototype loop — no review, no test gate, no vault writes. |
| [security-audit.yaml](./security-audit.yaml) | `/workflow:security-audit` | Read-only deep audit — reader + 3 parallel reviewers, no coder, no commit. |

## Customization tips

- **Override a builtin**: name your custom yaml the same as a builtin
  (e.g. `dev.yaml`). dev-workflow's loader prioritizes custom over
  builtin, so your version wins (ADR `2026-04-22`).
- **Per-step prompt override**: drop a markdown file at
  `.dev-vault/workflow-steps/<step-name>.md` with your custom
  instructions. The dispatcher picks it up before falling back to the
  builtin step file.
- **Custom agent**: drop a markdown file with frontmatter into
  `.dev-vault/agents/<agent-name>.md`. Set `write: []` for read-only
  Explore agents; non-empty `write:` makes it a Full agent.
- **Validate before run**: `dev-workflow validate
  .dev-vault/workflows/yourflow.yaml` lints workflow.name, step
  names, agent existence (since v1.0.1), and onFail routing.

## When to use which

- **Bug landed in prod** → `/workflow:hotfix-with-changelog`. The
  CHANGELOG gate ensures users see the fix in release notes.
- **Just need to push docs** → `/workflow:doc-sync`. Avoids the full
  review/test ceremony of `/workflow:dev`.
- **Throwaway exploration** → `/workflow:scratch`. No gates, no vault
  noise, no commit. Lets you iterate on a sketch.
- **Pre-release audit** → `/workflow:security-audit`. Read-only.
  Generates findings without modifying anything.

## Contributing examples

Have a pattern that's been useful? Open a PR adding a new yaml + a row
in the table above. Keep examples self-contained — no references to
project-specific paths or secrets.
