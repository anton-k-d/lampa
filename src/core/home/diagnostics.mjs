const MAX_BYTES = 200 * 1024;
const SECRET = '(?:password|passwd|pwd|token|access_token|refresh_token|api[_-]?key|secret|authorization|cookie|set-cookie|session(?:id)?|credential)';

export function utf8Length(text) {
    let length = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c < 128) length++;
        else if (c < 2048) length += 2;
        else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { length += 4; i++; }
        else length += 3;
    }
    return length;
}

export function redact(value) {
    return String(value)
        .replace(/&quot;/gi, '"').replace(/&#0?39;/gi, "'").replace(/&amp;/gi, '&')
        .replace(/\b((?:set-)?cookie|authorization)\s*:\s*[^\r\n]*/gi, '$1: [redacted]')
        .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[redacted]@')
        .replace(new RegExp('([?&]' + SECRET + '=)[^&#\\s]*', 'gi'), '$1[redacted]')
        .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [redacted]')
        .replace(new RegExp('(["\\\']?' + SECRET + '["\\\']?\\s*[:=]\\s*)(["\\\'])(.*?)(\\2)', 'gi'), '$1$2[redacted]$4')
        .replace(new RegExp('(' + SECRET + '\\s*[:=]\\s*)([^\\s,;}&]+)', 'gi'), '$1[redacted]');
}

export function makeDiagnostics(original, client) {
    let all = [];
    function add(item, level, message) {
        message = redact(message);
        const entry = {level: redact(level).slice(0, 64), message};
        const date = new Date(item.time);
        if (item.time != null && !isNaN(date.getTime())) entry.time = date.toISOString();
        all.push(entry);
    }
    if (Array.isArray(original)) {
        original.forEach(item => {
            const args = item.original;
            const message = Array.isArray(args) ? args.join(' ') : (args == null ? item.full || item.message || '' : String(args));
            add(item, item.type || 'log', message);
        });
    }
    else Object.keys(original || {}).forEach(name => {
        if (name === 'Errors' || name === 'Warnings') return;
        (original[name] || []).forEach(item => {
            const message = Array.isArray(item.message) ? item.message.join(' ') : String(item.message == null ? '' : item.message);
            add(item, name, message);
        });
    });
    all.sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0));
    let truncated = all.length > 1000;
    all = all.slice(0, 1000).map(entry => {
        if (entry.message.length > 4096) { entry.message = entry.message.slice(0, 4096); truncated = true; }
        return entry;
    });
    const safeClient = {};
    if (client && client.appVersion) safeClient.appVersion = redact(String(client.appVersion)).slice(0, 128);
    if (client && client.platform) safeClient.platform = redact(String(client.platform)).slice(0, 128);
    const payload = {schemaVersion: 1, entries: all, client: safeClient, truncated};
    let bytes = utf8Length(JSON.stringify({schemaVersion: 1, entries: [], client: safeClient, truncated: false}));
    let count = 0;
    for (; count < all.length; count++) {
        const next = utf8Length(JSON.stringify(all[count])) + (count ? 1 : 0);
        if (bytes + next > MAX_BYTES) break;
        bytes += next;
    }
    if (count < all.length) { payload.entries = all.slice(0, count); payload.truncated = true; }
    return payload;
}
