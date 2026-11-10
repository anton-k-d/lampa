# Central Configuration Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Получить проверяемое ядро управления настройками Home: валидируемые global/device документы, атомарное сохранение в SQLite, история версий и безопасный откат.

**Architecture:** Отдельный Node-пакет `server/` с библиотекой конфигурации, без HTTP listener. Общая JSON Schema лежит вне upstream `src/`; сервер не изменяет клиентский Storage. Следующие P06–P09 добавят авторизацию, pairing и Config API поверх этого ядра.

**Tech Stack:** Node.js 24.22.1, npm 11.9.0, ESM JavaScript, встроенный `node:sqlite` DatabaseSync, Ajv Draft 2020-12 + ajv-formats, node:test. Без web framework, ORM, TypeScript toolchain и внешнего сервера БД.

**Spec:** [config-system.md](../../config-system.md), [architecture.md](../../architecture.md), [roadmap.md](../../roadmap.md), [результаты P01](2026-11-09-p01-upstream-baseline.md).

## Статус и место в roadmap

Предложение следующего этапа после P01, дата 2026-11-10. Этот файл — план, не реализация. Пакет `server/` и схема ещё не создавались. Проверено read-only: установлен Node v24.22.1, `node:sqlite` открывает in-memory БД, версия SQLite 3.53.4; это проверка текущей x86-среды, не ARM64/Pi acceptance.

Покрывает config-часть P03 и P05. Чистая функция объединения managed settings выделяется заранее из будущего P08, потому что до сохранения global revision нужно проверить её совместимость со всеми сохранёнными device overrides. HTTP effective endpoint, пользовательские предпочтения и client bootstrap остаются в P08/P09. Контракты state/metadata из P03 остаются отдельными задачами.

### Почему этот этап

- **Config core — рекомендовано:** двигает нас к централизованному управлению, проверяется локально, не требует неизвестного Proxy или TV.
- **Network baseline P04:** важен перед удалением CUB; может следовать отдельно. Сам по себе не создаёт механизм управления настройками.
- **webOS wrapper P21:** даст устанавливаемую оболочку, но без Config API не решит управление с Pi и пока требует проверки устройства.

Выбор config core — предложение координатора, а не утверждение, что пользователь уже согласовал новую реализацию. Нужен один review этого плана перед исполнением, без повторного выбора архитектуры всего проекта.

## Global Constraints

- Сохраняем текущую воспроизводимую сборку Lampa 3.4.6; не менять `src/`, `public/`, `index/`, `plugins/`, существующий gulpfile и legacy dependency graph.
- Работаем в существующей облачной checkout. Не создавать Git worktree. Не делать commit/push/MR без отдельного разрешения.
- Все документы конфигурации: `schemaVersion: 1`; global без deviceId, device с deviceId. JSON Schema — Draft 2020-12 из config-system.md, без несовместимой самовольной урезки.
- Objects merge по ключу, массивы заменяются целиком, `lockedPaths` — union global/device; null запрещён. Отсутствующее поле device наследует global/default.
- Managed config, local preferences, пользовательское состояние и backend secrets — разные данные. В новой БД храним только managed config и его revision metadata, секреты — только ссылки `secret:...`.
- Никаких сетевых проверок URL, загрузки плагинов, TMDB/CUB запросов, HTTP-сервера, админки, pairing, sync, Docker Compose и переноса history/progress в этом этапе.
- Не выдавать core за работающий Config API или простой installer Pi; для них остаются P06–P09/P23–P24.
- Никаких отключений TLS/integrity проверок и broad dependency upgrades. Backend dependencies и lockfile изолированы в `server/`.
- Известные upstream Vitest failures не исправлять и не скрывать в этом плане: 127 passed, 1 failed test, 1 suite import failure. Новые backend tests должны проходить независимо.
- SQLite WAL на локальном диске, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=FULL`; БД не в Git, не на сетевом mount.

## Review Focus

1. Некорректный/слишком большой JSON и prototype keys не должны менять входные данные или БД — tests Task 1/2.
2. Два writer с одной baseRevision: ровно один commit, второй conflict — Task 3 real-file/two-connection test.
3. Потерянный ответ и повтор mutationId после restart не создают вторую revision; иной payload под тем же ID — conflict — Task 3.
4. Global update может сделать ранее допустимый device override невалидным: отказ всей операции без частичных записей — Task 4.
5. Rollback на старую версию не обходит текущую validation policy и всегда создаёт новую revision — Task 3/4.

## Структура файлов и публичные границы

| Файлы | Ответственность |
|---|---|
| `schemas/managed-config.v1.schema.json` | Единственный machine-readable контракт документа |
| `server/package.json`, `server/package-lock.json` | Изолированные runtime/test зависимости |
| `server/src/config/validation.mjs` | Структурная валидация без mutation/coercion и форматирование ошибок |
| `server/src/config/resolve.mjs` | Managed merge/defaults и семантическая policy-проверка |
| `server/src/config/canonical.mjs` | Детерминированный JSON и SHA-256 для content/request hashes |
| `server/src/config/database.mjs` | SQLite schema migration, WAL/connection lifecycle |
| `server/src/config/repository.mjs` | Транзакции revision/head/idempotency, чтение и rollback |
| `server/src/config/service.mjs` | Оркестрация validation внутри транзакции, включая все device overrides |
| `server/test/config/*.test.mjs` | Реальные tests schema/resolver/SQLite/service |
| `server/test/fixtures/` | Минимальные валидные/невалидные documents без секретов |
| `.github/workflows/build.yml`, `docs/development.md` | Независимый backend job и команды |

Общие типы в JSDoc, без отдельного types-only пакета:

- `ScopeKey`: `global` или `device:<deviceId>`, один canonical способ представления; document.scope/deviceId должны совпадать с ключом.
- `Revision`: безопасное целое ≥1, глобальная последовательность revision IDs; 0 означает отсутствие head данного scope.
- `Snapshot`: `{revision,scopeKey,document,contentHash,parentRevision,restoredFrom,actorId,reason,createdAt}`. Последние nullable значения задаются явно; createdAt — серверный UTC ISO string.
- `ValidationIssue`: `{path,code,message}`, path — JSON Pointer; сообщения без исходных credential values/полного URL.
- `PolicyContext`: `{providerIds:Set<string>, secretRefs:Set<string>, reviewedPlugins:Map<string,{url,sha256,minClientVersion}>, allowedLanOrigins:Set<string>}`. Значения поставляются доверенным будущим backend, не берутся из пользовательского документа. По умолчанию все sets/maps пусты.
- `ConfigError`: Error с `code`, `issues?`, `currentRevision?`. Codes: `INVALID_CONFIG`, `REVISION_CONFLICT`, `IDEMPOTENCY_MISMATCH`, `NOT_FOUND`, `BUSY`, `UNSUPPORTED_DB_VERSION`. Не возвращать SQL/секреты в публичном message.

## Task 1: Исполняемая схема и строгая валидация

**Files:** Create schema, `server/package*.json`, `server/src/config/validation.mjs`, `server/test/config/validation.test.mjs`, fixtures.

**Interfaces:**
- `parseConfigDocument(text:string): ConfigDocument`: до JSON.parse проверяет UTF-8 размер ≤262144 bytes; ошибки преобразует в INVALID_CONFIG.
- `validateConfigDocument(value:unknown): {valid:boolean,issues:ValidationIssue[]}`; не меняет input.
- Пакет private ESM; `npm --prefix server test` вызывает `node --test test/config/*.test.mjs`. Ajv 8 c поддержкой Draft 2020-12 и ajv-formats 3 фиксируются в отдельном lockfile. При реализации выбрать актуальные совместимые patch versions через registry и сохранить exact versions; версия dependency не является частью wire protocol.

- [x] Перенести schema из config-system.md и два существующих global/device примера в fixtures. Проверить синхронность markdown и schema; после переноса markdown ссылается на machine-readable файл вместо второго полного расходящегося определения.
- [x] Написать failing tests: global example valid; device example valid; global+deviceId invalid; device без deviceId invalid; schemaVersion=2, unknown root field, null, неверная URI, лишний секрет `apiKey` → invalid. Объект после validate deepEqual исходной копии.
- [x] Добавить tests parse: 262145 ASCII bytes → INVALID_CONFIG; 262144 bytes валидного JSON с padding принимаются; многобайтовые строки считаются в bytes; malformed JSON → безопасная ошибка без исходного body.
- [x] Запустить `npm --prefix server test` и записать ожидаемый RED.
- [x] Реализовать validator: Ajv2020 + formats, без removeAdditional/coerceTypes/useDefaults и без remote schema fetch; diagnostics через JSON pointers. Schema defaults — аннотации, применять их должен resolver.
- [x] Выполнить tests до GREEN и повторить `npm --prefix server ci`; lockfile не меняется.

## Task 2: Managed merge и semantic policy

**Files:** Create `resolve.mjs`, `canonical.mjs`, `resolve.test.mjs`; reuse schema/fixtures.

**Interfaces:**
- `resolveManagedConfig(global:ConfigDocument|null, device:ConfigDocument|null): Values` — fresh object, не меняет arguments.
- `validateResolvedConfig(values:Values, policy:PolicyContext): ValidationIssue[]`.
- `canonicalJson(value:JSONValue):string`, `sha256Json(value:JSONValue):string`: object keys сортируются рекурсивно, порядок массивов сохраняется; вход только проверенный JSON.
- Defaults: `{ui:{theme:'system',density:'comfortable',animations:true},sources:[],plugins:[],torrServer:{enabled:false},parser:{enabled:false},features:{search:true,sync:false,plugins:false},lockedPaths:[]}`. Metadata endpoint/provider не выдумывать; отсутствие metadata означает «ещё не настроено».

- [x] Написать failing assertions: device ui.animations=false наследует global ui.theme='dark'; device sources=[] очищает массив; union lockedPaths сохраняет оба набора без дубликатов; inputs deepEqual до/после.
- [x] Написать tests: `__proto__`, `prototype`, `constructor` на любой вложенности отклоняются до merge; `Object.prototype` после вызова не изменяется. Проверить через JSON.parse, не object literal с особой JS-семантикой __proto__.
- [x] Написать tests semantic validation: duplicate ids; defaultSourceId ссылается на отсутствующий/disabled source; enabled TorrServer/parser без endpoint; неизвестный provider/ref; enabled plugin не совпадает с reviewed entry url/hash/minClientVersion → errors с pointers. Valid disabled integrations не требуют отсутствующих credentials.
- [x] Зафиксировать безопасную URL policy: запрещены userinfo/fragment/query в base endpoints; HTTPS по умолчанию, HTTP только origin из trusted allowedLanOrigins; metadata direct-device не допускает credentialRef. Тестировать private HTTP без policy, explicit разрешённый LAN origin, secret query/userinfo и fragment. Это lexical validation, не доказательство безопасности будущего network connector/redirect/DNS.
- [x] Реализовать функции, выполнить tests RED→GREEN. Locks ограничивают будущие local preferences; административные device overrides могут менять managed values, но не убирать global locks.
- [x] Для canonical hashing проверить равенство object с разным порядком ключей, различие при другом array order и отсутствие raw credentials в diagnostic issues.

## Task 3: SQLite revision repository

**Files:** Create `database.mjs`, `repository.mjs`, `repository.test.mjs`; reuse canonical hashing.

**Interfaces:**
- `openConfigDatabase(path:string):DatabaseSync`, `close()` через возвращённый DB; открыть/мигрировать в транзакции, `PRAGMA user_version=1`. Более новая версия → UNSUPPORTED_DB_VERSION, без downgrade/перезаписи.
- `createConfigRepository(db):Repository`.
- `getHead(scopeKey):Snapshot|null`; `getRevision(revision):Snapshot|null`; `listRevisions(scopeKey,{beforeRevision?:number,limit?:number}):Snapshot[]` в порядке revision DESC, limit default20/max100.
- `publish(input, validateCandidate):Snapshot`; input=`{scopeKey,expectedRevision,mutationId,actorId,reason,document}`.
- `rollback(input, validateCandidate):Snapshot`; input=`{scopeKey,expectedRevision,mutationId,actorId,reason,targetRevision}`.
- `validateCandidate(document,heads):void`: синхронная функция, запускается **внутри** write transaction; heads — согласованный список текущих snapshots. Никаких async/network вызовов или имитации auth внутри repository.

Schema v1: `config_revisions` с полями Snapshot, append-only по публичному API; `config_heads(scope_key PK,revision FK)`; `config_mutations(actor_id,mutation_id,request_hash,revision FK, PRIMARY KEY(actor_id,mutation_id))`. Revision metadata — одновременно immutable audit принятого изменения. Все запросы parameterized. Retention/pruning не реализовывать в этом этапе.

- [x] Написать file-backed tests: empty head=null; first publish expectedRevision=0→revision1; close/reopen восстанавливает head и историю; migration повторяется безопасно; future user_version отклоняется.
- [x] RED tests CAS/idempotency: два соединения с expectedRevision0, первый пишет, второй получает REVISION_CONFLICT, только одна revision; одинаковый actor+mutationId+canonical request возвращает исходный snapshot даже после reopen; иной payload/base/operation под тем же ID → IDEMPOTENCY_MISMATCH.
- [x] Реализовать `BEGIN IMMEDIATE`→dedup lookup→head CAS→validation→insert revision→head update→mutation result→COMMIT; любая ошибка ROLLBACK. Idempotency lookup перед CAS необходим для retry потерянного ответа. BUSY не выдавать за конфликт/retry success.
- [x] Добавить fault test через BEFORE INSERT trigger RAISE(ABORT) на config_mutations: после failure нет новой revision/head; корректный повтор после удаления trigger проходит. Это проверяет реальный rollback всех записей, без production failpoints.
- [x] RED rollback tests: target из другого scope/отсутствующий → NOT_FOUND; rollback к revision1 создаёт новую revision3 с parentRevision2/restoredFrom1, исходные строки неизменны; callback rejection оставляет все таблицы без изменений.
- [x] Выполнить real two-process race test на временной file DB: оба worker получают одинаковую baseRevision; ровно один publish успешен, второй REVISION_CONFLICT. `busy_timeout` позволяет дождаться lock; результаты проверяются реальным чтением БД, не mock SQL.
- [x] Запустить весь backend suite GREEN; не делать HTTP/auth/global filesystem modifications и не хранить SQLite fixtures в checkout.

## Task 4: Config service, integration и CI

**Files:** Create `service.mjs`, `service.test.mjs`; modify workflow/development docs; дополнить config-system.md ссылками и границами реализации.

**Interfaces:**
- `createConfigService({repository,policy}):ConfigService`.
- `publish(input):Snapshot`, `rollback(input):Snapshot` — те же input shapes, validation не может быть обойдена вызывающим кодом service.
- `preview({scopeKey,document}):{valid,issues}` — read-only validation against current heads; preview не резервирует revision, publish всегда повторно проверяет под транзакцией.
- Любой global publish/rollback валидирует candidate global и все текущие device overrides; device publish валидирует candidate device с current global. Schema-invalid input → INVALID_CONFIG до DB write. Scope/document mismatch → INVALID_CONFIG. Версии/auth HTTP не реализуются здесь.

- [x] RED integration tests: global содержит enabled sourceA, device defaultSourceId=sourceA; global update удаляет sourceA → INVALID_CONFIG, все heads/rows прежние. Исправленный global сохраняется. Device, ставший невалидным из-за актуальной policy, не «исправляется» молча.
- [x] RED rollback-policy test: старая версия включает reviewed plugin, policy удаляет его из allowlist; rollback к ней отклоняется и не меняет head. Policy остаётся доверенным серверным input, не частью пользовательской JSON конфигурации.
- [x] Проверить preview без записи, publish повторно валидирует после изменения global, две разные device области не перезаписывают друг друга; ошибка не содержит секретов/SQL/full credential URL.
- [x] Реализовать service без сетевого listener/CLI и без подключений к Lampa. Тест service — исполняемый пример будущего Admin backend, не готовый пользовательский workflow.
- [x] Добавить независимый CI job `config-core`: pinned Node/npm, `npm --prefix server ci`, `npm --prefix server test`. Root dependencies не нужны этому job. Сохранить существующие build-and-helpers и upstream-regression без skips/continue-on-error.
- [x] Документировать команды, БД/WAL/backup ограничения, список ещё не реализованных endpoints, security boundary «internal core без HTTP». Root npm start и builds продолжают работать прежним образом.
- [x] Финальная проверка: backend suite, build helpers, обе воспроизводимые сборки P01; upstream Vitest с честным исходным nonzero status. Проверить git diff --check, lock repeatability и отсутствие *.sqlite/-wal/-shm в diff. Тесты реального Pi/ARM64 остаются отдельным acceptance.

## Приёмка этапа

- Все backend tests исполнены и проходят, включая restart, два writer, rollback и потерянный ответ.
- Managed JSON валидируется машинной схемой; resolver детерминирован и не меняет вход.
- Global/device config сохраняется в настоящем SQLite с immutable revisions и CAS; rollback создаёт новую revision.
- Ошибки в любом device блокируют несовместимый global update атомарно.
- Нет нового порта, открытой админки, сетевых запросов или изменений client Storage/CUB поведения.
- P01 не регрессировал; известные upstream failures остаются отдельно видимыми.

## Следующий пользовательский результат

P06: локальный bootstrap первого администратора и session auth. P07–P08: pairing, authenticated Config API, ETag и effective document. P09: клиент берёт настройки с Pi и сохраняет offline fallback. Затем Admin UI и простой Compose/setup. Network baseline P04 должен появиться до удаления CUB; этот этап его не заменяет. Лицензионный конфликт P02 остаётся blocker распространения, не blocker локальной разработки.

## Экономное исполнение и review

Четыре последовательные задачи с узкими ownership boundaries; отдельный план на каждый HTTP/auth/UI этап вместо большого общего MR. Implementer Terra medium для validation/SQLite/service. Luna здесь не использовать: transactional behavior и safety policy требуют judgment. Каждый task — сначала spec, затем quality review на Terra medium, без повторных полных прогонов уже проверенных неизменённых suites. Финальный sub-project review Sol medium по согласованному routing. Эскалация implementer не нужна, пока не обнаружено межрепозиторное решение или реальная архитектурная неоднозначность.

В этом planning turn агенты/implementation/review модели не запускались: подготовка и self-review выполнены координатором. Реализация после одобрения плана; commit/MR отдельно не разрешены.

## Self-review

Проверено: типы и названия методов совпадают между tasks; validation не вынесена из CAS transaction; idempotency lookup предшествует CAS; cross-device проверка покрывает также rollback; default source/provider не выдуманы; секреты отделены; каждая из пяти Review Focus строк имеет конкретный тест. Схема и merge следуют существующему дизайну, новая URL-query restriction отмечена как предложение этого этапа. HTTP/auth/TV/Proxy compatibility не объявляются готовыми по library tests.


## Результат исполнения

Этап реализован в рабочей копии без commits/push/MR. Config-часть P03 и P05 выполнены; managed resolver выделен как предварительная внутренняя часть P08. HTTP/auth/pairing/client bridge, Pi Compose/install и пользовательское состояние не реализованы этим этапом.

Проверки: 38/38 backend tests, 10/10 P01 build-helper tests; реальные SQLite restart, dedup, fault rollback и two-process CAS race. Четыре чистые сборки P01 (по две на target) дали одинаковые hashes и не изменили входные ресурсы. Root Vitest сохраняет исходные 127 passed /1 failed test /1 suite import failure. CI YAML проверен локально, удалённый GitHub Actions и Pi/ARM64 не запускались. Дополнительный ручной smoke публичного service с file DB: publish→publish→rollback→reopen→retry, ровно3 revisions.

Реализация и task spec/quality reviews — Terra medium; финальный общий review — Sol medium. Все найденные замечания исправлены и повторно проверены; открытых findings нет, эскалации implementer не потребовались. Это не утверждение о готовности всего Home или green legacy suite.

### Решения координатора и риски

- Существующая изолированная cloud checkout без commits/worktrees; evidence/briefs/diffs сохранены в игнорируемом `.superpowers/sdd/config-core/`, поскольку истории commits для восстановления нет. Риск: до сохранения изменений результаты и evidence живут только в workspace. Cloud shell helpers навыка недоступны, использованы эквивалентные локальные snapshot/diff инструменты.
- В repository добавлен read-only `listHeads()` для advisory preview, поскольку исходные интерфейсы плана не давали перечислить текущие device scopes. Риск: небольшой дополнительный внутренний API потребует согласования будущих caller при изменении.
- Credential-safe URL policy применяется также ко всем плагинам, включая выключенные: userinfo/query/fragment запрещены. Reviewed tuple не делает raw credentials безопасными. Риск: query-bearing plugin URL потребуется преобразовать в чистый локальный pinned URL или отдельный adapter при будущем provisioning.

Команды и пример внутреннего API: [config-system.md](../../config-system.md), [development.md](../../development.md). Следующий этап — P06 auth/bootstrap перед сетевыми административными endpoints.
