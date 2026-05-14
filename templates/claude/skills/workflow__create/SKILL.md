---
name: workflow:create
description: Interactive workflow definition wizard: collects workflow YAML through Q&A, then persists to .dev-vault/workflows/<name>.yaml via the workflow_create MCP tool. Session-start hook auto-generates the slash shim on next restart.
allowed-tools: [mcp__dev-workflow__workflow_create]
invocation: user
---

# /workflow:create — Create a custom workflow via interview

Интерактивный опросник, собирающий определение workflow через Q&A, затем сохраняющий его через MCP-инструмент `workflow_create` в `.dev-vault/workflows/<name>.yaml`.

**Инвариант:** MCP пишет ТОЛЬКО YAML в `.dev-vault/workflows/`. Shim `.claude/commands/workflow/<name>.md` создаётся session-start hook'ом автоматически при следующем запуске Claude Code (см. task-005).

## Procedure

### Step 0: Engram search (memory lookup)

Вызови:
`mcp__dev-workflow__memory_search({ query: "workflow pattern steps agents " + $ARGUMENTS, limit: 5 })`

Отметь антипаттерны из выдачи. При недоступности engram — продолжай без него (fail-safe).

### Step 1: Gather workflow intent

Спроси у пользователя:

1. **Name** — lowercase kebab-case, 1-64 символа, regex `^[a-z0-9][a-z0-9_-]{0,63}$`. Перед вопросом выполни Glob `.dev-vault/workflows/*.yaml` и покажи список существующих имён, чтобы избежать коллизий.
2. **Description** — одна фраза: для чего workflow, что автоматизирует.
3. **Match patterns** (опционально) — glob-паттерны для авто-роутинга free-form input через `/intake`, например `*.sql`, `packages/contracts/**`. Если не нужно — "пропустить".

### Step 2: Gather steps iteratively

Для каждого шага спроси:

- **Step name** (kebab-case)
- **Agent** — один из: `reader`, `planner`, `coder`, `reviewer`, `tester`, `committer`, `plan-reviewer`, `verifier`, или кастомный из `.dev-vault/agents/`.
- **Gate** — пронумерованный выбор:
  1. none (default)
  2. user-approve
  3. tests-pass
  4. review-pass
  5. custom-command (потребует `gateCommand`)
- **onFail** (опционально) — имя шага, к которому откатиться при провале gate; default: null.
- **input** (опционально) — список ссылок на выходы предыдущих шагов, например `[read.output, plan.output]`.
- **Дополнительно** (опционально):
  - `stepFile` — путь к кастомному step-prompt внутри `.dev-vault/workflow-steps/` или `templates/`.
  - `subagent` — один из `Explore`, `Full`, `bash`.
  - `outputBlock` — имя финального блока в UPPER_SNAKE_CASE.

После каждого шага: "Добавить ещё один шаг? (yes/no)". Повторяй пока не "no".

### Step 3: Show summary (plain markdown, NOT code fence)

Выведи как обычный markdown (не оборачивай в ```):

## Workflow Summary

- **Name:** `<name>`
- **Description:** `<description>`
- **Match:** `[<patterns>]` или —
- **Steps:** `<N>`

| # | name | agent | gate | onFail | input |
|---|------|-------|------|--------|-------|
| 1 | read | reader | none | — | — |
| 2 | code | coder | review-pass | code | [read.output] |

**Проверки перед сохранением:**

- Все `onFail` ссылаются на существующие шаги (иначе сообщи об ошибке и вернись к Step 2).
- Если в шагах есть `coder` или `committer`, но нет `vault-updates` — предупреди пользователя: "Рекомендую добавить шаг `vault-updates` для синхронизации с vault. Продолжить как есть?"

Спроси: "Сохранить workflow? (1=да / 2=редактировать / 3=отменить)"

### Step 4: Persist via MCP tool

При подтверждении вызови:

`mcp__dev-workflow__workflow_create({ name, description, match, steps })`

Ожидаемый успех: `{ filepath: ".dev-vault/workflows/<name>.yaml" }`.

Выведи (plain markdown, не в code fence):

✓ Workflow сохранён → `<filepath>`

**Активация:** перезапусти Claude Code — session-start hook (task-005) автоматически сгенерирует shim `.claude/commands/workflow/<name>.md`, и команда `/workflow:<name>` станет доступна как first-class slash command.

До перезапуска workflow можно запустить через:
- CLI: `dev-workflow run <name> "task"`
- Параметрически: `/workflow:dev --task <id>` (если совместим)

### Step 5: Engram store (pattern memory)

Вызови:

`mcp__dev-workflow__memory_store({
  type: "pattern",
  context: "Custom workflow created: <name> — <description>. Steps: <summary>. Used for: <intent>",
  action: "workflow_create",
  result: "Saved to <filepath>",
  tags: ["workflow", "custom", "<name>"]
})`

При недоступности engram — продолжай без него (fail-safe).

## Rules

- Workflow name ОБЯЗАН соответствовать regex `^[a-z0-9][a-z0-9_-]{0,63}$` — опросник валидирует ДО вызова MCP.
- Требуется минимум 1 шаг.
- `onFail` должен ссылаться на уже определённый в этом workflow шаг — проверка в Step 3 перед сохранением.
- При использовании агентов `coder` или `committer` — рекомендуй добавить шаг `vault-updates` (warning в Step 3).
- Summary выводится как обычный markdown — НИКОГДА не оборачивай его в code fence.
- User-facing вывод на русском (по соглашению проекта для интерактивных Claude Code команд). Protocol-блоки (таблицы, вызовы MCP) — на английском.
