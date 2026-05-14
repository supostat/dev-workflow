---
name: vault:debt
description: Record a tech-debt entry to .dev-vault/debt/ with problem, deferral reason, proposal, and risk-if-ignored. Use when consciously deferring work that should be tracked (incomplete refactor, deferred optimization, postponed migration). Auto-mirrors to engram and adds a backlog hint.
allowed-tools: [mcp__dev-workflow__vault_record]
invocation: user
---

# /vault:debt — Record tech debt

Create a tech debt record in `.dev-vault/debt/`.

## Procedure

1. Gather: What, Why deferred, Priority, Effort, Risk
2. Show summary before saving:

📝 **Tech Debt**

- **Priority:** 🔴 high / 🟡 medium / 🟢 low
- **Effort:** small / medium / large
- **Title:** \<title\>

**Problem:** \<what's wrong\>
**Why deferred:** \<context\>
**Proposal:** \<how to fix\>
**Risk if ignored:** \<consequences\>

**Save?** (yes / edit / skip)

3. If yes → use MCP tool `vault_record` type "debt"
4. Confirm:

✅ **Saved** → `.dev-vault/debt/<date>-<slug>.md`

💡 Added to gameplan.md backlog. Consider: `/task create "<title>"`
