import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDiagnostics, redact, utf8Length } from '../../../src/core/home/diagnostics.mjs';

test('redacts credentials while preserving diagnostic stack text', () => {
    const value = redact('https://user:pass@example.com/a?token=secret&x=ok Authorization: Bearer abc {"password":"hidden"}\n at fn (app.js:1)');
    for (const secret of ['user:pass', 'secret', 'abc', 'hidden']) assert.equal(value.includes(secret), false);
    assert.match(value, /at fn/);
    assert.equal(redact('Cookie: session=one; other=two\nstack').includes('two'), false);
    assert.equal(redact('Authorization: Basic dXNlcjpwYXNz\nstack').includes('dXNlcjpwYXNz'), false);
    assert.equal(redact('&quot;password&quot;: &quot;hidden&quot;').includes('hidden'), false);
});

test('keeps bounded newest entries, honest truncation and UTF-8 byte size', () => {
    const original = { Other: Array.from({length: 1100}, (_, i) => ({time: 1100-i, message: ['😀'.repeat(3000), String(i)]})) };
    const payload = makeDiagnostics(original, {appVersion:'1', platform:'web'});
    assert.equal(payload.truncated, true);
    assert.ok(payload.entries.length <= 1000);
    assert.equal(payload.entries[0].time, new Date(1100).toISOString());
    assert.ok(payload.entries.every(e => e.message.length <= 4096));
    assert.ok(utf8Length(JSON.stringify(payload)) <= 200 * 1024);
    assert.equal(utf8Length('a😀я'), 7);
});

test('preserves stack and skips aggregate duplicate entries', () => {
    const payload = makeDiagnostics({Error:[{time: 1, message:'Error\n at f'}], Errors:[{time:1,message:'Error\n at f'}]}, {});
    assert.equal(payload.entries.length, 1);
    assert.match(payload.entries[0].message, /at f/);
    assert.equal(payload.truncated, false);
});

test('preserves native console severity and channel', () => {
    const payload = makeDiagnostics([{time:1,type:'error',name:'Player',original:['Player','failed','at f']}], {});
    assert.equal(payload.entries[0].level, 'error');
    assert.match(payload.entries[0].message, /Player.*failed.*at f/);
});
