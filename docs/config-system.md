# Система конфигурации, Admin и синхронизация

Статус: реализованы ядро конфигурации, HTTP API и LAN-панель. Клиент Lampa ещё не подключён. Точный список реализованных маршрутов приведён в разделе LAN administration; остальные маршруты ниже — проект, а не API Lampa или существующего proxy. Основание: `yumata/lampa-source@86c2b099b19f7058ea304dfa43a8b1e18a2e0492`.

## Актуальный локальный scope

По решению пользователя от 2026-11-10 ближайший HTTP/API/Admin этап работает в домашней LAN без авторизации. Login/session/token/pairing разделы ниже сохранены как отложенный вариант и не являются prerequisites текущей разработки. DeviceId/profileId служат адресацией данных; без auth они не обеспечивают ограничение доступа между участниками LAN. HTTP API и панель реализованы без авторизации. Секреты backend и проверки конфигурации остаются на сервере; публичный интернет-доступ не входит в локальный режим.

## Внутреннее ядро

Контракт документа — [JSON Schema Draft 2020-12](../schemas/managed-config.v1.schema.json). Service выполняет проверку внутри транзакции, включая все device overrides при изменении global; preview только читает текущие heads и не резервирует revision. Policy передаётся доверенным backend как живые Sets/Map, а не как данные документа. URL всех плагинов, включая выключенные, проверяются на отсутствие userinfo, query и fragment; включённые также должны совпадать с reviewed registry. Секреты хранятся вне БД, в документах разрешены только ссылки.

Пример внутреннего использования (не сервер и не CLI):

```js
import { openConfigDatabase } from './server/src/config/database.mjs';
import { createConfigRepository } from './server/src/config/repository.mjs';
import { createConfigService } from './server/src/config/service.mjs';

const db = openConfigDatabase('/local/config.sqlite');
try {
  const repository = createConfigRepository(db);
  const policy = { providerIds: new Set(), secretRefs: new Set(), reviewedPlugins: new Map(), allowedLanOrigins: new Set() };
  const service = createConfigService({ repository, policy });
  const document = { schemaVersion: 1, scope: 'global', values: {} };
  const preview = service.preview({ scopeKey: 'global', document });
  if (preview.valid) service.publish({ scopeKey: 'global', document, expectedRevision: 0, actorId: 'internal', mutationId: 'example-1', reason: null });
} finally {
  db.close();
}
```

Preview не гарантирует успешную запись: publish повторяет проверку с актуальными heads и policy. Инструкции по тестированию и backup — в [development](development.md). Pairing, sync, installer и подключение клиента пока не реализованы.

## Что уже есть в исходниках

- [`Storage.task/ready/init`](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/src/core/storage/storage.js#L18): localStorage с резервом IndexedDB; выбранные ключи отправляются через `storage/update`. Это не схема управляемой конфигурации и не произвольная безопасная замена всех ключей.
- [`remote_configuration.api/accept/install`](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/src/services/remote_configuration.js#L141): CUB `/api/remote-configuration/registration`, `accept?code=…`, delivery типов extension/storage/reload; код действует 5 минут, опрос около 10 секунд. Произвольный Storage.set и установка JS не подходят как авторизация нового Admin.
- [`settings params`](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/src/interaction/settings/params.js#L819): TorrServer URL, второй URL, login/password находятся среди client settings; source и tmdb_lang тоже выбираются клиентом ([L252](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/src/interaction/settings/params.js#L252), [L670](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/src/interaction/settings/params.js#L670)).
- [`account/timeline.send/update`](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/src/core/account/timeline.js#L37): `timeline/update`, `timeline/dump`, tracker versions; dump после 10 дней без обновления. [`account/bookmarks`](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/src/core/account/bookmarks.js#L124) содержит очередь, кэш и tracker. Новый sync контракт ниже не приписывается этим существующим сервисам.

## Владение данными

| Класс | Примеры | Хранилище / право изменения |
|---|---|---|
| Server global | разрешённые metadata/source/plugin endpoints, defaults, feature policy | backend, admin; версия immutable |
| Device overrides | назначенный provider/source, локальный TorrServer endpoint, доступные плагины | backend, admin/device manager; только известные schema поля |
| Local preferences | тема, язык UI, громкость, субтитры, выбранная дорожка | клиент; синхронизация предпочтений отдельно и добровольно |
| User state | history, favorites, progress, профиль | backend + локальная очередь; отдельный протокол ниже |
| Backend secrets | TMDB key, parser/TorrServer credentials, admin keys | secret store; клиент получает opaque ref или ограниченный gateway |

Приоритет: встроенные безопасные defaults → global values → device values → local preferences только для разрешённых preference keys. Managed policy/locks проверяются последними; локальная запись не снимает запрет. Одинаковый объект настроек не должен включать state и secrets. Для metadata locale local preference допустима, выбор неразрешённого provider — нет. Секреты старых Storage keys не переносить в общий JSON/export; миграция предлагает серверный secret ref и удаляет старый credential после проверки подключения. LAN TorrServer может быть недоступен backend: тогда явно поддержать direct-device режим с локальным credential storage, предупредив в Admin о невозможности серверной проверки; глобальная схема ниже хранит только refs.

## JSON Schema конфигурационного документа

Полная схема portable managed config, Draft 2020-12. Effective response отдельно добавляет server-generated revision/ETag/provenance и не меняет документ. `scope=global` не содержит deviceId, `scope=device` требует его. Все поля values необязательны для override; global defaults задаются приложением и отображаются в Admin. Лимиты длины и количества защищают импорт. URI format нужно включить как assertion в валидаторе, затем выполнить семантическую security-проверку.

Машиночитаемая схема: [`managed-config.v1.schema.json`](../schemas/managed-config.v1.schema.json).

Semantic validation после merge: уникальные source/plugin id, defaultSourceId указывает на enabled source; enabled parser/TorrServer требует endpoint/primary; metadata provider должен быть зарегистрирован и совместим; credentialRef существует и доступен scope; запрещены userinfo в URL, fragment и credential query. Массивы заменяются целиком, исключение — lockedPaths: union global/device. Objects merge по ключу, отсутствующий ключ наследуется; null запрещён. Сброс override через JSON Patch remove выполняется только локально над candidate, затем отправляется полный PUT; PATCH endpoint не предлагается. lockedPaths из global нельзя ослабить device override; device может лишь добавить locks. Plugin minClientVersion — обязательный минимум релизного client semver MAJOR.MINOR.PATCH без prerelease/build, проверяется семантически сравнением числовых компонентов; версия ниже минимума запрещает загрузку и отражается в failed ack. Текущее ядро допускает HTTPS и HTTP только для явно разрешённого доверенной policy LAN origin, независимо от endpoint mode; дополнительная policy будущего connector может ограничить транспорт и режим. URL Schema намеренно не заменяет такую проверку.

Baseline metadata transport — gateway на backend, где живут credentials и binding к собственному proxy. Для metadata `direct-device` в schema предусмотрен как optional режим: текущее ядро принимает его с безопасным URL и без `credentialRef`, проверяя только URL и ссылки. Фактическое включение транспорта требует отдельного аудита CORS/URL/auth и отсутствия секретов на устройстве. Это не обещание готового browser-to-proxy доступа.

Примеры двух отдельных валидных документов (показан global default и override одного устройства):

```json
{"schemaVersion":1,"scope":"global","values":{"ui":{"theme":"dark","density":"comfortable","animations":true},"metadata":{"providerId":"tmdb","endpoint":{"url":"https://metadata.example.invalid/v1","mode":"gateway"}},"lockedPaths":["/metadata/endpoint"]}}
```

```json
{"schemaVersion":1,"scope":"device","deviceId":"living-room-tv","values":{"ui":{"density":"compact","animations":false},"lockedPaths":["/ui/animations"]}}
```

URL примера — placeholder нового backend, а не обнаруженный маршрут proxy.

UI defaults публикуются в global `values.ui`; device override может переопределить отдельные поля. Local preferences `ui.theme`, `ui.density`, `ui.animations` применяются поверх resolved defaults только без соответствующего lock: `/ui` блокирует все три поля, leaf path — одно поле. Существующее локальное значение сохраняется, но не действует до снятия lock. Schema `default` — аннотация: materialization выполняет приложение (system/comfortable/true), валидатор не обязан вставлять значения. Пользовательское reduced-motion ограничивает анимации дополнительно независимо от разрешённого default.

## Предложение: auth, session bootstrap и pairing

Все маршруты этого раздела также предлагаются для нового backend. Web Admin использует session cookie, устройство — отдельный ограниченный device credential; auth token и pairing secret не входят в config JSON.

| Метод / маршрут | Контракт |
|---|---|
| POST `/v1/auth/login` | Проверка admin identity через настроенный identity backend; rate limit, CSRF/origin проверки; выдаёт Secure/HttpOnly session cookie, без пароля в ответе |
| POST `/v1/auth/logout` | Отзывает текущую серверную session, очищает cookie; повтор безопасен |
| GET `/v1/auth/session` | Bootstrap: authenticated flag, actor/role/scopes, CSRF token, session expiresAt; anonymous ответ без private config |
| POST `/v1/pairing/start` | Непривязанное устройство получает pairingId, одноразовый userCode, случайный pollSecret, expiresAt и pollIntervalSeconds; TTL 5 минут, rate limit по сети/устройству |
| POST `/v1/admin/pairing/{pairingId}/approve` | Только authenticated admin с device-manage: сверяет userCode, выбирает account/profile и device name, выдаваемые scopes; запрет self-approval непривязанным устройством |
| POST `/v1/pairing/{pairingId}/poll` | pollSecret в body, не URL; pending/approved/expired/denied. После approve одноразово выдаёт credential только этому pairing session; повтор delivery в коротком bounded окне привязан к тому же pollSecret |
| DELETE `/v1/admin/devices/{id}` | Только admin device-manage: revoke device identity и всех refresh tokens, завершить pairing sessions, audit; повтор возвращает уже revoked |

До approve pairing не даёт доступа к config/state. После approve device получает лишь `config:read-self`, `config:ack-self`, `sync:read-profile`, `sync:write-profile` в выбранном profile; secret/admin/device-manage scopes запрещены. Device access token TTL 15 минут, refresh credential TTL 30 суток с rotation и reuse detection; `POST /v1/auth/device/refresh` обменивает refresh credential, проверяет revoke и возвращает новый pair. Poll минимум раз в 5 секунд, server может вернуть 429/Retry-After; после TTL новый start, старый code не продлевается. UserCode хранится хешированным, pollSecret высокоэнтропийный, одноразовая approval транзакция не позволяет связать устройство с двумя профилями. Revoke проверяется каждым серверным запросом, offline last-known-good не обеспечивает мгновенное удаление локального контента. Admin session TTL 8 часов с server-side expiry; production login policy/MFA определяется identity backend. Выход пользователя не удаляет глобальную регистрацию устройства: revoke доступен только Admin.

## Предложение: расширенный Admin API и жизненный цикл

| Метод / предлагаемый маршрут | Контракт |
|---|---|
| GET `/v1/admin/config/schema` | схема, capabilities, supported migrations |
| GET `/v1/admin/config/global`, `/v1/admin/devices/{id}/config` | документ + revision, ETag; пустой device override допустим |
| POST `/v1/admin/config/validate` | scope + candidate + baseRevision; schema/semantic errors с JSON pointers и warnings; без применения |
| PUT `/v1/admin/config/global`, `/v1/admin/devices/{id}/config` | полный новый документ, If-Match обязателен, Idempotency-Key; atomically validate+publish |
| GET `/v1/admin/config/revisions?scope=…&cursor=…` | immutable revisions, actor/time/reason/hash и redacted diff |
| POST `/v1/admin/config/rollback` | targetRevision + baseRevision + reason; создаёт новую revision, старую не изменяет |
| GET `/v1/devices/self/config` | effective config, revision vector global/device, ETag, provenance, serverTime; 304 при совпадении |
| POST `/v1/devices/self/config/ack` | effective revision vector, applied/failed, clientVersion, error code |
| POST `/v1/admin/connections/test` | тип endpoint + credentialRef; bounded probe, ответ без секретов; direct-device возвращает requires-device-test |
| POST `/v1/admin/config/import/preview` | документ export; size/schema/version checks, миграция и redacted diff; не исполняет плагины |
| GET `/v1/admin/config/export?scope=…` | portable document + schemaVersion + checksum; без секретов и user state |
| POST `/v1/admin/secrets` | write-only secret, возвращает ref; отдельная роль; rotate/revoke отдельными операциями |

Admin flow: выбрать global/device → редактировать типизированные поля → увидеть resolved value и происхождение → validate + diff → publish → проверить acknowledgements. Сохранение вызывает одну атомарную публикацию; если baseRevision устарел, 412 с latest revision и diff для повторного review. Отсутствие If-Match — 428. Семантическая ошибка — 422, oversized — 413, auth — 401/403. Ошибка имеет code/message/requestId/fieldErrors; пароли в ней недопустимы. Endpoint tests не загружают plugin JS и не исполняют parser expressions.

Хранение revisions: монотонный server revision, content hash, parent, actor, UTC timestamp, reason, schema/client compatibility range. Publish в транзакции сохраняет snapshot+audit. В MVP по ADR009 применяется polling с jitter и If-None-Match при старте, восстановлении сети и периодически (начальный интервал 60 секунд). SSE/WebSocket — optional future transport: только уведомление о revision с последующим GET; MVP от них не зависит. Rollback повторно валидирует snapshot по текущей schema/security policy и учитывает удалённые secret refs. Нужна retention политика, например 90 суток + закреплённые last-known-good; удаление revision не нарушает audit policy.

Offline boot: сначала прочитать встроенные defaults и последний успешно проверенный effective snapshot, затем сеть. Candidate проверяется до атомарной замены snapshot, предыдущая версия сохраняется. При timeout использовать last-known-good, показать stale статус в диагностике; config fetch не должен блокировать экран. Неизвестная schema/minClientVersion не применяется, отправляется failed ack; новый клиент не должен автоматически исполнять устаревший plugin после его server revoke: для отзыва нужны expiry/online policy, offline не гарантирует немедленный revoke. Секретные серверные токены не попадают в snapshot. Смена профиля очищает in-memory state и разделяет кэши/очереди по account/profile.

## Безопасность и перенос

Admin — authenticated session, роли read/config-write/device-manage/secret-write, CSRF защита для cookie auth, Secure/HttpOnly/SameSite, CORS allowlist; device enrollment создаёт ограниченную device identity с отзывом, без общих admin credentials. Профиль/account сервер выводит из auth scope, не доверяет произвольному body id. Секреты шифруются at rest, redaction применяется к логам, diffs, diagnostics/export. Device token не является API key metadata proxy.

Для backend probes/proxy: allowlist host/port/scheme, DNS resolution и повторная проверка каждого redirect, запрет loopback/link-local/cloud metadata; LAN доступ возможен только для специально разрешённой сети/коннектора. Не принимать произвольный client URL как open proxy. Параметры и headers каждого connector определяются сервером. Для browser direct-device учитывать mixed-content/CORS, проверять соединение на устройстве.

Plugin URL означает исполнение стороннего JS в legacy runtime; hash pinning защищает неизменность, но permissions в schema сами по себе не создают sandbox. До реальной изоляции разрешать только reviewed allowlist plugins и считать их имеющими права приложения; подключение нового URL требует явной admin публикации. Не обещать безопасную изоляцию через декларацию permissions. Установка зависит от features.plugins, подписи/хеша, allowlist и compatibility range; изменение URL/hash — новая revision. CSP и изолированный bridge полезны только после проверки всех необходимых legacy возможностей.

Export: версионированный JSON, checksum для обнаружения повреждений (не подпись доверия), secrets refs редактируются в portable export и повторно связываются при импорте, device id при переносе заменяется явно. Preview показывает отсутствующие refs, unsupported features, URL/plugin изменения; apply идёт обычным PUT с If-Match. Import не вызывает reload, установку JS или подключения до publish. Миграции чистые, детерминированные, сохраняют исходный архив; downgrade только явно поддерживаемый. Полный backup пользовательского state — отдельная авторизованная операция.

## API синхронизации history/favorites/progress

Отдельный namespace `/v1/sync`, отдельно от config revisions. Единица данных привязана к auth account/profile, content key `{provider,kind,id,season?,episode?}`. Legacy hash файлов не считать универсальным id: adapter должен сохранить mapping и не смешать разные озвучки/версии; прогресс при необходимости имеет playbackVariantId. История поиска и история просмотра — разные datasets; поиск по умолчанию локален.

Предлагаемые endpoints:

- `GET /v1/sync/snapshot?datasets=history,favorites,progress`: согласованный snapshot и cursor/highWaterMark, пагинация snapshotToken; не смешивать страницы разных snapshots.
- `GET /v1/sync/changes?cursor=…&limit=…`: упорядоченные server sequence changes, nextCursor и hasMore. Просроченный cursor → 410 SNAPSHOT_REQUIRED.
- `POST /v1/sync/operations`: `{deviceId,batchId,operations:[{opId,deviceSeq,dataset,key,action,baseVersion,payload}]}`. Action типизирован: favorite add/remove, history append/delete, progress checkpoint/reset/complete/resolve. До 100 ops/256 KiB; ответ каждого op accepted/conflict/rejected и resulting version/serverSeq. Батч не объявляется целиком успешным при partial reject.
- Отзыв устройства выполняется только Admin через `DELETE /v1/admin/devices/{id}` (см. pairing); sync credential не имеет права revoke. Удаление profile state требует отдельной операции с scope и audit, не трактуется как обычный favorite remove.

Повтор `(account,profile,opId)` с тем же hash возвращает прежний результат; с другим payload — 409 IDEMPOTENCY_MISMATCH. Idempotency ledger хранится дольше offline retry horizon (предлагается 90 суток); старые неподтверждённые операции требуют rebase после snapshot, а не слепой replay. deviceSeq монотонен, serverSeq назначается сервером; device wall clock лишь диагностический. При повторе batchId возвращаются те же per-op результаты, при смешивании payload — conflict. Config Idempotency-Key использует отдельный namespace.

Конфликты определены по dataset:

| Dataset | Правило |
|---|---|
| Favorites | Версия на membership `(key,listId)`. CAS baseVersion; устаревший add/remove возвращает conflict и current value. Клиент показывает актуальное состояние; явный повтор намерения получает новый opId/baseVersion. Remove сохраняет tombstone, чтобы offline add не воскресил запись незаметно |
| History | Append-only событие с уникальным eventId=opId; duplicate подавляется. Delete использует version/tombstone для content key либо eventId. Поздний append, основанный на состоянии до удаления, конфликтует; не восстанавливает очищенную историю |
| Progress | Внутри одной playback session принимается следующий checkpointSeq, устаревшие игнорируются. Между сессиями проверяется baseVersion: concurrent sessions дают conflict с обеими позициями; UI resume выбирает один вариант и отправляет resolve. Не брать max(position): пользователь мог перемотать назад. Complete/reset — явные операции с CAS; reset создаёт новый generation, поздние старые checkpoints отклоняются |

Progress `action` имеет enum `checkpoint|reset|complete|resolve`. Resolve требует current baseVersion, conflictId и выбранный sessionId/position; сервер атомарно закрывает конфликт, создаёт новый generation и отклоняет поздние checkpoints старых ветвей. Повтор resolve с тем же opId идемпотентен.

Progress payload: sessionId, generation, checkpointSeq, positionSeconds≥0, durationSeconds nullable >0, completed boolean; server проверяет position относительно duration с допустимым небольшим drift. Percent вычисляется, а не служит единственной истиной. Не считать 100% без известной duration или явного complete. Session createdAt клиентский, serverReceivedAt авторитетен для порядка принятия; конфликт между устройствами не решается сравнением их часов.

Offline: durable outbox в IndexedDB записывается до отображения optimistic результата, opId сохраняется при retry, ack удаляет только подтверждённую операцию. Checkpoints одной сессии можно coalesce до отправки, сохраняя последний seq; reset/complete/delete не coalesce с обычным checkpoint. Сначала pull/rebase, затем push, затем pull до highWaterMark; локальная очередь накладывается поверх remote snapshot. 429/5xx/network повторяются с backoff+jitter и Retry-After; 401 останавливает очередь до auth, 403/rejected не повторяется автоматически. Квота и удалённые tombstones хранятся минимум offline horizon; более старый клиент получает snapshot-required. Logout не переносит outbox следующему пользователю.

Минимальные acceptance scenarios: two-device favorite add/remove conflict; duplicate batch после timeout; offline reset и старый checkpoint; перемотка назад; complete на другом устройстве; clock skew; истёкший cursor; 412 config race/rollback; corrupted offline snapshot; missing secret; import plugin URL; blocked SSRF redirect. Это критерии будущей реализации, не утверждение о пройденных тестах.

### LAN administration

See [development](development.md#local-configuration-panel) for LAN startup,
allowed hosts, runtime paths, and database directory permissions.

The Russian admin panel at `/admin/` edits global or device revisions. Blank
fields in device scope remove the corresponding override. Jackett and TorrServer have explicit enabled, disabled, and inherit/default choices; entering a URL does not enable either service. Save validates the
full document and preserves other schema fields. A conflict leaves the form
intact; load the current version before applying changes again. History can
restore a previous revision. The separate LAN HTTP origin button changes the
runtime allowlist independently of configuration saves.

Secret inputs are write-only: an empty input retains the current reference;
the remove checkbox removes it from the next revision without deleting the
secret. Export replaces credential references with portable placeholders and
contains no secret values. Import previews the document and refuses unresolved
placeholders; references must be explicitly replaced with configured references
on the target server. Secrets are stored as plaintext in a private SQLite file,
not encrypted at rest. This trusted-LAN service has no authentication and must
not be exposed to the public Internet. Configuration storage does not yet
connect Lampa clients or proxy requests to the configured services.

The implemented HTTP routes are `/v1/admin/config/{schema,global,validate,revisions,rollback}`,
`/v1/admin/devices/{id}/config`, `/v1/admin/secrets`,
`/v1/admin/secrets/status`, `/v1/admin/lan-origins`, and
`/v1/devices/{id}/config`. Older descriptions of authentication, pairing, or
client routes elsewhere in this document are proposals, not implemented
prerequisites. The client bridge is future work.
