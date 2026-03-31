# /git:pr-review — Multi-perspective PR review with vault context

Perform a thorough PR review using project vault knowledge and multiple evaluation perspectives.

## Procedure

1. Get PR diff: `git diff main...HEAD` and `git log main..HEAD --oneline`
2. Load vault context (conventions, knowledge, stack)
3. **Evaluate from 5 perspectives:** Security, Quality, Conventions, Completeness, Pragmatism

## Output format

Use this exact format (markdown, not code block):

🔍 **PR Review:** \<branch name\>

### Summary
\<1-2 sentences describing what the PR does\>

**Commits:** N | **Files:** M changed | **Scope:** \<small/medium/large\>

### Convention Compliance
- ✅ \<passing convention from vault\>
- ❌ \<violated convention\> — **\<file:line\>**

### ⚠️ Vault Gotchas
- \<known gotchas from knowledge.md that apply to this PR\>

### Findings by Severity

**🔴 Critical** — \<count or "none"\>
- **\<file:line\>** — \<issue\> *(perspective: Security/Quality/...)*
  💡 *Fix:* \<suggestion\>

**🟠 High** — \<count or "none"\>
- **\<file:line\>** — \<issue\> *(perspective: ...)*
  💡 *Fix:* \<suggestion\>

**🟡 Medium** — \<count or "none"\>
- **\<file:line\>** — \<issue\>

**💡 Suggestions**
- \<improvements\>

### Perspective Verdict

| Perspective | Assessment | Key concern |
|-------------|-----------|-------------|
| Security | ✅ / ⚠️ / 🔴 | \<one-line summary\> |
| Quality | ✅ / ⚠️ / 🔴 | \<summary\> |
| Conventions | ✅ / ⚠️ / 🔴 | \<summary\> |
| Completeness | ✅ / ⚠️ / 🔴 | \<summary\> |
| Pragmatism | ✅ / ⚠️ / 🔴 | \<summary\> |

### ⚠️ Conflicts
- \<if perspectives disagree: topic, who vs who, resolution\>

### Overall Verdict
✅ **APPROVE** / ⚠️ **APPROVE with notes** / ❌ **REQUEST_CHANGES**

### 💡 Suggested vault updates
- \<new gotchas or patterns discovered during review\>

Record findings? → /vault:bug, /vault:adr, /vault:knowledge
