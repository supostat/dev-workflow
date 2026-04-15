#!/usr/bin/env bash
# sync-from-templates.sh — точечный апдейт downstream-проекта актуальными templates dev-workflow.
#
# Использование: bash scripts/sync-from-templates.sh /absolute/path/to/target-project
#
# Что делает (idempotent):
#   1. rsync --checksum templates/claude/commands/  → <target>/.claude/commands/
#   2. rsync --checksum templates/claude/agents/    → <target>/.claude/agents/
#   3. Append "## Engram Memory Protocol" в <target>/CLAUDE.md, если отсутствует
#   4. Append dev-workflow + stack entries в <target>/.gitignore, если отсутствуют
#
# Что НЕ делает: не трогает settings.json, не пере-сканирует stack/conventions, не наполняет vault.
# Для полной первичной установки используй `dev-workflow init`.
#
# ADR: .dev-vault/architecture/2026-04-13-downstream-template-sync-strategy.md

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <absolute-path-to-target-project>" >&2
  exit 2
fi

TARGET="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_VAULT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEMPLATES_DIR="${DEV_VAULT_ROOT}/templates"

if [[ ! -d "${TARGET}" ]]; then
  echo "Error: target directory not found: ${TARGET}" >&2
  exit 1
fi

if [[ ! -d "${TEMPLATES_DIR}" ]]; then
  echo "Error: templates directory not found: ${TEMPLATES_DIR}" >&2
  exit 1
fi

if [[ ! -f "${TARGET}/CLAUDE.md" ]]; then
  echo "Error: ${TARGET}/CLAUDE.md not found. Run 'dev-workflow init' first for fresh install." >&2
  exit 1
fi

echo "▶ Syncing templates → ${TARGET}"
echo "  source: ${TEMPLATES_DIR}"
echo

mkdir -p "${TARGET}/.claude/commands" "${TARGET}/.claude/agents"

echo "── 1. .claude/commands/ ──"
rsync -av --checksum "${TEMPLATES_DIR}/claude/commands/" "${TARGET}/.claude/commands/"
echo

echo "── 2. .claude/agents/ ──"
rsync -av --checksum "${TEMPLATES_DIR}/claude/agents/" "${TARGET}/.claude/agents/"
echo

echo "── 3. CLAUDE.md → Engram Memory Protocol ──"
if grep -q "Engram Memory Protocol" "${TARGET}/CLAUDE.md"; then
  echo "  ✓ already present, skip"
else
  printf "\n\n" >> "${TARGET}/CLAUDE.md"
  cat "${TEMPLATES_DIR}/records/engram-protocol.md" >> "${TARGET}/CLAUDE.md"
  printf "\n" >> "${TARGET}/CLAUDE.md"
  echo "  ✓ appended ($(wc -l < "${TEMPLATES_DIR}/records/engram-protocol.md") lines)"
fi
echo

echo "── 4. .gitignore → dev-workflow + stack entries ──"
GITIGNORE="${TARGET}/.gitignore"
touch "${GITIGNORE}"
if grep -q "^# dev-workflow (session data)" "${GITIGNORE}"; then
  echo "  ✓ dev-workflow block already present, skip"
else
  cat >> "${GITIGNORE}" <<'EOF'

# dev-workflow (session data)
.dev-vault/daily/
.dev-vault/branches/
.dev-vault/.edit-log.json
.dev-vault/.intelligence.json
EOF
  echo "  ✓ dev-workflow block appended"
fi

# Stack-detected entries (только если соответствующий маркер найден в проекте)
declare -a STACK_ENTRIES=()
[[ -f "${TARGET}/package.json" ]] && STACK_ENTRIES+=("node_modules/" "dist/" "*.tsbuildinfo" ".turbo/")
[[ -f "${TARGET}/next.config.js" ]] || [[ -f "${TARGET}/next.config.mjs" ]] || [[ -f "${TARGET}/next.config.ts" ]] && STACK_ENTRIES+=(".next/" "out/")
[[ -f "${TARGET}/Cargo.toml" ]] && STACK_ENTRIES+=("target/")
[[ -f "${TARGET}/pyproject.toml" ]] || [[ -f "${TARGET}/requirements.txt" ]] && STACK_ENTRIES+=("__pycache__/" "*.pyc" ".venv/" "venv/")

if [[ ${#STACK_ENTRIES[@]} -gt 0 ]]; then
  if grep -q "^# dev-workflow (stack-detected)" "${GITIGNORE}"; then
    echo "  ✓ stack block already present, skip"
  else
    printf "\n# dev-workflow (stack-detected)\n" >> "${GITIGNORE}"
    for entry in "${STACK_ENTRIES[@]}"; do
      grep -qxF "${entry}" "${GITIGNORE}" || echo "${entry}" >> "${GITIGNORE}"
    done
    echo "  ✓ stack entries appended (${#STACK_ENTRIES[@]} entries considered)"
  fi
fi

echo
echo "✅ Done. Verify:"
echo "  diff -rq ${TEMPLATES_DIR}/claude/commands ${TARGET}/.claude/commands"
echo "  diff -rq ${TEMPLATES_DIR}/claude/agents ${TARGET}/.claude/agents"
echo "  grep -c 'Engram Memory Protocol' ${TARGET}/CLAUDE.md  # должно быть 1"
