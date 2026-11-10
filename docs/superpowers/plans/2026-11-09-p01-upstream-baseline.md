# P01 Upstream Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Импортировать закреплённые исходники Lampa и получить проверяемые сборки web/webOS из чистого checkout.

**Architecture:** Настоящий небольшой fork в корне текущего репозитория, без загрузки latest при сборке. Сохранить upstream UI/API; изменить только orchestration сборки и фиксацию toolchain. Сервер, CUB-removal и IPK wrapper — следующие этапы.

**Tech Stack:** Существующие JavaScript, Gulp 4, Rollup 2, Babel, Sass, Vitest; Node.js 24.22.1 и npm 11.9.0 — стартовые версии, уже установленные в среде. Если обнаружится несовместимость, сначала подтвердить причину и выбрать поддерживаемую Node LTS, не обновлять весь dependency graph ради ошибки.

**Spec:** [architecture.md](../../architecture.md), [roadmap.md — P01](../../roadmap.md), [upstream-audit.md](../../upstream-audit.md).

## Global Constraints

- Upstream: `https://github.com/yumata/lampa-source`, SHA `86c2b099b19f7058ea304dfa43a8b1e18a2e0492`, Manifest 3.4.6.
- Существующие пользовательские документы и Git metadata сохраняются; никакого reset, нового worktree, push, commit или MR.
- Не менять runtime поведения приложения, не добавлять backend, не выдумывать API TMDB Proxy.
- Не исправлять независимые upstream defects ради зелёного отчёта: зафиксировать команду/вывод и границу причины.
- Сохранить upstream LICENSE и package license metadata; конфликт GPLv2/ISC оставить release blocker, не выбирать лицензию самостоятельно.
- Не отключать TLS/checksum/signature verification при установке.
- Один implementer Terra medium; spec и quality review Terra medium последовательно; coordinator Sol low, повышение только по конкретной причине. Luna для этого этапа не подходит: есть неизвестное поведение legacy build.

## Review Focus

- Чистый checkout без dest/build: сборка должна сама создавать prerequisite bundle.
- Ошибка Rollup или отсутствующий output не должна завершаться ложным success.
- Две сборки с одинаковым SOURCE_DATE_EPOCH должны иметь одинаковые content hashes; разные даты не должны влиять на воспроизводимый режим.
- Генерация lang/css/manifest не должна оставлять неожиданные изменения исходников или подхватывать старые outputs.
- Импорт не перезаписывает документы; npm ci использует committed lockfile, а не обновляет его.

## Task 1: Закреплённый импорт и toolchain

**Files:**
- Create: upstream `src/`, `plugins/`, `public/`, `index/`, `spec/`, `UPGRADE.md`, `LICENSE`, `gulpfile.js`, `package.json`, `.gitignore` и остальные tracked исходные файлы из указанного SHA.
- Preserve: текущий `README.md`, восемь файлов `docs/*.md`, `docs/superpowers/` и `.git/`.
- Create: `docs/upstream/README.md` — исходный root README, `upstream.json`, `.node-version`, `package-lock.json`.
- Modify: `.gitignore` — отслеживать lockfile; игнорировать только outputs/dependencies и локальные настройки.

**Interfaces:**
- Consumes: Git tree указанного SHA, текущие пользовательские файлы.
- Produces: root source tree; `upstream.json` с `repository`, `commit`, `appVersion`; `npm ci` с фиксированным dependency graph.

- [x] Сначала составить список конфликтов путей. При неожиданном существующем файле сохранить его и остановить только конфликтующий импорт, без overwrite.
- [x] Экспортировать tracked файлы из точного SHA без чужого `.git`; upstream docs объединить по свободным путям, root README сохранить отдельно.
- [x] Записать provenance/toolchain; создать lockfile проверяемой npm installation, сохранить integrity entries. Не менять ranges зависимостей без подтверждённой несовместимости.
- [x] Проверить импорт сравнением исходных файлов с pinned tree: допустимые отклонения только явно изменённые build/config/readme файлы. Проверить сохранность существующих docs.
- [x] Выполнить `npm ci --no-audit --no-fund` повторно: success, lockfile не меняется. Уязвимости не скрывать: аудит зависимостей — отдельный отчёт, не автоматический npm audit fix.

## Task 2: Конечная проверяемая сборка

**Files:**
- Modify: `gulpfile.js`, `package.json` — только build orchestration.
- Create: `scripts/build.mjs`, `scripts/check-build.mjs`, `scripts/build.test.mjs`.

**Interfaces:**
- Consumes: upstream Gulp tasks и npm dependencies.
- Produces: `npm run build:web`, `npm run build:webos`; выходы `build/github/lampa/` и `build/webos/`.
- `scripts/build.mjs <web|webos>`: invalid target → nonzero; не запускает watch/server; чистит только выбранные generated outputs.
- `scripts/check-build.mjs <web|webos>`: проверяет свежие непустые index.html/app.min.js, CSS/lang и требуемые локальные assets по фактическому index; missing/stale artifact → nonzero.

- [x] Создать `node:test` проверки: неизвестный target отклоняется; проверка артефактов отклоняет missing/empty bundle; fixture корректного дерева принимается. Сначала выполнить `node --test scripts/build.test.mjs` и убедиться, что отсутствие реализации даёт ожидаемую ошибку.
- [x] Исправить `merge`: вернуть stream и передать ошибки runner, а не вызвать done раньше завершения Rollup. Проверить global uncaughtException handler: build mode обязан возвращать nonzero при необработанной ошибке, dev mode не менять без причины.
- [x] Экспортировать конечный `prepare` task для bundle/Sass/lang и вызывать перед существующими pack tasks. Не делать build через watcher или sleep.
- [x] Поддержать SOURCE_DATE_EPOCH для build timestamp и assembly time; при unset сохранить upstream current-time поведение. Воспроизводимый режим использует UTC, invalid epoch → понятный nonzero, без тихой замены текущим временем.
- [x] Реализовать runner/checker и package scripts; не отключать Rollup errors и не принимать один exit code без output validation.
- [x] Добавить проверки invalid epoch, error propagation и stale output; выполнить `node --test scripts/build.test.mjs` — все проверки действительно исполнены и завершены.
- [x] Выполнить web и webOS build из отсутствующих generated directories. Сравнить два чистых build при одном SOURCE_DATE_EPOCH по SHA-256 всех outputs; отличия исследовать, не объявлять сборку воспроизводимой по одному успеху.

## Task 3: CI и developer runbook

**Files:**
- Create: `.github/workflows/build.yml`, `docs/development.md`.
- Modify: `README.md` — краткое описание Home и ссылки на документацию.

**Interfaces:**
- Consumes: npm ci, node:test, существующий Vitest suite и оба build scripts.
- Produces: CI с теми же проверками и инструкции работы из корня checkout.

- [x] Выполнить `npx --no-install vitest run --threads=false`; записать реальные suites/tests/passed/failed. Не использовать watch и не считать zero tests успехом. Изменения product tests вне scope.
- [x] CI: checkout, pinned Node/npm, `npm ci`, build helper tests, Vitest, оба clean builds и artifact validation с фиксированным SOURCE_DATE_EPOCH. Не запускать публикацию images/IPK.
- [x] Документировать build/dev/test команды, output paths, ограничения (CUB ещё присутствует, webOS build ещё не IPK, лицензии не разрешены, Proxy не интегрирован).
- [x] Финальная проверка `git diff --check` плюс inventory tracked/untracked, сравнительный аудит импорта; никаких секретов и node_modules/build artifacts в предполагаемом diff.
- [x] Spec compliance review Terra medium; после исправлений отдельный quality review Terra medium. Исправлять только подтверждённые замечания текущего scope; повторять затронутые проверки.

## Handoff и границы разрешения

Пользователь разрешил начать реализацию требований. Этот документ конкретизирует первый этап прежнего roadmap; согласно invoking writing-plans нужен review плана перед product changes. До этого шага выполнены только чтение и запись плана, установка зависимостей и импорт не выполнялись. Следующее действие после review — Terra implementer P01, без дополнительных вопросов о моделях/методе и без commits/MR. Исходный roadmap остаётся планом следующих этапов.

## Self-review

План покрывает P01: provenance, toolchain/lock, clean pack prerequisites, error exits, artifact inventory, deterministic timestamps, existing tests и CI. Не включает независимые P02–P28. Главные неопределённости — разрешение текущего npm graph и существующие upstream test failures — определяются исполнением, а не предположениями. Изменение runtime или licensing не разрешается как обход build failure.


## Результат исполнения P01

Импорт, сборка и CI выполнены без commit/MR. Финальные build helper tests: 10/10. Обе clean сборки воспроизводимы (172 web /164 webOS files); source input hashes 949 файлов не меняются при finite build. У upstream остаются 1 failed test и 1 suite import failure: 127 passed. CI сохраняет этот nonzero exit; не утверждается, что весь проект green. GitHub Actions и реальный TV не запускались.

Реализация и task reviews: Terra medium. Финальный общий review: Sol medium, единственный дополнительный уровень reasoning для проверки интеграции по согласованному routing. Все найденные Important замечания исправлены и повторно проверены, без эскалации implementer.

### Решения координатора и риски

- Работа в существующей cloud checkout без worktree/commit по утверждённому плану; риск — до commit результаты существуют только в этой среде.
- Cloud scripts навыка недоступны: использованы локальные briefs/ledger/diff packages; риск — служебные файлы нужно сохранить для восстановления работы. Они находятся в игнорируемом `.superpowers/sdd/p01/`, пока commit запрещён, evidence не удаляется.
- Известные upstream test failures сохранены, CI regression job честно падает; риск — его общий статус остаётся red до отдельного исправления.
- Недостающие static assets добавлены из закреплённой официальной сборки с provenance/hashes; риск — дополнительный источник ресурсов при upstream обновлениях и нерешённые лицензионные обязательства.
- Vitest ограничен всеми существующими `spec/**/*.spec.js`, node:test запускается отдельно; риск — будущие Vitest тесты вне этой директории требуют изменения discovery.

Подробные команды, TDD evidence и scoped review reports сохранены в `.superpowers/sdd/p01/`. Разработка следующего этапа не входит в этот execution report. См. [development](../../development.md) для команд.
