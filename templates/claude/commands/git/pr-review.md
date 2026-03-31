# /git:pr-review — Review a pull request with vault context

Perform a thorough PR review using project vault knowledge.

## Procedure

1. Get PR diff: `git diff main...HEAD` and `git log main..HEAD --oneline`
2. Load vault context (conventions, knowledge, stack)
3. Review changes against vault knowledge
4. Standard checklist: focus, tests, breaking changes, error handling

## Output format

Use this exact format (markdown, not code block):

🔍 **PR Review:** \<branch name\>

### Summary
\<1-2 sentences describing what the PR does\>

### Convention Compliance
- ✅ \<passing convention\>
- ❌ \<violated convention\>

### ⚠️ Vault Gotchas
- \<any known gotchas from knowledge.md that apply\>

### Findings

**🔴 \<severity\>** — **\<file:line\>**
\<issue description\>
💡 *Suggestion:* \<fix\>

**🟡 \<severity\>** — **\<file:line\>**
\<issue description\>
💡 *Suggestion:* \<fix\>

### Verdict
✅ **APPROVE** / ❌ **REQUEST_CHANGES** / 💬 **COMMENT**

### 💡 Suggested vault updates
- \<new gotchas or patterns discovered\>

Record findings? → /vault:bug, /vault:adr, /vault:knowledge
