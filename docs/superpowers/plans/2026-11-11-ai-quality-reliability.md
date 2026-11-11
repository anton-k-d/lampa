# AI Quality and Reliability Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with disjoint owners and parallel work explicitly requested by user.

**Goal:** Ten relevant proposals and understandable end-to-end failures.
**Architecture:** Compact web research → strict TMDB resolution/filter → selection counters, safe failure registry and pipeline annotation on existing audit event → native/admin feedback.
**Tech Stack:** Existing Node/OpenAI SDK/SQLite/native JS/Playwright; no new dependencies or DB migration.
**Spec:** docs/superpowers/specs/2026-11-11-ai-quality-reliability.md

## Global Constraints
No MCP/candidate pool/model upgrade/extra paid refill; preserve quotas/idempotency/CAS/rawtrace/citations. API fields additive, safe fixed messages, target10 with honest partial results. Publication authorized by session; root integrates remote updates safely.

## Review Focus
Success response does not prove whole pipeline success; quota errors before job; proxy failure vs all excluded; legacy partial payloads; retry must not duplicate spend; old cached cards survive failed refresh.

## Tasks
- [x] Research (Terra): target10/schema/prompt/similar relevance/validation codes and tests.
- [x] Pipeline (Terra): safe errors, stage diagnostics and selection/read/job contract, strict metadata error classification, tests.
- [x] Native (Terra): reason/action/partial display and explicit retry/status behavior, browser tests.
- [x] Admin (Terra): pipeline vs model status, counts/failure details and docs/browser tests.
- [x] Root: fixture reproduction, integrated tests/build, independent Sol medium final review, commit/push main.

## Integration notes

Operator status confirmed QUOTA_EXCEEDED with configured credentials; operator raised runtime limits. Code defaults and existing counters were not changed. Review found stale displayed counts after history changes, recovery blocked by historical nonretryable errors, stale pending-job guards, and missing explicit refresh for legacy five-card caches. Owners added focused regressions and resolved these before final browser verification. Read-only checks never create a paid request.

## Verification

2026-11-11: root full server192/192, Chromium Playwright51/51 with CLI timeout30s for cloud scheduling (assertion timeouts unchanged), final WEB build validated, diff check clean. Uploaded model responses replay as valid legacy five-title outputs; new SDK request strictly requests10 and forces web search. Operator quota failure confirmed; runtime limits changed by operator, defaults/counters untouched. Known upstream Vitest baseline remains torrent_preload collection and episode_menu window reference failures with127 tests passing. No live OpenAI/proxy/Pi/TV acceptance performed.

Models: four Terra medium implementers, Sol medium final review. Review regressions resolved in same owners; no model escalation. User previously authorized publishing routine completed changes, root commits and pushes main after verification.
