# TMDB: аудит и контракт MetadataProvider

Статус: исследование исходников и предложение границы адаптера; реализации нет. Зафиксирован upstream `yumata/lampa-source`, SHA `86c2b099b19f7058ea304dfa43a8b1e18a2e0492`. API собственного proxy заказчика неизвестен. Ни один маршрут ниже не утверждается как его существующий API.

## Проверяемые вызовы

Все ссылки закреплены SHA. Таблица перечисляет реальные вызовы и владельцев поведения, а не только названия возможностей TMDB.

| Файл / символ | Реальные запросы и поведение | Источник |
|---|---|---|
| `src/core/tmdb/tmdb.js`, `api/image` | API `api.themoviedb.org/3/`; изображения `image.tmdb.org/`; опциональная сборка proxy prefix + полный upstream URL | [L21](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/src/core/tmdb/tmdb.js#L21) |
| `src/core/api/sources/tmdb.js`, `url` | `api_key`, `language`, page/query, genres/keywords/providers/region/companies/networks/sort/original language и произвольные filter-пары | [L231](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/src/core/api/sources/tmdb.js#L231) |
| тот же файл, `search` | Три отдельных `search/movie`, `search/tv`, `search/person`; результаты группируются, пустые группы опускаются | [L807](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/src/core/api/sources/tmdb.js#L807) |
| `main/category/menuCategory/list` | `movie/now_playing`, `movie/upcoming`, movie/tv `popular`, `top_rated`, `trending/movie/day`, movie/tv week, tv `airing_today/on_the_air`, `discover/movie|tv`; фильтры дат/жанров/компаний | [L381](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/src/core/api/sources/tmdb.js#L381), [L986](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/src/core/api/sources/tmdb.js#L986) |
| `full` | `{movie|tv}/{id}?append_to_response=content_ratings,release_dates,external_ids,keywords,alternative_titles,images&include_image_language=…`; отдельно credits/recommendations/similar; collection/{id}; последний сезон TV | [L668](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/src/core/api/sources/tmdb.js#L668) |
| `full/videos` | При пустом overview повтор details на en; videos на выбранном языке и en. Реакции, обсуждения и дополнительная movie metadata запрашиваются у `Api.sources.cub`, а не у TMDB | [L684](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/src/core/api/sources/tmdb.js#L684), [L766](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/src/core/api/sources/tmdb.js#L766) |
| `person/external_ids/company/seasons` | person/{id}, person/{id}/combined_credits; movie/tv external_ids; company/{id}, discover по компании; tv/{id}/season/{number} возвращает episodes | [L886](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/src/core/api/sources/tmdb.js#L886), [L1033](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/src/core/api/sources/tmdb.js#L1033), [L1092](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/src/core/api/sources/tmdb.js#L1092) |
| `get/seasonFix/img` | timeout 10 s, `source/url` в ответе; fallback запрашивает season/1 и делит эпизоды на сезоны; картинки `t/p/{size}/{path}` | [L272](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/src/core/api/sources/tmdb.js#L272) |
| `releaseDate/releasedFilter/list` | movie/{id}/release_dates; домашний релиз типов ≥4; фильтрация будущих премьер; ошибки release check допускают карточку; до пяти переходов на следующую пустую после фильтрации страницу | [L135](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/src/core/api/sources/tmdb.js#L135), [L789](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/src/core/api/sources/tmdb.js#L789) |
| `plugins/tmdb_proxy/tmdb_proxy.js`, `init` | Плагин переопределяет `TMDB.api/image/broken`, использует свои API/image зеркала и добавляет email query; это отдельное поведение от базового prefix proxy | [L87](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/plugins/tmdb_proxy/tmdb_proxy.js#L87) |
| `src/utils/reguest.js`, `cacheGet/cacheName/go` | TTL в минутах, кэш включается `request_caching`; устаревший ответ может использоваться после ошибки; повтор только при положительном attempts, без гарантированной политики backoff | [L398](https://github.com/yumata/lampa-source/blob/86c2b099b19f7058ea304dfa43a8b1e18a2e0492/src/utils/reguest.js#L398) |

В source константа `day=60*24`: details/credits/related/person/video обычно 7 суток, seasons 3 суток, list 2 суток, release_dates сутки. Release-date memory cache отдельно хранит найденную дату без TTL, отсутствие даты — сутки. Не обнаружен отдельный вызов episode details в этом адаптере: эпизоды берутся из сезона. Произвольный `list(params.url)` означает, что перечисление статических строк не является запретом на дополнительные вызовы плагинов.

## Минимальная предлагаемая граница

Frontend не должен формировать URL upstream, хранить API key или понимать маршруты неизвестного proxy. `MetadataProvider` — внутренний интерфейс, transport binding выбирается после получения спецификации proxy. Идентификатор всегда `{provider:"tmdb", kind:"movie"|"tv"|"person", id:string}`; числовые TMDB id сохраняются строкой без переотображения. IMDB/external ids — дополнительные идентификаторы.

```ts
interface MetadataProvider {
  capabilities(): Promise<Capabilities>;
  search(q: SearchQuery, ctx: Context): Promise<Page<Card>>;
  catalog(q: CatalogQuery, ctx: Context): Promise<Page<Card>>;
  details(ref: MediaRef, ctx: Context): Promise<Details>;
  credits(ref: MediaRef, ctx: Context): Promise<Credits>;
  images(ref: MediaRef, ctx: Context): Promise<ImageSet>;
  seasons(ref: MediaRef, ctx: Context): Promise<SeasonSummary[]>;
  episodes(ref: MediaRef, season: number, ctx: Context): Promise<Episode[]>;
}
```

`Context`: locale BCP-47, region ISO-3166, AbortSignal, requestId. `SearchQuery`: query, kinds, page. `CatalogQuery`: kind, list (`popular/topRated/trending/nowPlaying/upcoming/onAir/discover`), trendWindow, page, typed filters (genre ids, dates, years, keyword ids, company/network ids, watch providers/region, original language, sort). Не передавать произвольный URL из UI. Capabilities объявляет поддерживаемые списки/фильтры и optional person/collection/related/videos/externalIds/releaseDates; существующим экранам эти расширения нужны, их отключение должно быть явным.

`Card`: ref, title, originalTitle, overview (nullable), poster/backdrop (nullable ImageRef), releaseDate/firstAirDate (nullable YYYY-MM-DD), voteAverage/voteCount (nullable numbers), genreIds. Person card дополнительно name/profile/knownFor; UI различает kind. `Details` добавляет runtime или episode runtimes, status, genres, countries, languages, companies/networks, externalIds, alternativeTitles, releaseDates/contentRatings, collectionRef и summaries сезонов. Отсутствующие данные — null/пустой массив, не выдуманный ноль/дата. `Credits`: cast с personRef/name/character/order/profile, crew с personRef/name/job/department/profile. `ImageSet`: posters/backdrops/logos с path либо URL, width/height/aspectRatio/language; `ImageRef` разрешается адаптером в HTTPS URL, fallback на placeholder остаётся UI. `Episode`: id, seasonNumber, episodeNumber, name, overview, airDate, runtime, still; specials имеют seasonNumber=0. Не считать нумерацию подряд и не менять canonical номера silently.

`Page<T>`: items, page (фактически полученная upstream page), pageSize, totalPages/totalResults nullable, hasMore, nextPage nullable. Пустая отфильтрованная страница не означает конец. Если включён legacy skip, вернуть фактическую страницу и продолжение; bounded skip ≤5, сохраняя отсутствие точного filtered total. Поиск person/movie/tv ведёт отдельную пагинацию, UI может сгруппировать ответы. Никакого смешения разных page cursors.

Локализация: локализованный title → original title; overview → en → null. Отмечать `resolvedLocale` и `fallbackFields`, не заменять локаль всего документа из-за одного поля. Images выбираются locale base language, en, без языка; videos en дедуплицируются по site/key. Locale и region — часть ключа кэша. Политики child/release/title-filter — отдельная policy-ступень с её version в ключе кэша. Историческое деление сезонов в `seasonFix` вынести в явно обозначенный compatibility transform с provenance, не применять на любую сетевую ошибку.

## Ошибки, повторы и кэш (предлагается)

Единая ошибка `{code,message,requestId,retryable,retryAfterMs?,upstreamStatus?}`: INVALID_ARGUMENT, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, RATE_LIMITED, TIMEOUT, NETWORK, UPSTREAM_UNAVAILABLE, BAD_RESPONSE, CANCELLED, UNSUPPORTED. Детали запроса не должны раскрывать ключи или email. Не превращать 401/403/404/schema error в пустой каталог. Частичные details возвращают `warnings` по optional секциям; отсутствие основной карточки — ошибка. Abort не запускает retry или fallback.

Только idempotent reads: timeout 10 s на попытку, общий бюджет 25 s, максимум 2 повторов при network/timeout/429/502/503/504; exponential jitter 0.5–4 s, уважать Retry-After в пределах бюджета. Не повторять invalid/auth/not-found. Deduplicate in-flight по canonical query. Конкретные лимиты уточнить по proxy SLA.

Кэш ключ: provider + adapter/schema version + operation + canonical args + locale + region + policy revision; исключить credentials и requestId. Предлагаемые начальные TTL: catalog/search 5 min, details/credits/images 24 h, текущие seasons/episodes 1 h, завершённые 24 h; negative 404 1 min, auth/errors не кэшировать. Stale-if-error до 7 суток только успешных публичных данных, ответ содержит fetchedAt/stale; ограничения прав не обходить stale-кэшем. Config revision смены provider инвалидирует namespace. Это новая политика, а не описание upstream TTL.

## Проверка совместимости до подключения

Проверить fixtures для movie/tv/person поиска, всех catalog фильтров, pagination после фильтрации, details с пустой локализацией, credits/images, specials/пропущенных сезонов/неполных дат, 404/429/timeout/abort, partial sections, stale cache и переключения локали. Для каждого вызова записать нормализованный output и mapping к legacy UI. От владельца proxy нужны: base URL, OpenAPI/примеры, auth, passthrough или нормализация, CORS, error/rate-limit формат, image routing/sizes, supported append sections, attribution/licensing и SLA. До этого можно утвердить интерфейс и fixtures, но нельзя утверждать transport compatibility.

## Production-ready требования к будущему аудиту TMDB Proxy

Это backlog для отдельного согласования после доступа к репозиторию, не изменение существующего Proxy.

| Область | Проверяемый результат |
|---|---|
| Контракт | OpenAPI/version policy, реальные примеры всех используемых endpoints, error schema, nullable/optional поля, image sizes/redirect policy; compatibility fixtures закреплены в CI |
| Тесты | Unit mapping/cache, integration с контролируемым upstream, contract tests Lampa, timeout/rate-limit/outage tests, bounded load test с заявленной concurrency; без нагрузки на TMDB вне разрешённых лимитов |
| Cache | TTL и stale policy документированы; bounded bytes/entries, eviction, single-flight; auth/locale/provider/policy isolation; invalidation при изменении контракта; cache hit/miss/stale метрики |
| Observability | Structured logs и requestId; latency p50/p95/p99, upstream status/rate limits, retries, cache size/eviction и in-flight; liveness отдельно от readiness/degraded upstream; секреты и персональные query поля редактируются |
| Безопасность | TLS verification, bounded redirects и egress allowlist, исключение open proxy/SSRF, request/body/time limits, quota per credential/device, rotation backend keys, dependency audit; image endpoint не принимает произвольный URL |
| Ошибки | Согласованный envelope, Retry-After, cancellation, finite retry budget; 401/403 не превращаются в пустой success; cache не возвращает данные другого scope |
| Эксплуатация | Runbook запуска/обновления/rollback, resource budget, backup только нужных данных; immutable release, ARM64 лишь если Proxy требуется запускать на Pi |
| Совместимость | Дифф контрактов до релиза, поддержка текущего и предыдущего IPK, изменение полей через новую major version; проверка attribution и TMDB terms до распространения |

Типы выше — спецификация внутреннего facade. HTTP mapping `/v1/metadata/...` домашнего backend предстоит закрепить в P17 после P16: не считать эти пути API уже существующего Proxy. Baseline transport идёт через Pi; прямой no-secret режим, если нужен, имеет отдельный адаптер и проверяется отдельно.
