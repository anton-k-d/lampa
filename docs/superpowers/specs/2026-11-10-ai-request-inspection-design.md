# AI request inspection and model comparison

User explicitly requests concrete API request and complete model response in logs, plus replay on another model in admin. This supersedes the prior decision to omit prompts/history/output from diagnostic records. Existing authorization covers implementation, parallel agents and main integration. MCP/tool-enabled metadata search is a separate possible next step; no Jackett, proxy, VPN or auth changes here.

Use existing Node/Pi/SQLite and admin. Capture actual serialized Responses API request and raw HTTP response at SDK fetch boundary, not reconstructed ranking output. Store no authorization headers. Mark injected SDK-only test captures, missing responses, truncation and known-secret redactions explicitly. Preserve prompt/history, usage fields and raw invalid/refusal/error responses. Incomplete/truncated/redacted requests cannot be replayed. Never call secret-bearing originalURL from a storedtrace: fixed OpenAI SDK endpoint only.

Separate trace storage bounded by 14 days, 200 traces, 64MiB total. Existing event list remains lightweight and older events show trace unavailable. Additive SQLite migration5 must preserve config, secrets, signal/history, attempts, jobs and existing events. Do not delete budget/idempotency state as diagnostic retention.

Admin offers exact raw request/response panes and optional JSONdownload. Replay loads original request server-side and changes only model; does not refetchTMDB or replace live recommendations. Explicit paid button selects gpt-4.1-mini, gpt-4.1 or gpt-4.1-nano. New calls retain store:false, no SDKretry and boundedtimeout. Durable idempotency binds source/model; charge reservation precedes call and respects existing server/profile limits. Failed calls remain auditable with raw response where available. Compare source/result response, model, usage and latency in sameadminview.

API: GET /v1/admin/diagnostics/ai/{id} returns {event,trace,parentEventId}; GET .../ai/models returns {models}; POST .../ai/{id}/replay {model}, idempotency-key => {eventId}. Trace fields requestBody,responseBody,httpStatus,transportError,capture(http|sdk),truncated,redacted. Existing Host/same-origin guards apply. No newpaid GETs, no automatic replays, no providerkey in client.

Alternatives: only parsedranking (does not answer exactAPI request), externalobservability/MCP service (unneeded infrastructure), selected bounded transportcapture reusesexistingjournalandkey. Actual OpenAI/TV/Pi acceptance remains owner-run; tests use SDKfetchfixtures and real localHTTP.
