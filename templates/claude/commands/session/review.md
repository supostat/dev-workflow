# /session:review — Code review notes

Perform a code review of uncommitted changes and record findings.

## Procedure

1. Run `git diff --stat` to see scope, then `git diff` for details
2. Load vault context (conventions, stack, knowledge)
3. Review against vault knowledge + OWASP Top 10

## Output format

Use this exact format (markdown, not code block):

📝 **Review:** \<branch or description\>

### 🔴 Critical
- **\<file:line\>** — \<security issues, data loss risks\>

### 🟠 Warning
- **\<file:line\>** — \<pattern violations, potential bugs\>

### 💡 Suggestion
- **\<file:line\>** — \<improvements, readability\>

### ✅ Good
- \<positive observations\>

**Verdict:** N findings (C critical, W warnings, S suggestions)

💡 Actions:
- Bug pattern found? → /vault:bug
- Convention violated? → update conventions.md
- Architecture concern? → /vault:adr

## Rules

- Read-only — never modify project code
- Reference specific files and line numbers
- Verify test coverage for changed code
