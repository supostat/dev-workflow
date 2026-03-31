# /vault:adr — Create Architecture Decision Record

Record a significant architectural or design decision in `.dev-vault/architecture/`.

## Procedure

1. Gather from conversation context: Context, Decision, Alternatives, Consequences
2. Show summary before saving:

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

3. If yes → use MCP tool `vault_record` type "adr" or create file directly
4. Confirm:

✅ **Saved** → `.dev-vault/architecture/<date>-<slug>.md`

💡 Updated knowledge.md if decision impacts patterns

## When to use

- Choosing between frameworks, libraries, or approaches
- Defining data models or API contracts
- Changing project structure or conventions
