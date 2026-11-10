# Editable Prompts Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent scoped tasks.

**Goal:** Edit home and film-based recommendation instructions in admin.
**Architecture:** Optional prompts in existing AI settings, effective legacy defaults, fixed provider guard plus editable developer instruction. Existing settings revision invalidates similar cache.
**Tech Stack:** Node ESM, SQLite, native admin JS, node:test, Playwright.
**Spec:** docs/superpowers/specs/2026-11-10-editable-prompts-design.md

## Global Constraints
No auth/network changes, new dependencies, raw prompt logs or automatic paid calls. Existing quotas, keys and history remain intact. Prompts home/similar nonblank strings max4000 each; unknown properties rejected.

## Review Focus
Legacy persisted documents and missing prompt fields; concurrent saves; wrong kind/cache reuse; reset before save; HTML in prompt treated as text.

## Tasks
- [x] Backend (Terra): settings/schema/defaults; regression tests first; prompt transport/service integration; verify full server suite.
- [x] Admin (Terra, parallel disjoint files): labeled textareas and reset/save feedback; real HTTP browser roundtrip and safe display tests; operator docs.
- [x] Integration: inspect changes, independent review, full browser/server verification, commit/push main.

## Verification

2026-11-10: root full server suite 149/149, full Chromium Playwright suite 30/30; git diff --check clean. Backend and admin regression tests observed red before implementation. Independent final review Sol medium approved; implementation Terra medium, no escalation. Root Vitest remains at its known baseline: 127 passing, episode_menu window reference failure and torrent_preload collection failure. No real OpenAI call or real Pi/TV deployment performed for this change; no database migration required.
