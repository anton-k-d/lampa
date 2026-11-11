# Ten recommendations and actionable failures

User requests parallel implementation: 10 suggestions instead of5, stronger similarity, and understandable errors instead of an unexplained retry. Both uploaded model responses are valid completed searched outputs with5 proposals; current parser accepts both. The actual later failure cannot be identified from model bodies alone. Do not invent its cause. Existing stage errors are collapsed and post-model filtering/proxy results are mostly invisible.

## Behavior
Request exactly10 new titles from the model using Structured Outputs and explicit target_count10. Similar-to mode anchors on that exact title/year first; likes are secondary. Compare narrative/tone/pacing/theme/stakes, not matching words, actor or genre alone. Home stays likes-only with varied relevant recommendations. Preserve saved prompts and augment fixed instructions. No switch to expensive model, MCP or large candidate pools. One generation does not automatically make additional paid calls to fill exclusions. Legacy short valid responses are usable and marked partial, not discarded.

Return at most10 verified TMDB cards. Keep strict title/year/type matching, local watched/likes/duplicates exclusion, optional citation statuses and raw traces. Display requested/returned counts and why items were lost. Preserve last good cards on failure and show their age/warning.

## Additive contract
`selection`: {requested:10,proposed,resolved,excluded,returned,unresolved}, bounded integer counts. Batch provenance persists selection. Public home/similar reads add targetCount:10, selection:null|object, lastError:null|failure. No new database migration. Cached read counters reflect current history exclusions without mutating stored generation provenance. Reads expose canGenerate for local eligibility (settings, quotas and no active job), not proof of provider availability.

Job GET adds failure for failed jobs: {code,stage,message,action,retryable}; existing jobId/state/errorCode remain. Stages prepare/research/metadata/filter. Failure strings come from a fixed safe server registry, never raw provider/network error text or credentials. Distinguish missing key/metadata config, no likes/snapshot, quota, provider auth/rate/timeout/unavailable, missing search, truncated/refused/invalid output, metadata timeout/unavailable, no matches and all excluded.

Latest paid AI event JSON can receive `pipeline`: {stage,state,errorCode:null|string,selection:null|object}, linked by jobId. Update existing event; do not invent a second paid event or alter HTTP status/usage/raw trace/retention/budget ledger. Pre-paid failure can have no audit event; job code still explains it. Job/read APIs can derive failure details and selection from last linked pipeline event or batch provenance. No migration, new persistence service or unbounded logs.

Native UI shows reason+action+code, partial counts and relevant next action. Explicit retry only, no GET-triggered regeneration or infinite paid retry. Missing settings/likes/quota must not present a paid retry as a solution. Unknown pending/poll timeout checks existing job, not silently creates another. Admin displays model-call status separately from pipeline result and counts.

## Verification
Regressions for exact10 request and primary similar anchor; legacy short output; coded refusal/truncation/missingsearch; strict metadata mismatch; API success followed by metadata failure with preserved paid outcome; quota/auth; all excluded vs no matches; partial count explanations and old-cache retention; bounded safe diagnostic updates. Browser tests for actionable failures, no unintended paidPOSTs, partial/complete cards, admin pipeline status and raw copy unchanged. Actual supplied responses replayed locally, no external paid calls. Publish after tests per user's repeated instruction, preserving concurrent remote changes.

Recovery controls: a read-only recheck never creates a paid job. Once locally eligible, a distinct explicit generation action is available even with a historical nonretryable error. A cached stale similar batch remains visible with an explicit refresh action so legacy five-card caches can be replaced by the ten-title strategy. Network-unknown pending jobs remain guarded until a successful terminal-state read.
