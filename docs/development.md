# Development

Run the following commands from the checkout root. Use Node.js 24.22.1 and npm 11.9.0 (the versions used in CI), then install the locked dependencies:

```sh
npm ci
```

For local development, `npm start` runs the legacy Gulp watcher. It is a long-running development process, not a finite production build; its watcher behavior is inherited from upstream.

```sh
npm start
```

Build both targets with:

```sh
SOURCE_DATE_EPOCH=1700000000 npm run build:web
SOURCE_DATE_EPOCH=1700000000 npm run build:webos
node scripts/check-build.mjs web
node scripts/check-build.mjs webos
```

The web output is `build/github/lampa/` and the webOS output is `build/webos/`. Each build cleans its own output and validates its artifacts. The fixed epoch makes generated timestamps reproducible; CI builds each target twice and compares the file hashes. Without it, builds use the current time. The webOS output is a web application tree, not an IPK, and validation does not establish TV runtime compatibility. See [webOS packaging](webos-packaging.md).

Run the build helper tests and the full upstream regression suite with:

```sh
node --test scripts/build.test.mjs
npx --no-install vitest run --threads=false
```

The upstream baseline currently exits nonzero: 11 suites pass and 2 fail, with 127 tests passed and 1 failed. In `spec/episode_menu.spec.js`, the standard-source VM lacks `window` (`ReferenceError: window is not defined`). `spec/torrent_preload.spec.js` fails to load because it cannot find the torrent preload implementation (`TORRENT_PRELOAD_POLL_MS`). CI runs this suite in an independent job so its failure remains visible while build validation runs. Sass emits upstream deprecation warnings during builds.

CUB integration remains in the application; see [CUB removal](cub-removal.md). The TMDB Proxy is not integrated; [the provider contract](tmdb-provider-contract.md) describes planned work, not an implemented API. The upstream `LICENSE` states GPLv2 while package metadata says ISC. This unresolved conflict is a release blocker and requires license review before release. See [upstream audit](upstream-audit.md).

## Internal configuration core

The isolated core uses Node.js 24.22.1 and npm 11.9.0. Install and test it independently of the root dependencies:

```sh
npm --prefix server ci
npm --prefix server test
```

The server implements HTTP configuration, revision, preview, and rollback endpoints and the LAN admin panel without authentication. Pairing, sync, a CLI, and the Lampa client connection remain future work. See [configuration system](config-system.md) for the contract and implementation boundary.

Place SQLite on a local filesystem outside Git; WAL, foreign keys, a 5000 ms busy timeout and FULL synchronous mode are configured by the core. Back up a consistent database with SQLite's backup facilities, or close all connections before copying the database; copying only the main file while WAL is active can lose committed data. Do not use a network mount. Database files and WAL/SHM companions must not be committed. Real Pi/ARM64 testing remains outstanding.

### Local configuration panel

Run `npm --prefix server ci` and `npm --prefix server start`, then open
`http://127.0.0.1:8080/admin/`. The panel and API are intended for a trusted
LAN without login; do not expose it publicly. For trusted LAN access, replace
the example IP and hostname below with the addresses used by your devices:

```sh
HOST=0.0.0.0 ALLOWED_HOSTS='192.168.1.50,raspberrypi.local,localhost,127.0.0.1' npm --prefix server start
```

Open `http://192.168.1.50:8080/admin/` using the actual LAN address. Binding
`HOST=0.0.0.0` alone does not allow requests addressed to that IP; include
each hostname or IP used by browsers in `ALLOWED_HOSTS`, without ports.

Runtime environment variables:

- `HOST`: bind address, default `127.0.0.1`.
- `PORT`: listen port, default `8080`.
- `ALLOWED_HOSTS`: comma-separated hostnames or IPs without ports; default is
  the bind host plus `localhost` and `127.0.0.1`.
- `DATABASE_PATH`: SQLite file path; overrides `RUNTIME_DIRECTORY`.
- `RUNTIME_DIRECTORY`: database directory when `DATABASE_PATH` is unset;
  default `server/.data`, with file `config.sqlite`.
- `CLIENT_ROOT`: static client directory for `/app/`; default
  `build/github/lampa` at the repository root.

The database parent directory must be owned by the server user and private
(mode `0700`); the server creates a missing parent directory with that mode
and uses mode `0600` for its database file. Use a dedicated directory rather
than changing permissions on a shared directory such as `/tmp`.
The panel stores settings only: client connection and service integrations
are not implemented yet. Existing local application settings are not migrated.

Run backend tests with `npm --prefix server test`. For real-browser tests run
`npx --prefix server playwright install chromium` and
`npm --prefix server run test:browser`. To use an existing local Chromium,
set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable. The browser tests
start the real server with a private temporary database and contact no upstreams.
