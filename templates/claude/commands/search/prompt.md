# /search — Search the vault

Search `.dev-vault/` for relevant information.

## Procedure

1. Take the user's search query
2. Search across all `.dev-vault/*.md` and `.dev-vault/**/*.md` files using Grep
3. Present results grouped by file type:
   - **Knowledge** — matches in knowledge.md
   - **Gameplan** — matches in gameplan.md
   - **Branch contexts** — matches in branches/
   - **Daily logs** — matches in daily/
   - **Records** — matches in architecture/, bugs/, debt/
4. Show relevant surrounding context (3-5 lines around each match)
5. If no results found, suggest alternative search terms

## Output format

```
## Search: "<query>"

### Knowledge
- knowledge.md:42 — <matching line with context>

### Branches
- branches/feature-auth.md:15 — <matching line>

### Daily Logs
- daily/2026-03-30.md:8 — <matching line>

Found 5 matches across 3 files.
```
