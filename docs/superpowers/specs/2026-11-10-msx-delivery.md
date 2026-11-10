# MSX delivery

Serve the existing WEB build from the Pi Home server and provide a Media Station X launcher. The upstream launcher schema is `index/github/msx/start.json`: name, version, parameter and action. Generate those fields locally using the validated request Host: `content:http://HOST/msx/start.json` and `link:http://HOST/app/`. Both GET and HEAD work; responses are no-store, with wildcard CORS only on the launcher. A missing built index returns 503. The stale built launcher path must not expose upstream placeholders.

A Node 24 multi-stage image builds WEB once and installs runtime dependencies at build time. Compose preserves the existing private data directory and defaults to loopback binding; LAN access is opt-in. Document migration and MSX setup. This delivers the existing fork, not client configuration wiring or CUB removal. TV compatibility remains unverified.
