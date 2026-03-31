# /git:changelog — Generate changelog from git history

Generate a structured changelog from recent commits.

## Procedure

1. Determine range (since last tag, or user-specified)
2. Collect commits: `git log <range> --oneline --no-merges`
3. Categorize by prefix: Add/Implement, Update/Refactor, Fix, Remove, Security

## Output format

Use this exact format (markdown, not code block):

📋 **Changelog** — \<range description\>

### ✨ Added
- \<description\> (`\<short hash\>`)

### 🔄 Changed
- \<description\> (`\<short hash\>`)

### 🐛 Fixed
- \<description\> (`\<short hash\>`)

### 🗑️ Removed
- \<description\> (`\<short hash\>`)

### 🔒 Security
- \<description\> (`\<short hash\>`)

**N commits, M categories.**

💡 Prepend to CHANGELOG.md? (yes / no)

## Rules

- Follow Keep a Changelog format
- Group related commits
- Skip merge commits
- Use present tense
