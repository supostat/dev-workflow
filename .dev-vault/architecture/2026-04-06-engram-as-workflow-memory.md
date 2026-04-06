# Engram как единственный memory backend для workflow engine

Дата: 2026-04-06
Статус: принято

## Контекст

dev-vault имел два параллельных memory-слоя:
- **IntelligenceStore** — локальный JSON-граф паттернов (`.intelligence.json`), keyword ranker, collector
- **Engram** — опциональный daemon с Unix-socket API, semantic search, cross-project память

Оба делали одно и то же (хранение контекста сессий, паттернов, файловых правок), но не знали друг о друге. IntelligenceStore — 461 строка кода + 272 строки тестов. Engram — 153 строки (тонкий клиент).

Workflow engine (`WorkflowEngine.executeLoop`) не использовал ни один из них — агенты получали engram context только через vault section, а IntelligenceStore работал только в хуках.

## Решение

**Вариант B: Engram как workflow-aware layer.**

1. Создан `EngramBridge` — класс с `beforeStep()`/`afterStep()` для каждого шага workflow
2. Engine вызывает bridge ДО (search) и ПОСЛЕ (store) каждого шага
3. `StepState` получил `engramMemoryId` для parent_id chaining между шагами
4. IntelligenceStore удалён полностью (5 файлов, 461 строка)
5. Все хуки (`session-start`, `session-end`, `post-edit`, `post-task`) переведены на engram
6. MCP handlers (`intelligence_query`, `vault_knowledge`) переведены на engram
7. `engram` убран из `VaultSection` — context inject через engine variables

## Рассмотренные варианты

### A — Engram как primary backend (замена vault-файлов)
Убрать `.dev-vault/*.md` → всё в engram. Отклонён: жёсткая зависимость от daemon, теряется читаемость vault-файлов.

### B — Engram как workflow-aware layer (выбран)
Vault-файлы остаются как структурированное знание. Engram — обязательный участник pipeline. Fail-safe сохраняется.

### C — Двусторонняя синхронизация
IntelligenceStore ↔ Engram sync. Отклонён: два источника правды, гарантированные рассинхронизации.

## Последствия

- Без engram daemon pipeline работает — `beforeStep` возвращает `""`, `afterStep` возвращает `null`
- С daemon — каждый шаг получает cross-session контекст и записывает результаты
- Chaining через parent_id: read → plan → code → review → test → commit
- Failures сохраняются как `antipattern` records
- Connect timeout снижен до 500ms (достаточно для Unix socket)
- Удалено 733 строки кода (intelligence + тесты)
- Public API изменился: `IntelligenceStore`, `Collector`, `topN`, `syncFromVault` удалены из exports, добавлены `EngramBridge`, `engramJudge`

## Маппинг step → memory_type

| Step | Success | Failure |
|------|---------|---------|
| read | context | antipattern |
| plan | decision | antipattern |
| code | pattern | antipattern |
| review | pattern | antipattern |
| test | context | antipattern |
| commit | context | antipattern |
