# /session:review — Multi-perspective code review

Perform a code review of uncommitted changes from multiple perspectives,
aggregate findings by severity, detect conflicts between perspectives.

## Procedure

1. Run `git diff --stat` to see scope, then `git diff` for details
2. Load vault context (conventions, stack, knowledge)
3. **Evaluate from 5 perspectives** (inspired by consensus protocol):

### Perspectives

Each perspective reviews the same diff with different focus:

- **Security** — OWASP Top 10, injection, secrets, path traversal, auth
- **Quality** — SOLID, DRY, naming, complexity, error handling
- **Conventions** — project conventions from .dev-vault/conventions.md
- **Completeness** — edge cases, error paths, missing tests, cleanup
- **Pragmatism** — effort vs value, over-engineering, simplicity

4. **Aggregate findings** by severity, detect conflicts

## Output format

Use this exact format (markdown, not code block):

📝 **Review:** \<branch or description\>

**Scope:** N files changed, M insertions, K deletions

### 🔴 Critical (must fix)
- **\<file:line\>** — \<issue\> *(perspective: Security/Quality/...)*
  💡 *Fix:* \<concrete suggestion\>

### 🟠 High (should fix)
- **\<file:line\>** — \<issue\> *(perspective: ...)*
  💡 *Fix:* \<suggestion\>

### 🟡 Medium (consider)
- **\<file:line\>** — \<issue\> *(perspective: ...)*

### 💡 Suggestions
- \<improvement ideas\>

### ✅ Good
- \<positive observations from any perspective\>

### ⚠️ Conflicts between perspectives

If perspectives disagree (e.g., Pragmatism says "good enough" but Quality says "refactor"):

- **\<topic\>** — \<perspective A\> vs \<perspective B\>: \<nature of disagreement\>
  → *Resolution:* \<recommendation or escalate to user\>

### Verdict

| Perspective | Assessment |
|-------------|-----------|
| Security | ✅ pass / ⚠️ concerns / 🔴 blocked |
| Quality | ✅ / ⚠️ / 🔴 |
| Conventions | ✅ / ⚠️ / 🔴 |
| Completeness | ✅ / ⚠️ / 🔴 |
| Pragmatism | ✅ / ⚠️ / 🔴 |

**Overall:** ✅ APPROVE / ⚠️ APPROVE with notes / ❌ REQUEST_CHANGES

**Summary:** N findings (C critical, H high, M medium, S suggestions)

💡 Actions:
- Bug pattern? → /vault:bug
- New gotcha? → update knowledge.md
- Architecture concern? → /vault:adr

## Rules

- Read-only — never modify project code
- Reference specific files and line numbers
- Each finding tagged with source perspective
- Conflicts: if Security blocks but Pragmatism approves → Security wins
- Critical from ANY perspective → overall REQUEST_CHANGES
