# Editable recommendation prompts

User request: edit recommendation prompts from the existing home admin. Existing authorization covers implementation and parallel agents; no network, auth or provider changes.

Coordinator choice: keep two instructions in existing versioned AI settings, `prompts.home` and `prompts.similar`. Effective defaults are returned for old databases without migration. Each instruction must contain non-whitespace text and be at most 4000 characters. Fixed system constraints retain candidate-only selection, structured output and untrusted metadata treatment. Instructions cannot enlarge the supplied TMDB candidate pool. No raw prompts in usage logs.

Admin offers two textareas, per-field reset to server defaults and explicit save/status. Reset edits the form; saving applies it to future jobs. Existing cards stay available until regeneration; no paid request on save/reset. Similar cache identity already includes settings revision. Connection test remains independent of custom instructions.

Alternatives: edit code (fails convenient PC configuration); arbitrary full request template (unnecessary contract/schema risks); chosen bounded instructions reuse settings CAS, persistence and existing provider transport. No separate service or database migration.

Acceptance: legacy configuration works, default/edit/reset persist across reload/restart, concurrent edits conflict safely, correct home/similar instruction reaches OpenAI, validation rejects invalid/oversize prompts, no paid calls or quota resets on edits, safe text display.
