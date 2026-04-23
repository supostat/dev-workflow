# /vault:pattern — Append a reusable pattern to conventions.md

Record a code or design pattern directly into `.dev-vault/conventions.md`. The tool
appends a single bullet to a named section (default `Patterns`), rejects duplicates,
and never overwrites anything outside the target section.

## Arguments

- `/vault:pattern "<one-line pattern>"` — append to default `Patterns` section
- `/vault:pattern --section <name> "<one-line pattern>"` — append to a custom section (must already exist in conventions.md)

Examples:

- `/vault:pattern "Registry: AgentRegistry (src/agents/registry.ts) loads agents from disk"`
- `/vault:pattern --section Testing "Use real-fixture pattern with mkdtempSync; NEVER vi.mock"`

## Procedure

### Step 1: Draft the bullet

Collect from the user or current conversation:

- **What** — the rule or observation (one line, imperative or descriptive)
- **Where** — optional file/module reference in parentheses
- **Why** — optional short rationale (in parentheses)

Format the bullet in the style of existing `conventions.md` entries:

```
- <Name or topic>: <one-line description> (<optional file ref>)
```

Examples:

- `- Strategy: StepExecutor and GateChecker are injected into WorkflowEngine (src/workflow/engine.ts)`
- `- Error handling: throw new Error() + try-catch; null-safe helpers (readJsonOrNull, readFileOrNull)`

The content MUST be a single line. Multi-line input will be rejected by the MCP tool.

### Step 2: Show summary

Display as plain markdown (NOT in a code fence):

📋 **New pattern**

- **Section:** `Patterns` (or overridden)
- **Entry:** `<bullet draft>`

**Save?** (yes / edit / skip)

### Step 3: Save

On `yes`, call the MCP tool:

```
mcp__dev-workflow__vault_pattern({
  section: "<section name>",   // optional; omit for default "Patterns"
  content: "- <bullet>"
})
```

### Step 4: Report outcome

Use the handler's return shape to decide the message:

- `{ success: true, appended: true }` → ✅ **Appended** to `conventions.md` § `<section>`
- `{ success: true, appended: false, reason: "duplicate" }` → ⚠️ A matching bullet already exists in `<section>`. No change made. (Dedup is whitespace-insensitive, case-sensitive.)
- `{ success: true, appended: false, reason: "section-missing" }` → ❌ Section `<name>` does not exist in `conventions.md`. Options: (1) rerun with `--section <existing name>`; (2) add the section manually and retry.
- `{ success: true, appended: false, reason: "file-missing" }` → ❌ `.dev-vault/conventions.md` is missing. Run `dev-workflow init` first.
- Error thrown containing `"single line"` → ❌ Content must be one line. Split multi-line input into separate `/vault:pattern` calls.

## Rules

- **MCP only.** Never edit `conventions.md` directly — the tool handles dedup and section-existence validation.
- **Single line per bullet.** Multi-line content is rejected by the tool; split into multiple calls.
- **English bullets.** Match the existing style of `conventions.md`.
- **Default section is `Patterns`.** Custom sections (e.g. `Testing`, `Naming`, `Code Style`) are allowed only if they already exist in the file.
- **Short and specific.** Pattern bullets are one line. If rationale needs more than one sentence, record as an ADR (`/vault:adr`) instead.
- **No secrets, paths, or absolute FS references in bullets.** Keep entries portable across checkouts.

## When to use

- REVIEW step identified a recurring pattern worth preserving for future sessions
- You found a convention applied 2+ times in the codebase and want it explicit
- User requests `"remember this pattern"` or `"add to conventions"`

## When NOT to use

- One-off implementation details → skip
- Architecture decisions with trade-offs → `/vault:adr` instead
- Known issues / workarounds → `.dev-vault/knowledge.md` `Gotchas` section (via `vault_knowledge`)
- Deferred work → `/vault:debt`
