#!/usr/bin/env bash
# sync-from-templates.sh — точечный апдейт downstream-проекта актуальными templates dev-workflow.
#
# Использование:
#   bash scripts/sync-from-templates.sh [--dry-run] [--no-backup] <absolute-path-to-target-project>
#   bash scripts/sync-from-templates.sh --help
#
# Флаги:
#   --dry-run    — показать что будет изменено, ничего не писать
#   --no-backup  — не создавать backup перезаписываемых файлов (по умолчанию backup создаётся)
#   --help       — это сообщение
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
# Per-project exclusion:
#   Если в <target> есть файл `.devworkflow-sync-ignore` — его содержимое используется как
#   список relative-путей, которые не должны перезаписываться. Пример:
#
#     # .devworkflow-sync-ignore (один путь на строку, # для комментариев)
#     .claude/commands/vault/adr.md
#     .claude/commands/vault/arch.md
#
#   Пути трактуются относительно target root. Пустые строки и строки, начинающиеся с `#`,
#   игнорируются.
#
# Backup:
#   По умолчанию перед перезаписью файлов их старые версии копируются в
#   <target>/.dev-workflow-sync-backup/<ISO-timestamp>/. Отключается флагом --no-backup.
#
# ADR: .dev-vault/architecture/2026-04-13-downstream-template-sync-strategy.md

set -euo pipefail

usage() {
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
}

DRY_RUN=""
DO_BACKUP=1
TARGET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --dry-run)
      DRY_RUN="--dry-run"
      shift
      ;;
    --no-backup)
      DO_BACKUP=0
      shift
      ;;
    -*)
      echo "Error: unknown flag: $1" >&2
      echo "Try: $0 --help" >&2
      exit 2
      ;;
    *)
      if [[ -n "${TARGET}" ]]; then
        echo "Error: multiple target paths given: ${TARGET} and $1" >&2
        exit 2
      fi
      TARGET="$1"
      shift
      ;;
  esac
done

if [[ -z "${TARGET}" ]]; then
  echo "Usage: $0 [--dry-run] [--no-backup] <absolute-path-to-target-project>" >&2
  echo "Try: $0 --help" >&2
  exit 2
fi

# SECURITY: reject relative paths. Doc promises absolute; without this guard
# `bash sync-from-templates.sh ../../../some-project` from a CI runner would
# resolve relative to the runner's cwd — surprise location, possibly outside
# intended scope. Closes debt 2026-04-21 finding #1 (HIGH).
if [[ "${TARGET}" != /* ]]; then
  echo "Error: target path must be absolute (got: ${TARGET})" >&2
  echo "       Use a leading slash, e.g. /Users/you/project or \"\$(pwd)/project\"." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_VAULT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEMPLATES_DIR="${DEV_VAULT_ROOT}/templates"

if [[ ! -d "${TARGET}" ]]; then
  echo "Error: target directory not found: ${TARGET}" >&2
  exit 1
fi

# SECURITY: reject symlinks inside target's .claude/{commands,agents} BEFORE
# rsync. rsync's default behavior is to follow symlinks (writes through the
# link, hitting the target outside our directories). An attacker with write
# access to .claude/ could place `commands/foo.md -> /etc/cron.daily/payload`
# and have rsync overwrite the cron file when we sync templates. Closes debt
# 2026-04-21 finding #2 (MEDIUM, escalated to ship alongside HIGH).
for subdir in ".claude/commands" ".claude/agents"; do
  full="${TARGET}/${subdir}"
  [[ ! -d "${full}" ]] && continue
  if find "${full}" -type l -print -quit 2>/dev/null | grep -q .; then
    echo "Error: symlinks detected in ${full} — refusing to sync (rsync follows symlinks)." >&2
    echo "       Offending entries:" >&2
    find "${full}" -type l 2>/dev/null | while IFS= read -r link; do
      target="$(readlink "${link}")"
      echo "         ${link} -> ${target}" >&2
    done
    echo "       Remove or replace these symlinks with regular files before retry." >&2
    exit 1
  fi
done

if [[ ! -d "${TEMPLATES_DIR}" ]]; then
  echo "Error: templates directory not found: ${TEMPLATES_DIR}" >&2
  exit 1
fi

if [[ ! -f "${TARGET}/CLAUDE.md" ]]; then
  echo "Error: ${TARGET}/CLAUDE.md not found. Run 'dev-workflow init' first for fresh install." >&2
  exit 1
fi

IGNORE_FILE="${TARGET}/.devworkflow-sync-ignore"
EXCLUDE_ARGS=()
declare -a EXCLUDED_PATHS=()

if [[ -f "${IGNORE_FILE}" ]]; then
  while IFS= read -r raw_line || [[ -n "${raw_line}" ]]; do
    line="${raw_line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "${line}" ]] && continue
    [[ "${line:0:1}" == "#" ]] && continue
    EXCLUDED_PATHS+=("${line}")
  done < "${IGNORE_FILE}"
fi

commands_relative_excludes=()
agents_relative_excludes=()

for entry in "${EXCLUDED_PATHS[@]+"${EXCLUDED_PATHS[@]}"}"; do
  case "${entry}" in
    .claude/commands/*)
      commands_relative_excludes+=("${entry#.claude/commands/}")
      ;;
    .claude/agents/*)
      agents_relative_excludes+=("${entry#.claude/agents/}")
      ;;
    *)
      echo "  ⚠ sync-ignore entry outside .claude/commands or .claude/agents (ignored by sync, informational): ${entry}" >&2
      ;;
  esac
done

echo "▶ Syncing templates → ${TARGET}"
echo "  source: ${TEMPLATES_DIR}"
if [[ -n "${DRY_RUN}" ]]; then
  echo "  mode: DRY-RUN (no changes will be written)"
fi
if [[ ${#EXCLUDED_PATHS[@]} -gt 0 ]]; then
  echo "  exclude (from .devworkflow-sync-ignore):"
  for entry in "${EXCLUDED_PATHS[@]}"; do
    echo "    - ${entry}"
  done
fi
echo

BACKUP_DIR=""
if [[ -z "${DRY_RUN}" && ${DO_BACKUP} -eq 1 ]]; then
  TIMESTAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
  BACKUP_DIR="${TARGET}/.dev-workflow-sync-backup/${TIMESTAMP}"
  mkdir -p "${BACKUP_DIR}"
  echo "── 0. backup of files that will be overwritten ──"
  backup_any=0
  while IFS= read -r -d '' rel; do
    src="${TEMPLATES_DIR}/claude/commands/${rel}"
    dst="${TARGET}/.claude/commands/${rel}"
    [[ ! -f "${dst}" ]] && continue
    if ! cmp -s "${src}" "${dst}"; then
      mkdir -p "$(dirname "${BACKUP_DIR}/.claude/commands/${rel}")"
      cp -p "${dst}" "${BACKUP_DIR}/.claude/commands/${rel}"
      echo "  saved .claude/commands/${rel}"
      backup_any=1
    fi
  done < <(cd "${TEMPLATES_DIR}/claude/commands" && find . -type f -print0)

  while IFS= read -r -d '' rel; do
    src="${TEMPLATES_DIR}/claude/agents/${rel}"
    dst="${TARGET}/.claude/agents/${rel}"
    [[ ! -f "${dst}" ]] && continue
    if ! cmp -s "${src}" "${dst}"; then
      mkdir -p "$(dirname "${BACKUP_DIR}/.claude/agents/${rel}")"
      cp -p "${dst}" "${BACKUP_DIR}/.claude/agents/${rel}"
      echo "  saved .claude/agents/${rel}"
      backup_any=1
    fi
  done < <(cd "${TEMPLATES_DIR}/claude/agents" && find . -type f -print0)

  if [[ ${backup_any} -eq 0 ]]; then
    echo "  ✓ no overwrites — no backup needed"
    rmdir "${BACKUP_DIR}" 2>/dev/null || true
    BACKUP_DIR=""
  else
    echo "  backup saved to: ${BACKUP_DIR}"
  fi
  echo
fi

mkdir -p "${TARGET}/.claude/commands" "${TARGET}/.claude/agents"

rsync_commands_args=(-av --checksum)
[[ -n "${DRY_RUN}" ]] && rsync_commands_args+=(--dry-run --itemize-changes)
for pattern in "${commands_relative_excludes[@]+"${commands_relative_excludes[@]}"}"; do
  rsync_commands_args+=(--exclude="${pattern}")
done

rsync_agents_args=(-av --checksum)
[[ -n "${DRY_RUN}" ]] && rsync_agents_args+=(--dry-run --itemize-changes)
for pattern in "${agents_relative_excludes[@]+"${agents_relative_excludes[@]}"}"; do
  rsync_agents_args+=(--exclude="${pattern}")
done

echo "── 1. .claude/commands/ ──"
rsync "${rsync_commands_args[@]}" "${TEMPLATES_DIR}/claude/commands/" "${TARGET}/.claude/commands/"
echo

echo "── 2. .claude/agents/ ──"
rsync "${rsync_agents_args[@]}" "${TEMPLATES_DIR}/claude/agents/" "${TARGET}/.claude/agents/"
echo

echo "── 3. CLAUDE.md → Engram Memory Protocol ──"
if grep -q "Engram Memory Protocol" "${TARGET}/CLAUDE.md"; then
  echo "  ✓ already present, skip"
else
  if [[ -n "${DRY_RUN}" ]]; then
    echo "  (dry-run) would append $(wc -l < "${TEMPLATES_DIR}/records/engram-protocol.md") lines to CLAUDE.md"
  else
    printf "\n\n" >> "${TARGET}/CLAUDE.md"
    cat "${TEMPLATES_DIR}/records/engram-protocol.md" >> "${TARGET}/CLAUDE.md"
    printf "\n" >> "${TARGET}/CLAUDE.md"
    echo "  ✓ appended ($(wc -l < "${TEMPLATES_DIR}/records/engram-protocol.md") lines)"
  fi
fi
echo

echo "── 4. .gitignore → dev-workflow + stack entries ──"
GITIGNORE="${TARGET}/.gitignore"
if [[ -z "${DRY_RUN}" ]]; then
  touch "${GITIGNORE}"
fi
if [[ -f "${GITIGNORE}" ]] && grep -q "^# dev-workflow (session data)" "${GITIGNORE}"; then
  echo "  ✓ dev-workflow block already present, skip"
else
  if [[ -n "${DRY_RUN}" ]]; then
    echo "  (dry-run) would append dev-workflow session-data block"
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
fi

declare -a STACK_ENTRIES=()
[[ -f "${TARGET}/package.json" ]] && STACK_ENTRIES+=("node_modules/" "dist/" "*.tsbuildinfo" ".turbo/")
[[ -f "${TARGET}/next.config.js" ]] || [[ -f "${TARGET}/next.config.mjs" ]] || [[ -f "${TARGET}/next.config.ts" ]] && STACK_ENTRIES+=(".next/" "out/")
[[ -f "${TARGET}/Cargo.toml" ]] && STACK_ENTRIES+=("target/")
[[ -f "${TARGET}/pyproject.toml" ]] || [[ -f "${TARGET}/requirements.txt" ]] && STACK_ENTRIES+=("__pycache__/" "*.pyc" ".venv/" "venv/")

if [[ ${#STACK_ENTRIES[@]} -gt 0 ]]; then
  if [[ -f "${GITIGNORE}" ]] && grep -q "^# dev-workflow (stack-detected)" "${GITIGNORE}"; then
    echo "  ✓ stack block already present, skip"
  else
    if [[ -n "${DRY_RUN}" ]]; then
      echo "  (dry-run) would append stack block (${#STACK_ENTRIES[@]} entries considered)"
    else
      printf "\n# dev-workflow (stack-detected)\n" >> "${GITIGNORE}"
      for entry in "${STACK_ENTRIES[@]}"; do
        grep -qxF "${entry}" "${GITIGNORE}" || echo "${entry}" >> "${GITIGNORE}"
      done
      echo "  ✓ stack entries appended (${#STACK_ENTRIES[@]} entries considered)"
    fi
  fi
fi

echo
if [[ -n "${DRY_RUN}" ]]; then
  echo "✅ Dry-run complete. No changes written. Rerun without --dry-run to apply."
else
  echo "✅ Done."
  if [[ -n "${BACKUP_DIR}" ]]; then
    echo "   Backup of overwritten files: ${BACKUP_DIR}"
  fi
  echo "   Verify:"
  echo "     diff -rq ${TEMPLATES_DIR}/claude/commands ${TARGET}/.claude/commands"
  echo "     diff -rq ${TEMPLATES_DIR}/claude/agents ${TARGET}/.claude/agents"
  echo "     grep -c 'Engram Memory Protocol' ${TARGET}/CLAUDE.md  # должно быть 1"
fi
