# Diagnostics implementation plan

Goal: expose AI usage and manually uploaded client console logs in the existing Pi admin panel. Approved directly by the user's request to start; no separate service or networking work.

## Contracts and decisions

Same-origin routes `/v1/devices/{id}/logs`, `/v1/admin/diagnostics/client-logs`, `/client-logs/{id}`, `/ai`, `/ai/summary` (admin paths share `/v1/admin/diagnostics`). Backend freezes exact payloads in the execution ledger's contracts.md. No CUB fallback. Both native console export actions use the shared Console.upload implementation. AI logs contain timestamps, model, job/profile/type, outcome, duration, token usage and safe errors, never prompts or credentials. Cost is not guessed. Incoming client reports and usage are bounded and redacted before persistence; quotas and idempotency data are independent of diagnostic retention. Existing trusted-LAN Host/same-origin guards remain.

- [x] Backend: migration 3→4, bounded report ingestion/list/detail, AI usage events for jobs/retries/admin tests, cursor pagination/summary, retention. Failing-first tests for migration, redaction, limits, exact usage, unchanged quotas.
- [x] Client: replace console CUB upload with bounded UTF-8 JSON to Pi, retain useful stacks/levels, single-flight and honest notifications. Failing-first helper/browser tests; no secure-context-only browser dependencies.
- [x] Admin: readable Russian AI journal/summary, client report list/detail, refresh/loading/empty/error/pagination; text-only rendering. Tests use hostile strings and unknown usage.
- [x] Independent scoped reviews (Terra medium), then whole-project acceptance review (Sol medium).
- [x] One coordinated WEB build, full server/browser/helper checks, Docker image and migration preservation. Report existing root Vitest failures separately. Real TV/key checks remain owner acceptance.
- [x] Update docs, commit and push main under existing session authorization. No release or remote Pi modifications.

No implementation tasks delegated to Luna because transport, privacy, SQL and UI contracts cross module boundaries. Root coordinator writes plans and makes interface decisions; implementers are Terra medium.


## Execution evidence

Implemented in three parallel Terra medium workers with disjoint ownership; scoped reviews Terra medium, final review Sol medium. Final review reproduced an overlapping-secret redaction defect; regression added, ordering fixed and rereview approved. No model escalation required.

Coordinator checks: full server 145/145, full browser 28/28 (both native upload buttons, Error stack capture, real Pi-server ingestion/admin listing, XSS-safe preview and JSON download), build helpers 10/10, WEB build and Docker image passed. Actual v3 Docker fixture with job/reserved-attempt/runtime key migrated to v4 intact; new reports and AI audit survive restart; retention leaves budget records intact. The previous v3 image starts successfully on the retained v3 backup. No real user API key or physical TV was used.

Root Vitest retains known baseline: 127 passed, episode_menu.spec.js fails because window is undefined, torrent_preload.spec.js cannot find its implementation. No tests were suppressed. Final native upload test was stabilized by waiting for the actual initial main activity, not just appready (native startup schedules it later).

- [ ] Owner acceptance: update Pi after SQLite backup, reopen MSX client, send a real console report and inspect new real OpenAI calls in the admin journal.
