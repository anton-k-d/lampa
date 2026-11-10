# AI Request Inspection Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with disjoint file ownership.

**Goal:** Inspect exact API exchange and compare replay against another model in admin.
**Architecture:** SDK fetch capture → bounded SQLite traces linked to audit events → detail/replay APIs → admin comparison. Replay never publishes recommendation batches.
**Tech Stack:** Existing Node ESM/OpenAI SDK/SQLite/native JS/Playwright.
**Spec:** docs/superpowers/specs/2026-11-10-ai-request-inspection-design.md

## Global Constraints
No auth/network/MCP/Jackett changes. Keys stay backend; prompt/history/output now explicitly requested in logs. 14days/200traces/64MiB; no retention of quota/idempotency ledger. Existing mainintegration authorized. Models gpt-4.1-mini/gpt-4.1/gpt-4.1-nano; no SDKretry; max60s.

## Review Focus
Exact response on invalidJSON/refusal/HTTPerror; truncation/redaction transparency; concurrent/dropped replayresponse idempotency; oldDBmigrationandquota; staleUIselection/XSS.

## Tasks
- [x] Transport (Terra): failingtests for actualSDKfetch request/response capture/error/replay; capture and rankpropagation; no autoreties.
- [x] Backend (Terra): failingtests DB5 migration/retention/detail/reserved idempotent replay/modelvalidation; implement separatetrace/replaymodules and existingauditwiring.
- [x] Admin (Terra): failingbrowser tests exactsafe rawtext/details/paidbutton/comparison/status; implement bounded UI changes and operator docs.
- [x] Integration: scopedreview/finalSolmediumreview, fullserver/browser tests, actualDocker DB4→5 preserve/restart, commit/pushmain. No externalpaidcall without userkey.

## Verification

2026-11-10: full server suite 161/161; full Chromium Playwright suite 35/35. Docker final build passed; packaged admin/service hashes match source. Actual DB4→5 volume migration preserved saved prompts/key/job/reserved quota; raw request/response survived HTTP read and container restart. Old image reopened separate DB4 backup with old job/quota intact. Synthetic containers/volume removed. Root Vitest retains known baseline failures: torrent_preload collection and episode_menu window reference; 127 pass. No real provider call, Pi or physical TV exercised.

Implementation: three Terra medium agents (transport, backend, admin). Final Sol medium review found restart replay left running; owners fixed startup reconciliation and truthful UI statuses with red/green regressions; rereview approved. No model escalation.
