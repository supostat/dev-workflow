# /review — Code review notes

Perform a code review of uncommitted changes and record findings.

## Procedure

1. Run `git diff --stat` to see scope of changes
2. Run `git diff` to review actual changes
3. Analyze changes against:
   - `.dev-vault/conventions.md` — code style and patterns
   - `.dev-vault/stack.md` — technology constraints
   - `.dev-vault/knowledge.md` — known gotchas
4. Report findings by severity:

```
## Review: <branch or description>

### Critical
- <security issues, data loss risks>

### Warning
- <pattern violations, potential bugs>

### Suggestion
- <improvements, readability>

### Good
- <positive observations>
```

5. If significant findings exist, offer to create records:
   - Bug pattern → suggest `/bug`
   - Convention violation → suggest updating conventions.md
   - Architecture concern → suggest `/adr`

## Rules

- Read-only — never modify project code during review
- Reference specific files and line numbers
- Check OWASP Top 10 for security-relevant changes
- Verify test coverage for changed code
