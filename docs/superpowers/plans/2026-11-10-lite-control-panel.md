# Lampa Lite Control Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** С компьютера открыть LAN Admin UI и сохранять/проверять/откатывать настройки TMDB Proxy, существующих Jackett и TorrServer в готовом config-core.

**Architecture:** Один Node HTTP процесс, SQLite config-core, статическая vanilla JS панель. Runtime-таблицы в той же SQLite БД содержат разрешённые LAN origins и write-only secrets. Клиентский bridge, облегчение import graph и Compose — последующие небольшие планы общего Lite design; эта панель сама по себе ещё не меняет поведение Lampa.

**Tech Stack:** Node24.22.1/npm11.9.0, `node:http`, `node:fs`, существующие Ajv/SQLite, node:test; Chromium/Playwright для реальных UI flows. Без нового frontend framework, ORM и auth.

**Spec:** [Lampa Lite design](../specs/2026-11-10-lampa-lite-design.md), [config-core](../../config-system.md), [deployment](../../deployment.md).

## Global Constraints

- Новый scope пользователя: Lampa + TMDB + существующие Jackett/TorrServer. Настройки Jackett, включая key, сохраняются. Не заменять Jackett обязательным новым контейнером.
- LAN без login/session/pairing; stable deviceId — только адресация. Никаких auth prerequisites и открытого публичного deployment.
- Не выдумывать API существующего TMDB Proxy. Этот этап хранит URL/ref; не делает network probes/forwarding/metadata requests.
- Повторно использовать config schema/resolver/repository/service. Никакой второй базы/config JSON вместо revision system.
- Backend secret values не возвращаются в config/effective/export/error/log. SQLite runtime values plaintext с0600/0700, не заявлять encryption at rest.
- LAN HTTP origin opt-in — отдельное явное операторское действие, не поле managed JSON и не side effect config PUT. Если config PUT получает conflict, разрешение origin остаётся отдельным успешно выполненным действием; UI показывает их раздельно.
- Не менять app `src/`/player или удалять CUB в этом плане; следующий Lite-client план делает это с network acceptance. Не называть панель zero-CUB клиентом.
- Существующие tests/builds P01 и config-core не регрессируют. Известные legacy failures не скрывать.
- Существующая cloud checkout; no worktree. Commit/merge/push только в авторизованном scope, не делать release/image publication.

## Review Focus

- HTTP writes не теряют CAS/idempotency при timeout/retry — Task2 real HTTP test.
- Два runtime writes не теряют запись, транзакционный failure сохраняет прежнюю БД — Task1.
- Секреты и неизвестные property names не утекают через API/HTML/export/log — Task1/2/3.
- Браузерный конфликт не перезаписывает форму молча, retry сохраняет mutationId для того же payload — Task3.
- Static path traversal, cross-origin write и oversized bodies отклоняются; без generic fetch/proxy — Task2.

## Task 1: Runtime policy и write-only secret store

**Files:** Create `server/src/runtime/store.mjs`, `server/test/runtime/store.test.mjs`; modify `server/src/config/database.mjs` for migration2, update migration tests and test discovery retaining existing suites.

**Interfaces:** `createRuntimeStore(db)` → `{context, addSecret(value), secretStatus(), allowLanOrigin(origin), readSecret(ref)}`. db — тот же DatabaseSync, которым владеет entrypoint; store его не закрывает. `context` совместим с PolicyContext: providerIds содержит только tmdb, reviewedPlugins пустой, secretRefs/allowedLanOrigins загружаются из runtime tables. `addSecret` создаёт opaque UUID ref `secret:<id>`, возвращает только ref. Rotation создаёт новый ref, старый сохраняется для config rollback. `readSecret` — только внутренний backend API, не HTTP route.

Migration SQLite user_version1→2 добавляет `runtime_secrets(ref PRIMARY KEY,value,created_at)` и `runtime_lan_origins(origin PRIMARY KEY)` в транзакции, не меняя managed JSON schemaVersion1 и прежние revisions. Создание/reopen не сбрасывает данные; version>2 отклоняется. Database/data directory защищены0600/0700 до приёма запросов. Политический context обновляется только после успешного commit; один активный server process, SQLite сохраняет атомарность и при нескольких соединениях. Полный SQLite backup включает config+runtime; не создавать второй набор JSON-файлов для этих данных.

- [x] RED tests: create→write2secrets→close/reopen refs доступны context, public statuses не содержат values, DB имеет нужные permissions, два соединения сохраняют обе записи; migration1→2 сохраняет прежние config revisions.
- [x] RED tests origin: canonical HTTP origin без userinfo/query/path/fragment; только literal RFC1918 privateIPv4 или явно выбранный host `.local` (DNS/proxy безопасность не обещается). Loopback допускается лишь при отдельном `allowLoopbackForDevelopment` constructor option для tests/local dev; link-local/metadata/publicIP/https-as-HTTP-policy отклоняются.
- [x] Реализовать store с SQLite parameterized writes и context update только после успешного commit. addSecret max16KiB; никаких ключей в exception message.
- [x] Fault test через test-owned SQLite trigger RAISE(ABORT): запись не появляется, прежние данные и context сохраняются. Backup→restore временной БД восстанавливает refs/values/origins и старые config revisions вместе. Не добавлять production failpoints.
- [x] GREEN tests runtime+existing config; clean npm ci не меняет lock.

## Task 2: LAN HTTP API и static serving

**Files:** Modify `server/src/config/service.mjs`/service tests for the optional validator; create `server/src/http/server.mjs`, `server/src/http/config-routes.mjs`, `server/src/http/static.mjs`, `server/src/main.mjs`, `server/test/http/config-api.test.mjs`; modify server package scripts (`start`,`test`).

**Interfaces:** `createHomeServer({repository,service,runtimeStore,adminRoot,clientRoot,allowedHosts})` возвращает Node Server; entrypoint владеет DB/store close и signal shutdown. Local default HOST127.0.0.1, PORT8080; env DATABASE_PATH и RUNTIME_DIRECTORY. Route prefix `/v1` по существующему документу.

| Endpoint | Контракт |
|---|---|
| GET `/healthz`, `/readyz` | local process / DB readiness; внешние сервисы не вызываются |
| GET `/v1/admin/config/schema` | machine schema |
| GET/PUT `/v1/admin/config/global` | `{document,revision}`, strong ETag `"r-<n>"`; absent revision0 возвращает пустой global document |
| GET/PUT `/v1/admin/devices/{id}/config` | такой же envelope, scope/deviceId проверяются |
| POST `/v1/admin/config/validate` | `{scopeKey,document}`, read-only preview |
| GET `/v1/admin/config/revisions?scopeKey=...&beforeRevision=...&limit=...` | история без secrets |
| POST `/v1/admin/config/rollback` | `{scopeKey,targetRevision,reason?}` + If-Match/Idempotency-Key |
| GET `/v1/devices/{id}/config` | effective values + revision vector global/device; ETag от обоих revisions, If-None-Match→304; backend secret refs не являются raw values |
| POST `/v1/admin/secrets` | `{value}`, write-only, возвращает ref и status; ни GET raw, ни overwrite-by-ref |
| GET `/v1/admin/secrets/status` | только refs+configured flags |
| POST `/v1/admin/lan-origins` | `{origin}`: отдельный opt-in, после этого config PUT не должен повторно менять policy |
| GET `/v1/admin/lan-origins` | разрешённые origins, без secret values |

PUT получает полный managed document, reason из отдельного header не нужен (null), actorId фиксирован `lan-admin`. Missing If-Match→428, stale→412+currentRevision, missing/invalid Idempotency-Key→400. Для PUT ключ связывается с одним payload/revision; rollback отдельный operation discriminator. Остальные ошибки:400 malformed/scope,413 size,422 schema/policy,409 idempotency mismatch,404,503 BUSY. Error `{code,message,requestId,issues?,currentRevision?}` без SQL/входных credential values.

- [x] RED real HTTP tests на ephemeral port + file DB: GET revision0, validate, PUT, duplicate retry, stale CAS, rollback, reopen, effective global+override и304.
- [x] RED body tests: limit262144bytes до parse, invalid JSON/content-type, unknown routes/methods; error не содержит вводимый key/password/URL.
- [x] Реализовать bounded body reader/timeouts, server.close/DB lifecycle, route decoding и scope validation. Не включать open CORS: write Origin должен совпадать с разрешённым Admin origin; Host проверяется по runtime allowedHosts. Non-browser запрос без Origin допустим для LAN tools. Для будущего packaged TV отдельно спроектировать read-only CORS; не ставить wildcard credentialed CORS.
- [x] Static `/admin/` из adminRoot, `/app/` из готового clientRoot; только GET/HEAD, realpath containment и traversal tests включая encoded separators/symlinks. Никаких filesystem paths из JSON request.
- [x] Добавить обратно совместимый optional `additionalValidator(values):ValidationIssue[]` в `createConfigService`, default `()=>[]`. Он вызывается в существующем validation callback **внутри write transaction** для каждого проверяемого effective config: candidate global и все device overrides либо candidate device с current global. Тот же callback используется rollback; advisory preview не заменяет его. Добавить tests generic default unchanged, valid первый/unsupported последний device, concurrent state change после preview и до publish.
- [x] Подключить `validateLiteValues` как additionalValidator; также проверять effective GET по согласованным heads. Нельзя реализовать это только отдельной preflight проверкой HTTP handler. Для unsupported issues API даёт422 UNSUPPORTED_CAPABILITY, не возвращая unsafe effective snapshot. Lite policy: tmdb-only metadata, jackett-only parser; sync/plugins=true, непустые generic plugins/sources и другие providers →422 UNSUPPORTED_CAPABILITY. Неверный legacy head не фильтруется молча и не выдаётся как valid effective. RED tests для archive→rollback и effective; `/admin/` читает исходный документ для явного исправления.
- [x] GREEN HTTP+config/runtime tests; проверка чистого shutdown и persistence после restart.

## Task 3: Панель настройки с компьютера

**Files:** Create `server/admin/index.html`, `server/admin/admin.js`, `server/admin/admin.css`; browser tests `server/test/browser/admin.spec.mjs` и отдельный command `test:browser` без смешивания Node/Vitest discovery; update docs/development and config-system.

**Interfaces:** UI использует только API Task2, same-origin fetch, `textContent` для server values. Ввод global/device scope, deviceId, TMDB Proxy URL, Jackett URL/key, TorrServer URL, язык metadata, UI theme/density/animations. Form строит полный документ из загруженного snapshot, сохраняя неизвестные форме, но известные schema поля. Для device unset удаляет override, не создаёт дублирующий global snapshot.

Jackett key: write-only password input → POST secret → новый credentialRef; пустое поле сохраняет старый ref, «убрать ключ» удаляет ref только из нового config snapshot. Старый секрет не уничтожается неявно; ещё ссылающиеся revisions должны оставаться откатываемыми. Metadata key аналогично, если нужно сохранить ref; actual transport пока отсутствует.

Разрешение LAN HTTP origin — отдельная кнопка с собственным результатом, а не скрытая операция внутри Save. Save не запускает сетевые проверки или загрузку plugin code. Интерфейс показывает «подключения сохранены; client bridge ещё не подключён», пока это правда.

- [x] RED browser tests: открыть панель, заполнить3URL, добавить fake Jackett key, явно разрешить нужные LAN origins, validate/save, reload и увидеть сохранённые значения без raw key.
- [x] RED browser tests: два browser contexts создают CAS conflict, второе редактирование не теряется; rollback возвращает прошлую версию; device inheritance/unset; invalidURL inline error; серверный текст с HTML не исполняется.
- [x] Реализовать минимальную доступную форму: labels/tab focus, status/error, отдельные validate/save, history/rollback и JSON export/import preview. Без login/signup, dashboard charts, визуального plugin store и произвольного JSON исполнения.
- [x] Export — managed config без raw secrets и portable placeholders вместо машинных refs; импорт связывает refs явно и проходит обычный preview+PUT, не загружает plugins. Реализовать refs remapping UI либо явно блокировать import с unresolved refs; не молча удалять их.
- [x] GREEN browser flow с реальным backend/file DB и локальным Chromium; mocks только вместо отсутствующих внешних сервисов, которым здесь не делаются запросы. Сохранить screenshot панели для review.
- [x] Интеграционная проверка: все backend/helper tests, обе P01 сборки, известный root Vitest baseline отдельно. CI добавить HTTP/runtime tests и отдельный browser job с официальным Chromium install; root outputs не публиковать.

## После этого плана

Отдельный Lite-client plan: config bridge, Jackett connector, MetadataProvider после аудита Proxy, local-state migration, удаление CUB/лишних модулей и zero-CUB browser capture. Затем Delivery plan: один Compose сервис, `setup.sh`, backup/restart/upgrade, ARM64 и локальный IPK wrapper. Ни один из этих результатов не считается реализованным только по готовой панели.

## Self-review и исполнение

Три задачи выдают проверяемые deliverables: persisted runtime store → real HTTP API → browser UI. Существующие core interfaces сохранены, write trust scope соответствует выбранной LAN без auth; нет незаявленного backend Proxy API. API/save, secret registration и LAN-origin opt-in намеренно отдельные операции и явно показаны в UI. Runtime SQLite plaintext ограничения и secret rollback retention задокументированы.

Предложение исполнения: Terra medium implementation и spec/quality review; Sol medium только финальный review. Реализовывать после review Lite design и этого первого плана; новые approvals между задачами не требуются. Это новый scope удаления возможностей, поэтому до review продукта/source pruning не выполняется.


### Границы миграции и client подключения

Этот control-panel этап не читает клиентский localStorage, не меняет старые Jackett/TorrServer settings и не объявляет credentials transport готовым. Следующий client план обязан добавить optional schema поля для secondary Jackett/selection/interview и TorrServer auth/selection/GST/timecode до миграции. До этого существующие подключения продолжают жить в прежнем клиенте. TV manual Pi URL и read-only packaged-Origin opt-in из Lite design включаются в client план; Admin API в этом плане same-origin, не заявляется пригодным для произвольного file-origin клиента.


## Результат исполнения первого этапа

Реализованы runtime SQLite migration2, immutable secret refs и LAN-origin registry, Node HTTP API, read-only effective settings/ETag, same-origin Admin UI на русском, validate/save/conflict/retry, explicit enablement/inheritance, история/rollback, перенос JSON без raw keys и CI browser job. Это control panel, не завершённый Lite клиент.

Проверено:54 backend tests,10 build-helper tests,13 browser checks в запуске со screenshot. Browser включает отсутствие structuredClone/randomUUID, clear/off/re-add/on для обоих подключений, device inheritance, конфликты и потерянный ответ после создания ключа (один secret POST/идентичные повторные PUT), real HTTP HTML reason rendering и export без raw secret. Root клиентские сборки воспроизводимы; protected src/public/index/plugins/schema/build inputs не изменены. Известный Vitest baseline остаётся127 passed,1 failed test,1 suite collection failure. Remote CI ещё не запускался в ходе этой проверки.

Независимый smoke с реальным entrypoint/browser на loopback и удалёнными secure-context APIs прошёл validate/save/reload/export без утечки ключа. Прямой non-loopback HTTP smoke в этой Cloud среде получил proxy403 Domain forbidden, не response приложения; обход proxy не выполнялся. Реальный Pi/LAN hardware acceptance остаётся непроверенным.

Реализация и task spec/quality reviews — Terra medium; общий final review — Sol medium. Замечания исправлены и повторно проверены; открытых findings нет. Implementer не эскалировался на более тяжёлую модель. Доказательства/скриншот сохранены в игнорируемом .superpowers/sdd/lite-panel/.

### Решения и риски

- Не менять permissions произвольного существующего parent DATA path. Требуется принадлежащий процессу private directory или создаётся новый. Риск: неверно подготовленный путь приводит к понятной ошибке запуска вместо скрытого chmod.
- createRuntimeStore получил options.allowLoopbackForDevelopment=false по умолчанию; opt-in только для local tests/dev. Риск: небольшой дополнительный внутренний API, loopback в production policy не разрешается автоматически.
- Admin same-origin-only: исключены ALLOWED_ORIGINS и обещание отдельного frontend origin. Риск: сторонний origin требует отдельного будущего CORS feature; на сценарий страницы/API одного Pi это не влияет.
- enabled для Jackett/TorrServer редактируется явно, а не выводится из URL. Риск: два дополнительных элемента формы; зато нет скрытого включения и re-add dead-end.

Runtime secrets plaintext в защищённой0600/0700 SQLite, не encryption at rest; потерянный response secret POST может оставить unused ref, предыдущие секреты не уничтожаются. Auth по решению пользователя отсутствует. Client bridge, Jackett/TMDB/TorrServer transport, CUB cleanup, Compose/setup и IPK этим планом не реализованы. Следующие шаги описаны в Lite design.
