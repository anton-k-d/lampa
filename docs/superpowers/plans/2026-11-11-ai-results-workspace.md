# AI Results Workspace Implementation Plan

> **For agentic workers:** Use subagent-driven development with explicit parallel authorization and disjoint file ownership.

**Goal:** Historical RAW and per-run TMDB card views with model explanations and reusable comparisons.
**Architecture:** Bounded immutable run snapshots + separate explicit reconstruction; additive diagnostics APIs; Cards/RAW admin workspace.
**Tech Stack:** Existing Node/OpenAI SDK/SQLite/native admin JS; no dependencies or DB migration.
**Spec:** docs/superpowers/specs/2026-11-11-ai-results-workspace.md

## Global Constraints
No paid GET/hidden model calls, no comparison publication to TVs, no current metadata falsely labelled historical, rawcopy/quotas/idempotency/CAS intact. Strict catalog IDs. Existing14d/200/64MiB bounds, snapshots256KiB12items. Model reason generated in original call.

## Review Focus
History changes cannot rewrite snapshots; result-only/expired/redacted records; failed matching vs published cards; comparison/reconstruction no quota/cache effects; exact raw copy, untrusted text/images and stale selection.

## Tasks
- [x] Backend (Terra): snapshot storage, pure response parsing, generation/replay integration, preview/history APIs, metadata image URLs, reason prompt, focused tests.
- [x] Admin (Terra): Cards/RAW workspace, card outcomes/reasons/history selection/reconstruction/copy and browser tests.
- [x] Styles (Luna, mechanical): responsive card grid/tabs/state CSS only under frozen class contract.
- [x] Root: integration/fixtures, full tests and final Sol medium review, commit/push preserving remote changes.

## Verification

Backend: 201 tests passed. Full browser run: 52 passed; after the final replay-completion adjustment the affected trace/copy suite passed 13 tests. Task review and final whole-subproject review approved. No live provider requests were used.
