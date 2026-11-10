# Compact AI Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with disjoint ownership. Existing user authorization covers parallel implementation; no publication.

**Goal:** Send compact likes-only input; model researches on web and proposes titles.
**Architecture:** Preparelikedtitles → one Responses API(web_search) → validate sourcedproposals → resolve titles/year/type viaTMDBProxy → filterlocalhistory → nativecards. No MCP or server-preselected candidatepool.
**Tech Stack:** Existing Node ESM/OpenAI6.15 SDK/SQLite/nativeadmin/Playwright.
**Spec:** docs/superpowers/specs/2026-11-10-compact-ai-design.md

## Global Constraints
No push/deploy/publication/commits; no MCPconfig/dependency/tool. Onlylikedpositives, historynevertransmitted; no120candidates. Preservekey/quota/rawtraces/CAS/explicitprompts. No DBmigration.

## Review Focus
Onlyhistory vsactual3likes; fakecitations/noactualsearch; ambiguouswrongyearIDs; missinglikesnopaidcall; lookupfailurepaidretry; replaytoolsstrictness/oldcache. Focusedregressions beforeproductionchanges.

## Tasks
- [x] Engine (Terra): compactinput, websearchtransport andvalidatedproposals; testsfirst.
- [x] Resolver (Terra): TMDBProxytitle/year/type search, ambiguity/partialerror/cachebounds andverificationtests.
- [x] Service (Terra): newpipeline/cache/status/replayguards andexistingquota/retry regressions updatedwithoutweakening.
- [x] Admin (Terra): truthfulhelp/native no_likes/browsertests/docs; noMCPsettings.
- [x] Root: integrationreview, fullserver/browser/WEBbuild; finalSolmediumreview; leaveunpublished.

## Verification

2026-11-10 root verification: full server suite174/174, full Chromium Playwright37/37 including native no_likes flow, WEB build validated, buildhelpers10/10, git diff --check clean. Actual uploaded request parsed:3liked/3seed/120candidates; SDKfetchfixture with those3likes plus100localhistoryrecords: request150705→1942bytes, initialusercontext363bytes, exactly3likedtitles/nohistory/nocandidates, zeroexternalcalls. Root Vitest retains knownbaseline failures torrent_preload collection and episode_menu windowreference;127pass. No real OpenAI/proxy/Pi/TV test performed, noDBmigration, no publication/commit/push.

Implementation4Terra medium owners(engine/service/admin/resolver); finalSolmediumreview foundcompletedopen_page-only could falselysatisfysearchgate, owner added genuineaction.type=search validation and RED/GREENregressions. Root also alignedread-time history/liked exclusions and retainedpostAPIresolution accounting. No model escalation; earlierMCPdirection was explicitly superseded by finalweb-onlyrequest.

## Publication

2026-11-10: user subsequently authorized publishing the completed draft. Commit and push the verified changes to main; Pi deployment remains a separate operator action.
