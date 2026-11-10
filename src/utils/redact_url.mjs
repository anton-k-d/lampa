/** Diagnostic copy only: never change the URL used by the actual transport. */
export function redactUrl(value) {
    return String(value || '').replace(/([?&](?:api_?key|access_token|token|password)=)[^&#\s\]]*/gi,'$1[redacted]');
}
