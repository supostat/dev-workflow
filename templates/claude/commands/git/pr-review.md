# /git:pr-review — Review a pull request with vault context

Perform a thorough PR review using project vault knowledge.

## Procedure

1. Get PR diff:
   - `git diff main...HEAD` (or specified base branch)
   - `git log main..HEAD --oneline` for commit history

2. Load vault context:
   - Read `.dev-vault/conventions.md` for code standards
   - Read `.dev-vault/knowledge.md` for known gotchas
   - Read `.dev-vault/stack.md` for tech constraints

3. Review changes against vault knowledge:
   - Convention compliance (naming, structure, patterns)
   - Known gotchas that apply to changed code
   - Security considerations per stack

4. Standard review checklist:
   - Are changes focused (single responsibility)?
   - Are tests included for new functionality?
   - Are there breaking changes?
   - Is error handling appropriate?
   - Any hardcoded values that should be configured?

5. Produce review:

```
## PR Review: <branch name>

### Summary
<1-2 sentences describing what the PR does>

### Convention Compliance
- <pass/fail for each relevant convention>

### Vault Gotchas
- <any known gotchas from knowledge.md that apply>

### Findings
severity: <low|medium|high|critical>
file: <path>
line: <N>
issue: <description>
suggestion: <fix>

### Verdict
APPROVE / REQUEST_CHANGES / COMMENT

### Suggested vault updates
- <any new gotchas or patterns discovered during review>
```

6. If significant findings → offer to record:
   - New gotcha → use MCP tool `vault_knowledge`
   - Bug pattern → `/vault:bug`
   - Architecture concern → `/vault:adr`
