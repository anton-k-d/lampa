# ИИ-подборки Lampa Home

Статус: реализовано по одобренному пользователем плану; проверка реального OpenAI и физического TV остаётся ручной. Sing-box/VLESS, маршрутизация и диагностика OpenAI-доступа исключены из этого этапа по прямому уточнению пользователя.

## Результат

- Главная: ряд «Для тебя», до 12 обычных карточек Lampa, новая подборка ежедневно, ручное обновление.
- Карточка фильма/сериала: видимая кнопка «ИИ-подборка», отдельный экран обычных карточек с пояснением выбора.
- История и избранное обязательно участвуют. Существующее локальное состояние и «Продолжить просмотр» не изменяются.
- Pi выполняет подготовку кандидатов, вызов OpenAI и хранение SQLite. OpenAI выполняет модельный inference; локальная LLM не нужна.

## Выбранный подход и альтернативы

Предложение координатора: модуль текущего Node-сервера и существующая SQLite. Отдельный проект/контейнер пока только усложнит конфигурацию и backup. Запрос OpenAI с телевизора плохо подходит для общего кэша, ежедневного расписания и контроля расходов.

Выбирать из проверенных TMDB-кандидатов и ранжировать через OpenAI дешевле и надёжнее, чем просить модель выдумывать названия и затем неоднозначно искать их. ИИ не создаёт карточки: возвращает ключи кандидатов и объяснения из ограниченного набора. Отдельный search/agent/web-tool workflow, embeddings и vector database не нужны.

## Профили и устройства

Предлагаемый MVP: один профиль `home`, но не одна слитая таблица истории. Храним `ai_profiles`, связь `ai_profile_devices(device_id, profile_id)` и независимые последние снимки каждого устройства. Новый deviceId первоначально относится к `home`. API клиента определяется deviceId; профиль сервер вычисляет сам, а не доверяет переданному клиентом profileId.

Будущее разделение: отдельный профиль для устройства или группы устройств, смена server-side связи, отдельные кэш и лимиты. Исходные снимки не потеряны: их можно перераспределить без обратной миграции общей истории. Кэши, jobs и fingerprints с первого этапа содержат profileId. UI управления профилями и синхронизация истории обратно на TV пока не входят в scope. Это предложенная начальная политика, не ранее подтверждённый пользователем выбор общего профиля.

## Проверенные точки интеграции

- `src/core/favorite.js`: `get`, `all`, `listener`; категории `like`, `wath`, `book`, `history`, `look`, `viewed`, `scheduled`, `continued`, `thrown`. `get()` учитывает текущий источник локальных/CUB-закладок; не читать только raw localStorage.
- `src/interaction/torrent.js`: запись Favorite.history уже при запуске торрента. Это не подтверждение досмотра или положительной оценки.
- `src/interaction/timeline.js`: `read`, `update`, `link`, события `state:changed`, записи с card/season/episode, percent/time/duration/updated. Старые hash-only записи не всегда можно привязать к контенту.
- `src/core/home/config.mjs`, `src/app.js`: готовый deviceId; сбор снимка только после инициализации Favorite/Timeline, не в раннем config task.
- `src/core/content_rows.js:add`, `src/core/recomend.js:init`: штатный механизм дополнительных рядов. `src/components/main.js` использует новый модуль main; `items/old/main.js` deprecated и не должен стать новой точкой интеграции.
- `src/components/full/start.js`, `start/options.js`, `src/components/recommendations.js`: уже есть карточный экран AI recommendations, но `src/core/api/sources/ai.js:recommendations` идёт через CUB `ai/generate/recommend/...`. Новый модуль не должен вызывать этот transport или иметь CUB fallback. Факты и AI search не переносим в этот этап.
- `server/src/config/database.mjs`: текущий user_version=2; новая миграция 2→3 обязана сохранить revisions, runtime secrets и LAN origins.
- TMDB Proxy: подтверждён предоставленным app.js контракт `/3/...`, `/image/...`, ключ подставляется на удалённом proxy. Новые backend TMDB GET используют этот контракт, а не неизвестный новый API.

## Сигналы вкуса и передача состояния

Нормализованный ключ: `tmdb:movie:ID` либо `tmdb:tv:ID`. Одинаковые числовые ID разных типов не объединять. Явно нетипизированные/чужие карточки и hash-only прогресс не угадывать: пропустить с отчётом количества. Для legacy-card без source допускается существующее native предположение TMDB, только если тип однозначен; для явного CUB source нужна подтверждённая TMDB-привязка, не равенство числовых ID.

Лайк — сильный положительный сигнал. «Посмотреть позже» — намерение, не лайк. History — слабый сигнал интереса. Явное «просмотрено» и для фильма progress≥90% исключают его из домашней подборки; положительную оценку из досмотра не выводить. Начатое с реальным прогрессом остаётся в «Продолжить», не в новой подборке. Одна серия не означает завершение сериала: серии сохраняют собственную привязку; начатый сериал можно исключить из новой подборки как продолжаемый, не как досмотренный. Для same-title по умолчанию исключить исходную карточку и уже просмотренное.

Формат records v1: `{key:"tmdb:movie:123",signals:["liked","history"],rank:0,lastActivityAt:null}`. key соответствует `^tmdb:(movie|tv):[1-9][0-9]{0,11}$`; signals — уникальные значения `liked|bookmarked|planned|history|started|completed|abandoned`, rank — неотрицательный integer или null, lastActivityAt — UTC ISO timestamp или null из реального Timeline.updated, не времени загрузки снимка. `like→liked`, `book→bookmarked` (слабый интерес), `wath/scheduled→planned`, `history→history`, `look/continued→started`, `viewed→completed`, `thrown→abandoned`. Прогресс серии даёт started, не completed сериала; raw episode history в API рекомендаций не копируется. При противоречивых флагах completed/abandoned исключают карточку, но не превращаются в положительную оценку. Если favorite и timeline имеют конфликтующий provider/type, связь пропускается.

Начальное чтение Timeline через `Storage.get(Timeline.filename(), {})` после его init; далее публичные Timeline/state:changed события. Не добавлять сырой global dump хранилища. Native `history` не содержит гарантированного timestamp: сохранять rank, а не выдумывать дату просмотра.

Снимок устройства — полная замена только его предыдущего снимка, атомарно. Не глобальная очистка. Первичная отправка, далее debounce 10 секунд на изменения Favorite/Timeline, контрольный sync при foreground и перед ручной генерацией. Последний снимок на устройстве переживает offline; повтор с тем же seq/digest идемпотентен. Старый seq отклоняется. Digest не зависит от upload time и непрерывного движения таймкода: для рекомендаций нужны семантические состояния, а не каждое обновление секунды.

Предел MVP: 1000 нормализованных записей и 192 KiB на полный снимок; без synopsis, stream URL, torrent links, cookies и любых API keys. Превышение не обрезать с последующим удалением данных: отклонить, сохранить предыдущий снимок и показать причину. Локальные пользовательские данные не удалять. Без готового начального снимка не запускать персональную генерацию как будто история пустая. Подтверждённый пустой снимок допускает cold-start кандидатов и честную подпись «пока без истории».

## Генерация и расходы

Backend MetadataCatalog получает до 120 уникальных кандидатов из TMDB recommendations/similar от максимум 8 сильных seeds, дополнительных discover/trending для разнообразия. Кэш metadata 24 часа, concurrency 3, общий deadline подготовки 20 секунд; частичная выдача допустима. Использовать закреплённый для профиля TMDB endpoint/locale, в MVP из глобальной конфигурации. При будущем разделении профилей закрепление provider должно быть явным.

До OpenAI отфильтровать seed, просмотренное, начатое, повторы и adult-контент; после ответа проверить снова по свежему профилю. Существующие parental controls при показе сохраняются. Недостаток кандидатов означает меньше 12 карточек, не выдуманные дополнения.

OpenAI Responses API, официальный Node SDK, Structured Outputs. Предлагаемый начальный model=`gpt-4.1-mini`, настраиваемый в админке; недоступная модель — явная ошибка, без автоматического переключения на дорогую. Вход — компактные сигналы вкуса и карточки-кандидаты; store=false, без tools, conversation history и просмотра веба. Фильмы и их описания — данные, а не инструкции для модели.

Выход schema: `{items:[{key,reasonCode,seedKey}]}`, 1–12 элементов; key — enum переданного пула, reasonCode из `similar|liked|genre|discovery`, seedKey из переданных seeds или null. Проверить уникальность и основания: similar/liked требуют связи с seed, genre — пересечения жанров. Человекочитаемые причины создаёт backend шаблонами, поэтому «тот же режиссёр» не появляется без проверенных данных. Карточки и постеры берутся из MetadataCatalog, source=tmdb.

Начальные лимиты: один автоматический home-job в сутки, до двух ручных обновлений home и пяти same-title генераций в сутки на профиль; общий предел 8 исходящих OpenAI attempts/профиль/сутки и 32 на сервер. Cache hit не расходует бюджет. Лимиты и отключение — в админке. max_output_tokens=2500, SDK maxRetries=0. Приложение допускает один retry только для 429/5xx с учётом Retry-After и бюджета. Timeout, refusal, invalid schema и 4xx не запускают скрытую платную «починку» ответа.

Дата бюджета/расписания: timezone Europe/Moscow, ежедневная проверка готовности после 04:00; это предлагаемые defaults. Backend проверяет due раз в минуту и на старте, догоняет один пропущенный день, не генерирует все пропущенные даты. GET карточек никогда не вызывает платную генерацию. Каждый attempt резервируется транзакцией до запроса, включая исходы с неизвестной стоимостью; лимит не освобождается после timeout. Usage из ответа учитывается отдельно, точную стоимость не выдумывать без актуального прайса.

Один worker в Node, durable jobs в SQLite, уникальные idempotency keys, lease с fencing token. Одновременные запросы двух TV возвращают один job. Работа после рестарта не заменяет результат устаревшего worker. Не держать DB-транзакцию во время внешнего HTTP. Старую успешную подборку показывать при сбое, с временем обновления. При смене истории не перегенерировать автоматически каждый раз: фильтровать старые результаты, новая генерация — по расписанию или явной кнопке.

Таблицы новой миграции: ai_profiles(id, revision), ai_profile_devices(device_id PK, profile_id FK), ai_device_signals(device_id PK/FK, seq, digest, records_json, updated_at), ai_settings(singleton id, revision, document_json), ai_jobs(id, profile_id, kind, cache_key, mutation_id, request_digest, state, lease_until, fencing_token, attempts, created_at, error_code), ai_attempts(id, job_id nullable, profile_id nullable, budget_date, outcome, usage_json), ai_batches(id, profile_id, kind, cache_key, items_json, provenance_json, generated_at, expires_at), ai_metadata_cache(key, value_json, fetched_at, expires_at). Для home одновременно активен только один job профиля независимо от ручного/автоматического запуска; для similar активный job уникален на `(profile_id,kind,cache_key)`. Это partial unique indexes для queued/running. mutation_id проверяется вместе с request_digest, повтор с другим seed — 409. Миграция создаёт полный согласованный набор таблиц одним MR T2; следующие задачи не меняют уже применённый SQL версии 3.

Automatic home identity — profileId+локальная дата; ручной refresh после завершённого batch создаёт новую генерацию, а не возвращает кэш навсегда. При этом любой уже queued/running home job возвращается обоим TV, новый платный job не создаётся. Явный same-title POST возвращает неистёкший кэш без генерации. Параметры модели/провайдера и версии prompt фиксируются в provenance job до внешнего запроса.

Same-title cache: profileId, seed type/id, locale, semantic profile digest, provider/config revision, model/prompt version; TTL 7 суток. Home публикуется как последний успешный batch профиля; содержит provenance и snapshot digest, но read-time изменение истории не создаёт новый платный job.

## API и конфигурация (новые предлагаемые контракты)

- `PUT /v1/devices/{id}/recommendations/signals` — `{schemaVersion:1,seq,digest,records:[...]}`, atomic ingest; ответ `{acceptedSeq,profileRevision,skipped}`.
- `GET /v1/devices/{id}/recommendations/home` — последний batch `{state,generatedAt,stale,profileRevision,items:[{card,reason}],jobId?}`.
- `POST /v1/devices/{id}/recommendations/home/refresh` — ручной job, Idempotency-Key, 202 `{jobId}` или актуальный running job.
- `GET /v1/devices/{id}/recommendations/similar?type=movie&id=...` — только чтение кэша; miss не вызывает OpenAI.
- `POST /v1/devices/{id}/recommendations/similar` — `{type,id}`, явное создание job либо ready cache, Idempotency-Key.
- `GET /v1/devices/{id}/recommendations/jobs/{jobId}` — статус только профиля устройства. Поля state: disabled, needs_history, queued, running, ready, failed. Нельзя читать чужой профиль сменой jobId.
- `GET/PUT /v1/admin/ai/config` — отдельная versioned schema/CAS, enabled/model/locale/timezone/schedule/limits/openaiCredentialRef. Не расширять managed config v1 только ради backend AI.
- `GET /v1/admin/ai/status` — состояние, безопасный errorCode, usage/attempts, timestamps, без prompts/history/keys. `POST /v1/admin/ai/test` — проверка выбранной модели по явному действию, тоже учитывается в бюджете.

OpenAI key вводится write-only через существующий runtime secret store; AI config хранит ref. Не включать его в client-config или экспорт. Это отдельная backend-политика, не автоматическое продолжение разрешения выдавать Jackett key в LAN. В OpenAI уходят названия/ID/жанры и выбранные сигналы вкуса; не вся raw история, не данные подключений. Raw prompts/response bodies не логировать. Экспорт AI config заменяет credential ref на placeholder. Нынешние Host/same-origin guards и отсутствие LAN-авторизации сохраняются; сетевую конфигурацию не менять.

## UI и пределы этапа

ContentRows-ряд «Для тебя» на главной, отдельная кнопка обновления со статусом и временем генерации. Нормальный старт/каталоги не ждут OpenAI. Кнопка внутри полной карточки добавляется к native кнопкам и открывает отдельный компонент Home recommendations с loading/retry/empty/stale. Изменять экран, когда пользователь уже ушёл, нельзя; Back отменяет ожидание клиента, а не общий job другого TV. Reason — textContent, навигация штатная: стрелки/OK/Magic Remote/Back.

Для текущего ContentRows.call асинхронная row.call возвращает массив callbacks `[function(resolve){...}]` — не одиночную функцию. Готовую строку формировать тем же форматом, что `src/core/recomend.js`, с ограниченным чтением кэша; pending/error AI не должны удерживать основной каталог. Не заменять весь main-renderer ради одного ряда.

В scope не входят перенос всей CUB AI-подсистемы, AI facts/search/chat, локальная модель, отдельный сервис, маршрутизация sing-box, публикация релиза и UI индивидуальных профилей. Проверки на реальном TV и с реальным OpenAI key отмечаются отдельно от fixtures.

## Дополнения пользователя при разрешении реализации

План одобрен для полной реализации в параллельных субагентах. Отдельные независимые задачи:

- Русская озвучка в списке торрентов: приоритет `RUS Дубляж`, затем `RUS`; UKR-only не должен выделяться как предпочтительный. Нормализовать ru/rus/Russian, учитывать несколько дорожек, не путать русские субтитры с озвучкой. RU+UKR остаётся подходящим. Не считать один маркер DUB подтверждением русского языка. При неполных метаданных не выдумывать наличие RU и не терять весь список без понятного управления фильтром.
- В ручных действиях Lampa Home показывать уведомления о начале обновления, успешном применении, отсутствии изменений и ошибке. Автоматическая фоновая синхронизация не должна засыпать пользователя уведомлениями.

Уточнение пользователя после проверки: UKR оказался обычной меткой перечисленных в торренте дорожек, а не выделением интерфейса. Не считать это дефектом и не вводить жёсткое скрытие торрентов/меток других языков. Сохранять все дорожки, только приоритет отображения/раздач с подтверждёнными RUS и русским дубляжом; автоматический выбор дорожки плеера не менять.
