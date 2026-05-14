---
name: vault:bug
description: Record a resolved non-trivial bug to .dev-vault/bugs/ with symptom, root cause, fix, and prevention. Use after diagnosing and fixing a bug worth remembering for future sessions or knowledge transfer. Auto-mirrors to engram for cross-run recall.
allowed-tools: [mcp__dev-workflow__vault_record]
invocation: user
---

# /vault:bug — Record a resolved bug

Create a bug log in `.dev-vault/bugs/` for non-trivial bugs that were solved.

## Procedure

1. Gather: Symptoms, Root cause, Fix, Prevention, Severity
2. Show summary before saving:

🐛 **Bug Record**

- **Severity:** 🔴 critical / 🟠 high / 🟡 medium / 🟢 low
- **Title:** \<brief description\>

**Symptoms:** \<how it showed up\>
**Root cause:** \<why it happened\>
**Fix:** \<what was done — reference files/commits\>
**Prevention:** \<how to avoid in future\>

**Save?** (yes / edit / skip)

3. If yes → use MCP tool `vault_record` type "bug"
4. Confirm:

✅ **Saved** → `.dev-vault/bugs/<date>-<slug>.md`

💡 Updated knowledge.md → Gotchas (if pattern revealed)

## When to use

Only for non-trivial bugs worth remembering. Simple typos don't need a record.
