# Client Configuration Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Track steps below.

**Goal:** Apply admin-managed TMDB, Jackett and TorrServer connections in the WEB/MSX client.
**Architecture:** Same-origin client projection, bounded LKG loader and reversible native storage overlay; direct connector credentials are explicitly authorized for this LAN prototype.
**Tech Stack:** Existing Node/SQLite/Ajv server, upstream JavaScript build, Node tests and Playwright.
**Spec:** [client bridge design](../specs/2026-11-10-client-config-bridge-design.md).

## Global Constraints

- Preserve upstream behavior outside managed assignments, existing local data, and admin export secrecy.
- No arbitrary credential dumping, gateway infrastructure, authentication, TMDB proxy edits or claims of zero CUB.
- Maintain old webOS-compatible syntax through the existing build; no secure-context-only APIs.

## Review Focus

- Defaults versus actual assignments, including removed overrides and stale local secondary servers.
- Selected device secret resolution, no-store/ETag behavior and malformed cached configuration.
- Startup timeout, out-of-order polling responses and offline last-known-good behavior.
- Upstream automatic proxy replacing managed TMDB routing, including post-start changes.
- Disabled integrations and refreshing configuration during playback.

## Task 1: Client projection and loader

- [x] Write failing server tests for `/v1/devices/{id}/client-config`, explicit ownership, selected key, device override, invalid policy and ETag.
- [x] Implement a focused projection module and route using consistent heads and existing validation.
- [x] Write failing loader tests for stable ID, strict whitelist validation, LKG, timeout, 304, single-flight and polling; implement the independent client module.

## Task 2: Native integration and acceptance

- [x] Add failing integration tests for native overlay preservation/removal, connector disable, TMDB URL mapping and automatic-proxy precedence.
- [x] Hook after Storage.task, before network initialization; integrate the overlay, TMDB adapter and small native Home status section.
- [x] Test actual built app with local connector fixtures: admin save to client requests, reload/offline/cache and device identity. Do not expose real keys or contact user services.
- [x] Update admin status copy/docs to identify applied and unsupported settings accurately.
- [x] Run full server/browser and build/helper checks; report known upstream Vitest failures separately. Review, then commit/push under existing authorization.


## Execution evidence

- Server suite: 63 passed. Browser suite: 19 passed, including admin save to built-client native TMDB/Jackett/TorrServer requests, stable ID, offline LKG, disable/remove/restore and no reload marker loss. Build helpers: 10 passed. WEB build and checker passed.
- RED/GREEN observed for missing client API/loader, native bridge, readonly managed assignments, selected source, diagnostic key redaction and live Home status rows. Node tests also cover invalid response, ETag/304, timeout/single-flight and late response isolation.
- Actual Docker image built and started in this executor; compiled client, MSX manifest and selected-device credential projection passed. No requests were sent to user services. Physical Pi ARM64/TV playback remains manual acceptance.
- Root Vitest remains at its known baseline: 127 tests passed, episode_menu.spec.js fails because window is undefined, torrent_preload.spec.js fails collection because implementation is missing.
- Terra medium performed the initial audit; its implementation turn failed on usage quota before writing product code. The coordinator completed implementation. Independent final review used Sol medium as requested for whole-subproject acceptance; its two findings were fixed and rereviewed without blockers.
- The user explicitly permitted direct LAN client credentials. Old backend-only-key and not-yet-connected notes are superseded for this increment; generic config API and admin export still return no raw secret values.
