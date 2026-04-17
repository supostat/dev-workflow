# /vault:adr — Create Architecture Decision Record

Record a significant architectural or design decision in `.dev-vault/architecture/`.

## Procedure

### Step 0: Engram search — MANDATORY

Before drafting the ADR:
1. `memory_search` with a query capturing the decision topic (key terms, technology names, constraint domain).
2. `memory_judge` EACH returned memory (score 0.0-1.0 + explanation). No silent judges.
3. If search returns `antipattern` records — address EACH explicitly in the ADR: explain why the chosen decision doesn't trigger the antipattern, or change the approach. Silent ignore = protocol violation.

### Step 1: Gather from conversation context

Context, Decision, Alternatives, Consequences.

### Step 2: Show summary before saving

📋 **New ADR**

- **Title:** \<decision title\>
- **Date:** \<today\>
- **Status:** accepted

**Context:** \<why needed\>

**Decision:** \<what was decided\>

**Alternatives considered:**
- **\<option A\>** — \<pros/cons\>
- **\<option B\>** — \<pros/cons\>

**Consequences:** \<trade-offs\>

**Save?** (yes / edit / skip)

### Step 3: Write the ADR

If yes → use MCP tool `vault_record` type "adr" or create file directly in `.dev-vault/architecture/<date>-<slug>.md`.

### Step 4: Confirm

✅ **Saved** → `.dev-vault/architecture/<date>-<slug>.md`

💡 Updated knowledge.md if decision impacts patterns.

### Step 5: Engram store — MANDATORY

After ADR file saved:
- `memory_store` with `memory_type: "decision"`
- `context`: short description of the decision topic
- `action`: the decision itself (1-2 sentences)
- `result`: rationale + rejected alternatives summary
- `tags`: relevant domain tags + `adr` + any technology keywords
- `project`: project name

## When to use

- Choosing between frameworks, libraries, or approaches
- Defining data models or API contracts
- Changing project structure or conventions
