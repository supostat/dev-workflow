# /vault:search — Search the vault

Search `.dev-vault/` for relevant information.

## Procedure

1. Take the user's search query
2. Use MCP tool `vault_search` with the query, or search via Grep
3. Present results grouped by type
4. Show 3-5 lines of context around each match
5. If no results, suggest alternative terms

## Output format

Use this exact format (markdown, not code block):

🔍 **Search:** "\<query\>"

### Knowledge
- **knowledge.md:42** — \<matching line with context\>

### Branches
- **branches/feature-auth.md:15** — \<matching line\>

### Tasks
- **tasks/task-001.md:3** — \<matching line\>

### Daily logs
- **daily/2026-03-30.md:8** — \<matching line\>

**Found N matches across M files.**
