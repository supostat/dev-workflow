# /vault:security-scan — Security audit of the codebase

Scan the project for common security issues and record findings in vault.

## Procedure

1. Check for hardcoded secrets:
   - Search for patterns: `API_KEY`, `SECRET`, `PASSWORD`, `TOKEN`, `PRIVATE_KEY` in source files
   - Check `.env.example` exists if `.env` is in `.gitignore`
   - Verify no `.env` files are committed: `git ls-files | grep '\.env'`

2. Check dependency security:
   - Run `npm audit` or `cargo audit` if available
   - Check for known vulnerable dependencies

3. Check OWASP Top 10 patterns:
   - SQL injection: raw queries without parameterization
   - XSS: unescaped user input in templates
   - Command injection: `exec()`, `execSync()` with user input
   - Path traversal: file operations with unsanitized paths
   - Insecure deserialization: `JSON.parse()` on untrusted input

4. Check configuration:
   - CORS headers, HTTPS, rate limiting, auth middleware

5. Record findings:
   - Critical/High → use MCP tool `vault_record` type "bug"
   - Patterns → use MCP tool `vault_knowledge` section "Security"

## Output format

Use this exact format (markdown, not code block):

🔒 **Security Scan — \<projectName\>**

### 🔴 Critical
- **\<file:line\>** — \<issue description\>

### 🟠 High
- **\<file:line\>** — \<issue description\>

### 🟡 Medium
- **\<file:line\>** — \<issue description\>

### ✅ Recommendations
- \<action item\>

**Scanned N files. Found M issues (C critical, H high, M medium).**

💡 Record high issue? (yes → /vault:bug)
