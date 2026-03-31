# /search — Search the vault

Search `.dev-vault/` for relevant information.

## Procedure

1. Take the user's search query
2. Use MCP tool `vault_search` with the query, or search across all `.dev-vault/**/*.md` files using Grep
3. Present results grouped by file type:
   - **Knowledge** — matches in knowledge.md
   - **Gameplan** — matches in gameplan.md
   - **Branch contexts** — matches in branches/
   - **Daily logs** — matches in daily/
   - **Records** — matches in architecture/, bugs/, debt/
   - **Tasks** — matches in tasks/
4. Show relevant surrounding context (3-5 lines around each match)
5. If no results found, suggest alternative search terms

## Output format

```
## Search: "<query>"

### Knowledge
- knowledge.md:42 — <matching line with context>

### Branches
- branches/feature-auth.md:15 — <matching line>

### Tasks
- tasks/task-001.md:3 — <matching line>

Found N matches across M files.
```
