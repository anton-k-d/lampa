# Развёртывание домашнего сервера на Raspberry Pi 4

Статус: проектирование, 2026-11-09. Ни сервисы, ни контейнеры, ни установщики не запускались. Compose ниже — пример будущей структуры, не готовый дистрибутив. В этом репозитории ещё нет реализованных Config API, Admin, образов или setup wizard.

Актуальный scope от 2026-11-10: пользователь отложил авторизацию и pairing для ближайшего LAN-прототипа. Шаги создания admin credentials и защищённого pairing ниже относятся к будущему защищённому варианту, не к обязательной первоначальной установке текущего локального проекта. Compose/wizard по-прежнему проект, не реализованный installer. См. [roadmap](roadmap.md).

## Границы системы

Цель — Raspberry Pi 4 с 64-битной ОС Linux и Docker Compose plugin. TV получает локальную IPK-оболочку: её настройки и экран недоступности открываются без Pi, см. [webos-packaging.md](webos-packaging.md). Pi обслуживает статику, конфигурацию и администрирование; интернет-каталог, внешнее видео и сторонние прокси не становятся автономными от этого размещения.

```text
TV (локальный UI) ─┬─ Config API через reverse proxy ─ SQLite
                  ├─ статика / публичная конфигурация
                  ├─ backend metadata adapter ─ внешний TMDB Proxy (контракт неизвестен)
                  └─ источник HTTP video / optional TorrServer
Admin browser ─────── reverse proxy ─ Admin UI + защищённый Admin API
                                     └ adapter ─ внешний parser (опционально)
```

Reverse proxy — единственная точка входа: `/app/` и `/admin/` отдают статику, `/v1/devices/self/config` — effective-конфигурацию TV, `/v1/admin/...` — операции администратора, `/v1/sync/...` — синхронизацию пользовательского состояния согласно [config-system.md](config-system.md). Конкретные URL и JSON — проектируемый контракт, не существующие endpoints. Admin API проверяет авторизацию независимо от UI и reverse proxy. SQLite хранит настройки и версии схемы, pairing/revocation и аудит административных изменений; media cache в базу не помещать. Один процесс записи и локальный SSD предпочтительнее сетевой файловой системы.

Внешний TMDB Proxy — настраиваемый отдельный поставщик. Пока неизвестны base URL, аутентификация, rate limits, схема ошибок, image URLs, CORS, SLA и условия использования. Не подменять его «универсальным CORS proxy» или прямым TMDB без согласованного контракта. Wizard должен различать недоступный сервер конфигурации и недоступный каталог. Baseline: TV обращается к backend metadata gateway route; при секретах поставщика или необходимости mapping/нормализации backend добавляет серверные credentials и преобразует контракт. Точный путь adapter endpoint будет закреплён после выяснения контракта proxy; `/v1/...` control endpoints выше от него не зависят. Direct TV→proxy допустим только в явно включённом и проверенном режиме без секретов, с подтверждёнными CORS, TLS и совместимой схемой; это не автоматический fallback. Не добавлять open proxy. TMDB attribution и условия использования проверить до публичной доставки.

TorrServer и parser/indexer — опциональные внешние интеграции, отключённые по умолчанию. Их развёртывание не входит в MVP и Compose этого проекта. Конфигурация MVP, каталог и настройка TV не должны зависеть от их наличия. Нужны отдельные права доступа и проверка возможностей внешних endpoint. Использовать только разрешённые пользователю источники; транскодирование и публичный поиск не входят в обязательный baseline.

## Предлагаемая установка с чистой Raspberry Pi OS 64-bit

Это будущий пользовательский сценарий: нашего `install.sh`, release archive и preflight ещё нет. Команды ниже описывают ожидаемый интерфейс релиза и здесь не выполнялись.

1. Через Raspberry Pi Imager установить поддерживаемую Raspberry Pi OS Lite **64-bit**, настроить пользователя, Ethernet/Wi-Fi и SSH при необходимости. Обновить ОС, проверить `uname -m` (`aarch64`), время, DNS, свободное место и питание. Зафиксировать LAN-адрес через DHCP reservation; подготовить SSD под постоянные данные.
2. Установить Docker Engine и Compose plugin по [официальной инструкции Docker для Debian](https://docs.docker.com/engine/install/debian/), предварительно сверив поддержку текущей Raspberry Pi OS и arm64. Нужны sudo, CA certificates и curl; удалить конфликтующие пакеты только после проверки инструкции, добавить официальный apt key/repository с корректным Debian codename, затем пакеты `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, `docker-compose-plugin`. Проверить `sudo docker version` и `sudo docker compose version`. Членство в группе docker даёт права уровня root и для сценария с sudo не требуется.
3. Скачать **конкретный** подписанный/опубликованный релиз проекта и его SHA-256 manifest с доверенного release channel, проверить подпись manifest или его контрольную сумму по независимому доверенному каналу, затем `sha256sum -c SHA256SUMS`. Не использовать `curl | sh`, плавающий latest или случайный selfhosted installer. Распаковать в `/srv/lampa/releases/<version>`; архив должен содержать Compose, статику, шаблон `.env`, preflight и manifest digest образов.
4. По шаблону создать `/srv/lampa/.env`, указать `LAN_BIND_IP=192.168.1.20` (пример; фактический адрес Pi), hostname/base URL, TLS-режим и выбранный закреплённый релиз. Создать закрытый каталог secrets, session secret и одноразовый bootstrap-код с правами владельца; подготовить database/plugin volumes с uid релиза. Поставщик metadata настраивается в wizard; его ключ не записывается в публичную `.env` или статику.
5. Выполнить предлагаемый релизный `./preflight` и `sudo docker compose --env-file /srv/lampa/.env config --quiet` из каталога релиза. Preflight обязан проверить architecture/OS, занятость порта 443, существование bind IP, корректность URL/TLS и trust chain, permissions/volumes, запас диска, секреты, manifest/digests и отсутствие публично открытого Admin. Пока проверки не пройдены, запуск не выполнять.
6. После успешной проверки выполнить `sudo docker compose --env-file /srv/lampa/.env pull`, затем `sudo docker compose --env-file /srv/lampa/.env up -d`; проверить `sudo docker compose --env-file /srv/lampa/.env ps` и health/logs. Реальный release Compose закрепляет образы digest, в отличие от schematic YAML ниже.
7. Открыть `https://<имя-Pi>/admin/`, проверить доверие сертификату, ввести bootstrap-код и пройти wizard ниже. Подключить TV, проверить локальный старт при выключенном Pi, каталог, тестовое видео и пробный backup→restore. Только после этого считать домашнюю установку принятой.

## Минимальный setup wizard: сценарий

1. На Pi заранее подготовлены проверенный релиз и тома. Администратор открывает локальный адрес, указанный установкой. DHCP reservation и имя DNS предпочтительнее меняющегося IP; mDNS на TV не считать гарантией.
2. Пока сервер не инициализирован, wizard требует одноразовый bootstrap-код из локального защищённого файла/консоли. «Первый посетитель становится админом» запрещён. Создаются admin credentials, секрет сессий и закрывается bootstrap endpoint.
3. Администратор задаёт публичный адрес Pi, имя устройства/инстанса, часовой пояс и режим LAN/HTTPS. Проверяются допустимые URL, DNS, сертификат и отсутствие внешнего доступа к Admin. Нельзя заявить доступность с TV по успешному запросу с Pi.
4. Вводятся URL и, если требуется, серверный credential TMDB Proxy. Невредоносный тест показывает задержку и категории ошибок; ключи маскируются и не попадают в логи. При отсутствии параметров можно сохранить черновик и закончить настройку TV без каталога.
5. TV показывает локальный экран ввода адреса Pi и pairing-код/поток. Admin подтверждает устройство. TV получает отдельный отзываемый credential с config-read и, если включена синхронизация, sync-read/write строго назначенных профилей; admin token туда не передаётся. QR — дополнение, все действия доступны пультом.
6. Wizard отдельно проверяет Config API, версию контракта, каталог и доступный тестовый media URL. Отмечает, что playback тест на Pi не равен тесту TV. Адреса внешних TorrServer/parser предлагаются только после базовой настройки.
7. Показываются адрес Admin, процедура backup/restore, состояние проверки TV и незавершённые шаги. Повторный запуск изменяет настройки атомарно, сохраняет предыдущую рабочую версию и не сбрасывает устройства.

Wizard не требует Telegram, публичного домена или проброса портов для домашнего baseline. Начальные незавершённые настройки не открывают пустую админку без защиты.

## Compose: только схема будущего релиза

Все `example.invalid` — намеренно несуществующие placeholders. Образы и healthcheck-бинарники предстоит реализовать и проверить; этот YAML нельзя использовать как инструкцию запуска. Выпуск должен закреплять digest каждого образа и содержать ARM64 manifest. Путь `/srv/lampa` — предлагаемая раскладка, здесь не создан.

```yaml
name: lampa
services:
  gateway:
    image: example.invalid/lampa/gateway:RELEASE_PIN
    ports:
      - "${LAN_BIND_IP}:443:8443"
    volumes:
      - ./config/gateway.conf:/etc/gateway/config:ro
      - ./releases/current/static:/srv/static:ro
      - certs:/var/lib/gateway/certs
      - plugin-assets:/srv/plugins:ro
    read_only: true
    tmpfs: ["/tmp", "/run"]
    security_opt: ["no-new-privileges:true"]
    cap_drop: ["ALL"]
    restart: unless-stopped
    depends_on:
      config-api:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "/usr/local/bin/healthcheck"]
      interval: 30s
      timeout: 5s
      retries: 3
    mem_limit: 128m
    cpus: 0.5
    logging: &logs
      driver: json-file
      options: {max-size: "10m", max-file: "3"}
  config-api:
    image: example.invalid/lampa/config-api:RELEASE_PIN
    user: "10001:10001"
    expose: ["8080"]
    environment:
      DATABASE_PATH: /data/config.sqlite
      SESSION_SECRET_FILE: /run/secrets/session_secret
    secrets: [session_secret]
    volumes:
      - database:/data
    read_only: true
    tmpfs: ["/tmp"]
    security_opt: ["no-new-privileges:true"]
    cap_drop: ["ALL"]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "/usr/local/bin/healthcheck"]
      interval: 30s
      timeout: 5s
      retries: 3
    mem_limit: 256m
    cpus: 1.0
    logging: *logs
secrets:
  session_secret:
    file: ./secrets/session-secret
volumes:
  database:
  certs:
  plugin-assets:
```

Admin UI — статический артефакт gateway, его операции — в Config API; отдельный Admin container для baseline не нужен. Реальные пути томов/uid, non-root gateway, tmpfs и healthcheck должны соответствовать собранным образам. Compose secrets в обычном Docker Compose — файловый mount, не зашифрованное хранилище. Права host-файлов и backup критичны.

Gateway передаёт запросы только известным upstream и явно допускает media Range/206, корректные Content-Type и streaming timeouts, если поток проходит через него. Не буферизовать целиком видео и не ограничивать media JSON-лимитами API. Для больших потоков предпочтителен прямой TV→media endpoint с собственной авторизацией; нельзя открывать optional порт публично ради обхода CORS. Наличие `depends_on` не заменяет runtime retry: после старта Pi может потерять внешнюю сеть.

## Данные, backup и обновление

Постоянные данные: SQLite и миграции, конфигурация gateway, credentials/session secrets, сертификаты, refs/настройки внешних интеграций, plugin assets и manifest закреплённых версий. Статические релизы воспроизводимы, media cache исключается из backup. SQLite volume — долгосрочное состояние: global/device config revisions, pairing/revocation, аудит и пользовательские history/favorites/progress при включённой синхронизации. Его нельзя заменять пустым томом при обновлении. `plugin-assets` — отдельный постоянный том с утверждёнными JS/assets и manifest хешей; релиз UI не должен удалять его содержимое. Gateway читает его read-only; запись/обновление выполняется отдельной доверенной административной операцией с проверкой checksum и атомарным переключением версии. Ссылки и policy хранятся в SQLite, сами файлы — в plugin-assets; backup сохраняет согласованную пару. Каталог секретов доступен только владельцу; backup содержит чувствительные данные и должен шифроваться отдельно от сервера.

SQLite backup создавать через SQLite backup API/команду `.backup` либо после остановки writer. Копирование одного живого `.sqlite` без учёта WAL не является корректной процедурой. Backup включает версию приложения/схемы, контрольные суммы и дату. Минимальная политика — ежедневный backup, несколько недель retention и отдельная копия вне Pi; периодически восстанавливать в изолированном тесте и проверять конфигурацию и pairing. Ротация секретов может потребовать повторной привязки TV.

Обновление: сохранить backup и текущий manifest; загрузить заранее проверенные ARM64 образы с закреплёнными digest; проверить место на диске; выполнить миграцию на копии базы; обновить релиз; проверить readiness и тест TV. Не использовать автоматическую пересборку latest upstream на домашнем Pi. Хранить предыдущую статику и образы. Откат после необратимой миграции требует восстановления совместимого backup, а не только старого контейнера. Выбор файла `current`/переключение релиза должен быть атомарным.

Health: gateway liveness не зависит от TMDB; API readiness проверяет схему и доступность локальной БД, но внешний proxy отображает отдельным degraded status. Недоступность каталога не должна вызывать бесконечные рестарты. Docker `unhealthy` само по себе не перезапускает контейнер; нужны наблюдение/уведомления или осознанный watchdog. Отслеживать свободный диск, SQLite errors, uptime, latency/error ratio, throttling и память. Логи без токенов/полных media URL, с ограниченной ротацией.

## Ресурсы и защита

Предварительный бюджет baseline: API до 256 MiB, gateway до 128 MiB плюс ОС и page cache; это лимиты проекта, не измерения. Pi 4 2 GB пригоден как кандидат для лёгкой конфигурации, 4 GB даёт запас кэшу и росту пользовательского состояния. Проверить OOM и длительную работу до обещаний. ARM64 поддержка каждого конкретного тега и sqlite native library пока не подтверждена. Использовать охлаждение, надёжное питание, Ethernet и USB SSD; частые SQLite/WAL/cache записи на microSD повышают риск износа. Кэш при его добавлении ограничивается дисковой квотой/TTL; mem_limit не ограничивает диск. Ресурсы внешнего TorrServer определяет его отдельная установка. Pi 4 не планируется как 4K realtime transcoder.

По умолчанию только домашняя LAN, firewall, закрытый Admin и отсутствие UPnP/port forwarding. Gateway единственный опубликованный сервис; admin маршрут можно дополнительно ограничить отдельным management subnet/VPN. Docker network не является гарантией изоляции от скомпрометированного соседнего контейнера. Защита: CSRF для cookie-сессий, HttpOnly/SameSite/Secure, rate limit login/pairing, ограниченные тела запросов, строгая проверка URL от SSRF/DNS rebinding и редиректов, явный CORS для проверенного origin TV, отзыв device tokens. Пароли хешируются подходящим password hashing алгоритмом; секреты не находятся в Git/статике/TV. Read-only volume плагинов не делает сам JavaScript безопасным: загрузка плагинов — выполнение доверенного кода и требует отдельного решения администратора.

TLS: доверенное TV имя и полная совместимая цепочка предпочтительнее доступа по IP. Let's Encrypt HTTP-01 обычно требует внешней достижимости challenge; для LAN рассмотреть DNS-01 с узко ограниченным DNS token либо внутренний CA при подтверждённой установке доверия на TV. Самоподписанный сертификат без доверия не считать рабочим. Проверить SNI, TLS version, root CA и часы на старом TV; не ослаблять глобально TLS и не отключать проверку сертификата. Явный HTTP LAN fallback допустим только как отдельный принятый режим с ограничениями и не должен уводить admin credentials в открытый Wi-Fi.

## Почему не копировать lampa_selfhosted целиком

Проверен `serezhia/lampa_selfhosted`, commit `16812a1392299c2016dfa9900581beabb947511f`. Это полезный референс gateway, отдельного Dart backend, SQLite, plugin overlay, TorrServer и Jackett. `source/server/lib/database/database.dart` использует Drift/native, `pubspec.yaml` — sqlite3. README одновременно упоминает `database.json`, поэтому описание нельзя считать точной спецификацией хранения без чтения миграций.

Однако проект решает другой сценарий: Telegram auth, sync и transcoding. Его Compose включает optional media как обязательные зависимости gateway, публикует TorrServer 8090, задаёт `TS_HTTPAUTH=false`, использует `latest`/плавающие теги; Dockerfiles клонируют main и устанавливают зависимости во время сборки. Это не baseline безопасного воспроизводимого развёртывания. Установщик `install.sh` не запускался. Наличие Dart/debian образов не доказывает работоспособность всего стека на Pi ARM64.

README заявляет MIT, но отдельного LICENSE в исследованном selfhosted checkout не найдено. У исходного и built Lampa есть GNU GPL version 2 LICENSE, при этом source package.json указывает ISC: конфликт метаданных требует разрешения до распространения производной сборки. Заявление MIT в стороннем README не перелицензирует код Lampa. Нужно отдельно проверить авторство и лицензии custom plugins, патчей, bundled JS/шрифтов и webOSTV.js, сохранить notices и исполнить применимые требования к предоставлению исходников. Нельзя утверждать ни «весь стек MIT», ни готовность к публичной доставке на основании README.

## Блокеры и критерии готовности

Открыты: неизвестный TV и его прошивка; контракт TMDB Proxy; лицензии/конфликт метаданных; недоступные в среде официальные LG docs; непроверенные ARM64 образы и отсутствие реализованного API/релиза. До внедрения нужны реальные тесты LAN/TLS/пульта/playback, backup→restore, outage Pi и внешнего proxy, миграция/откат, отзыв TV credential и setup без optional сервисов. Данная схема не подтверждает успешную установку или производительность.
