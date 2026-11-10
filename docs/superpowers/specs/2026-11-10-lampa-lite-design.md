# Lampa Lite — локальный управляемый медиаклиент

Статус: проект нового scope по запросу пользователя 2026-11-10, без реализации изменений этого документа. Основа: текущий main с импортом upstream3.4.6 и готовым config-core. Это уточнение ранее принятой архитектуры Home; backend авторизация отложена по решению пользователя.

## Цель и результат для пользователя

На Raspberry Pi4 ARM64 работает один домашний сервер. С компьютера пользователь открывает `/admin/`, задаёт TMDB Proxy, Jackett и TorrServer, сохраняет настройки. Клиенты читают настройки сервера и применяют их без пересборки. Клиент сохраняет локальные избранное, историю и прогресс. WebOS оболочка содержит локальный UI и запускается при выключенном Pi.

У пользователя уже есть Jackett и TorrServer; их настройки и функциональность сохраняются. Они не становятся обязательными контейнерами нашего Compose. Существующий TMDB Proxy пока не предоставлен: его API, auth и совместимость не считаются известными.

## Approaches и предложение

1. Плагины поверх полного upstream: быстро для формы настроек, но startup CUB и ненужные модули остаются. Не обеспечивает Lite и zero-CUB.
2. **Предлагается: поддерживаемый Lite build profile + небольшой server/admin пакет.** Переиспользуем UI/player/storage Lampa; явно меняем startup/import graph, адаптеры и конфигурацию. В рабочей сборке исключаем лишние модули и удалённые загрузчики. Исторические исходники, нужные для сравнения с upstream, не выдаём клиенту и не считаем активными возможностями.
3. Новый медиаклиент: максимальный контроль, но потеря upstream совместимости и лишние затраты. Исключён исходными требованиями.

Выбор2 — предложение координатора; запрос пользователя задаёт состав Lite, но этот implementation design ещё требует review. Не удалять дерево исходников массово до проверки import consumers и замены их runtime контрактов.

## Состав Lite

| Сохраняем | Убираем из runtime/build/UI |
|---|---|
| UI Lampa, поиск/каталоги/карточки TMDB, изображения, сезоны/эпизоды, локализация | CUB источники/аккаунты/premium/WS sync, соцфункции/обсуждения/реакции |
| Jackett: URL и API key, поиск и выбор торрента | Prowlarr и сторонние каталог-провайдеры вне TMDB; альтернативные hosted парсеры по умолчанию |
| TorrServer: URL, доступные пользователю параметры, получение HTTP-потока | IPTV, спорт, live/chat, remote broadcast, AI и subscription-интеграции |
| Player lifecycle, пульт/фокус/Back, audio/subtitle tracks, нужные HLS/DASH libs | Реклама/VAST/metrics, remote geo/DMCA/LGBT feeds и CUB mirrors/fallback |
| Local favorite/history/timeline и миграция профильных ключей | CUB remote configuration, магазин/произвольные удалённые плагины и их auto-update |
| Управление с ПК и общие/per-device settings, rollback | Login, pairing approval, sessions и device tokens для текущего LAN режима |

Полезные локальные настройки player/UI не удаляются из-за отсутствия CUB. Рекомендации, доступные через TMDB, не удаляются вместе с CUB. Трейлеры и другие внешние сервисы не включаются в обязательный Lite baseline. Нужные vendor/polyfill/SDK ресурсы поставляются локально с notices.

## Управление с компьютера

Один Node24.22.1 процесс обслуживает `/admin/`, `/app/` и `/v1/...`; SQLite остаётся embedded. Дополнительный обязательный nginx не нужен для LAN прототипа. Reverse proxy/TLS можно добавить позже, если реально потребуется.

Admin UI — небольшая статическая страница на vanilla JS, без React/toolchain. Основные поля: имя установки, TMDB Proxy URL, Jackett URL+key, TorrServer URL и параметры, язык/тема/плотность/анимации. Выбор global/device scope, показ наследуемых значений, validate/save, понятный conflict при устаревшей revision, история/rollback и export/import. Новые device IDs — локальные стабильные идентификаторы, не аутентификация.

Без авторизации каждый участник LAN может менять доступные настройки. Default local development bind127.0.0.1; в Compose bind0.0.0.0 внутри контейнера с опубликованным LAN-портом8080. Публичный интернет-доступ не входит в этот режим. JSON validation, CAS, idempotency, запросные лимиты и защита от произвольного file/URL proxy остаются.

## Контракт конфигурации и секретов

Используем существующие schema/resolver/repository/service и version1. Не заводим вторую БД или дублирующую JSON-конфигурацию. Per-device document содержит только overrides; снятие override означает удаление ключа и полный PUT. Publish и rollback — новые immutable revisions.

Поля секретов write-only в Admin, ответы говорят лишь «настроен/не настроен». Backend secret values хранятся отдельно от managed config в private runtime-таблицах той же SQLite БД; database/data directory защищены0600/0700, config содержит refs. Это не encryption at rest. Export, effective response и logs не содержат raw credentials. Пустое password поле UI значит «сохранить старый секрет», очистка — отдельное явное действие. Конкретное secret storage и коннекторы — отдельная маленькая задача до передачи ключей клиентам; нельзя незаметно положить Jackett key в localStorage или URLs браузера.

URL policy config-core остаётся строгой. LAN origin разрешается отдельным явным действием оператора в Admin UI, а не полем managed документа. Allowlist сохраняется в runtime-таблице и отделена от config publish. Коннектор не принимает arbitrary target URL в HTTP запросе.

## Клиент и интеграции

Config bootstrap выполняется до сетевых задач Lampa, с ограниченным timeout и last-known-good. Собственный локальный UI появляется без Pi; новые каталоги требуют настроенного metadata backend. Смена config не прерывает текущее видео. Polling с ETag при старте/foreground и периодически, без обязательных WS.

Jackett upstream сейчас использует `/api/v2.0/indexers/{all|status:healthy}/results?apikey=...&Query=...` (`src/core/api/sources/parser.js:292`). Этот контракт можно подтвердить исходниками; API key добавляет server connector, не браузер. MetadataProvider изолирует UI; mapping неизвестного TMDB Proxy реализуется после его аудита. Никакого автоматического CUB/public proxy fallback при ошибке.

Торрентный media поток предпочтительно TV→TorrServer напрямую, не через Pi. Если конкретный TorrServer требует credentials, нужен отдельно спроектированный узкий gateway, а не выдача серверных секретов клиенту или generic proxy. Поддержка media/Range проверяется на фактическом пути.

Lite profile обязан исключить сетевые CUB-пути до startup, включая пользовательские mirrors, cached plugins/JS и динамические fallback. Статический grep недостаточен: browser request capture и отрицательные tests должны ловить XHR/fetch/script/image/WS. Запрет firewall, при котором запрос всё равно пытается уйти, не считается zero-CUB.

## Удобный setup Pi

Пользователь запускает `./setup.sh` из clone проекта. Скрипт проверяет64-bit ОС, Docker Compose, свободный диск, создаёт только недостающие локальные конфиги/volume и запускает `docker compose up -d --build`. Не перезаписывает существующие данные и не требует Telegram/домена/сертификата/аккаунта.

Если Docker отсутствует, скрипт даёт точные официальные команды установки; скрытого `curl | sudo sh` нет. После запуска печатает адрес `/admin/`, где вводятся подключения. Первый релиз пока не опубликован, поэтому не ссылаться на несуществующие images/install archives. Локальная сборка на Pi нужна для текущего unreleased состояния; готовые ARM64 images — следующий шаг после разрешения публикации.

Compose: один обязательный сервис `lampa`, один постоянный volume с единой SQLite БД config revisions/runtime secrets/LAN origins. Multi-stage build содержит клиентские dev dependencies только в builder, runtime — Node, server dependencies и готовую статику. Health/readiness не зависят от Jackett/TMDB/TorrServer. Отключение внешнего сервиса показывает degraded status, не вызывает restart loop. Backup SQLite через backup API или после остановки writer; один живой sqlite файл без WAL не копировать.

## Три небольших подпроекта

1. **Управление:** LAN API, Admin UI, secret references/connector policy и клиентский config bridge. Первый implementation plan ниже. Без Lite-доказательства этот этап не объявляется zero-CUB.
2. **Lite клиент:** исключение CUB/лишних сервисов из import graph, меню/settings, профильная local-state миграция, TMDB/Jackett адаптеры и network acceptance. Начинается после стабильного config contract; неизвестный Proxy mapping ждёт репозитория, остальная очистка независима.
3. **Доставка:** один Compose сервис, повторяемый setup, backup/upgrade, ARM64 validation и локальный webOS wrapper. Default внешние Jackett/TorrServer не затрагиваются.

Каждый подпроект разбивается на небольшие reviewable задачи, не один MR на весь Lite. Terra medium — implementation/review; Sol medium — только финальный review; Luna — лишь полностью механические локальные задачи.

## Acceptance полного Lite

- С чистого clone на Pi доступна `/admin/`; повтор setup сохраняет БД и настройки.
- Из браузера ПК задаются три подключения; secrets не оказываются в response/export/log; stale save даёт conflict.
- Клиент получает effective settings; offline boot/last-known-good работают, playback не обрывается от config refresh.
- Поиск Jackett и playback через TorrServer сохранены, полезные local-state данные не потеряны.
- Lite UI/build не содержит удалённых возможностей; startup и обычные сценарии не инициируют CUB-запросы.
- Реальные Proxy/TV/Pi проверки явно отделены от fixture/emulator/amd64 тестов. IPK installation/playback не заявляются проверенными без TV.

## Осталось внешне подтвердить

Контракт и repository TMDB Proxy; реальные адреса/credentials подключений вводятся в UI/secure local settings, не в чат; LG model/firmware и реальный Pi для аппаратного acceptance. Текущие backend/build tests не заменяют эти проверки. Лицензионные notices сохраняются, конфликт GPLv2/ISC остаётся вопросом распространения, не поводом блокировать разрешённую локальную разработку.


## Решения после builder check

- Существующие client-local настройки не стираются и не загружаются на Pi автоматически. Миграция предлагает preview и явный import. Пока оператор не назначил managed override, используются прежние локальные подключения. Managed заданные поля имеют приоритет только после успешной валидации и сохранения LKG. Второй Jackett URL/key, режим primary/backup/both, all/healthy; TorrServer primary/backup/selection, auth login/password, preload/saveDB/GST/timecode не теряются. Schema расширяется optional полями обратно совместимо в client/connector этапе; до него исходные локальные controls работают без изменения.
- Authenticated TorrServer сохраняется как поддерживаемый сценарий: сначала подтвердить Basic auth путь по `src/utils/reguest.js` и `src/services/torrserver.js`, затем узкий gateway для управляющих запросов и media с Range/backpressure/abort. Логин/пароль с ПК сохраняются secret ref, не выдаются TV. Если auth выключен, media остаётся прямым. Lite rollout не должен отключать старую auth-настройку до готовности gateway.
- Packaged TV получает локальный экран ручного ввода Pi URL; URL и stable deviceId хранятся локально независимо от server policy. Браузер `/app/` использует same-origin. Только read-only client/config/metadata/search endpoints могут разрешать конкретный TV Origin; `Origin:null` для packaged/file приложений — отдельный opt-in в runtime settings, без credentials. Admin writes никогда не получают wildcard/null CORS. Реальный webOS Origin проверяется на TV; discovery не зависит от сканирования сети или mDNS.
- Lite API имеет capability policy поверх общей schema: metadata только tmdb, parser только jackett; sync/plugins=true, непустые generic plugins/sources и другие активные providers отклоняются `UNSUPPORTED_CAPABILITY`. Архивные административные revisions можно читать, но publish/rollback/effective повторно проверяются. Не молча удалять запрещённые поля: UI показывает conversion preview и требует явного сохранения исправленного документа. Клиент при422 сохраняет прошлый LKG, свежий — локальные defaults. Это не изменение существующего generic config-core контракта.
- Runtime secrets и LAN origins находятся в той же SQLite БД, отдельные таблицы и migration user_version2. Один consistent SQLite backup восстанавливает одновременно refs, values и policy. Экспорт managed JSON всё равно исключает secrets. Новый DB schemaVersion2 и managed JSON schemaVersion1 — независимые версии. Существующий version1 мигрируется без потери revisions; будущий неизвестный DB version отклоняется. Это проще и надёжнее координации трёх независимых файлов.

- Lite capability validation подключается как дополнительный pure validator внутри существующего service transaction callback: global publish/rollback проверяет candidate и все device overrides, device publish — свой effective config. Preflight UI/API preview не заменяет повторную проверку внутри BEGIN IMMEDIATE. Generic core по умолчанию сохраняет прежнее поведение; Lite server включает validator явно. Effective GET читает согласованный список heads одним запросом и проверяет ту же policy.

## Текущее исполнение

Первый control-panel план реализован и проверен. HTTP/API/Admin/runtime store готовы; client bridge, transport adapters, CUB cleanup и Pi delivery остаются отдельными этапами. Существующие client-local Jackett/TorrServer настройки не изменены. См. execution report в первом плане.
