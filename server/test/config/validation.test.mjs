import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseConfigDocument, validateConfigDocument } from '../../src/config/validation.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
const global = fixture('global');
const device = fixture('device');
const invalidError = err => err.code === 'INVALID_CONFIG';

for (const [name, value] of [['global', global], ['device', device]]) {
  test(`${name} example is valid without mutation`, () => {
    const input = structuredClone(value);
    assert.deepEqual(validateConfigDocument(input), { valid: true, issues: [] });
    assert.deepEqual(input, value);
    assert.deepEqual(parseConfigDocument(JSON.stringify(value)), value);
  });
}

const invalidCases = [
  ['global with deviceId', {...global, deviceId: 'tv'}],
  ['device without deviceId', {schemaVersion: 1, scope: 'device', values: {}}],
  ['unknown schemaVersion', {...global, schemaVersion: 2}],
  ['unknown root property', {...global, extra: true}],
  ['null value', {...global, values: {ui: null}}],
  ['invalid URI', {...global, values: {metadata: {endpoint: {url: 'https://[bad', mode: 'gateway'}}}}],
  ['raw apiKey', {...global, values: {metadata: {apiKey: 'secret-value'}}}],
  ['prototype key', JSON.parse('{"schemaVersion":1,"scope":"global","values":{"__proto__":{"polluted":true}}}')],
];
for (const [name, value] of invalidCases) {
  test(`rejects ${name} without mutation`, () => {
    const before = structuredClone(value);
    const result = validateConfigDocument(value);
    assert.equal(result.valid, false);
    assert.ok(result.issues.length);
    for (const issue of result.issues) {
      assert.equal(typeof issue.path, 'string');
      assert.ok(issue.path === '' || issue.path.startsWith('/'));
      assert.equal(typeof issue.code, 'string');
      assert.equal(typeof issue.message, 'string');
      assert.ok(!JSON.stringify(issue).includes('secret-value'));
    }
    assert.deepEqual(value, before);
    assert.throws(() => parseConfigDocument(JSON.stringify(value)), invalidError);
  });
}

test('unknown property diagnostics do not expose sensitive keys', () => {
  const secret = 'https://user:password@example.com';
  const value = {schemaVersion: 1, scope: 'global', [secret]: true, values: {metadata: {[secret]: 'private'}}};
  const result = validateConfigDocument(value);
  const issues = result.issues.filter(issue => issue.code === 'additionalProperties');
  assert.deepEqual(issues.map(issue => issue.path).sort(), ['', '/values/metadata']);
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!JSON.stringify(result).includes('password'));
  assert.throws(() => parseConfigDocument(JSON.stringify(value)), err =>
    invalidError(err) && !JSON.stringify(err).includes(secret) && !JSON.stringify(err).includes('password'));
});

test('required property diagnostics point to the missing schema property', () => {
  const result = validateConfigDocument({schemaVersion: 1, scope: 'device', values: {}});
  assert.ok(result.issues.some(issue => issue.code === 'required' && issue.path === '/deviceId'));
});

test('does not insert defaults or coerce types', () => {
  const value = {schemaVersion: 1, scope: 'global', values: {ui: {animations: 'true'}}};
  const before = structuredClone(value);
  assert.equal(validateConfigDocument(value).valid, false);
  assert.deepEqual(value, before);
  const valid = {schemaVersion: 1, scope: 'global', values: {ui: {}}};
  assert.equal(validateConfigDocument(valid).valid, true);
  assert.deepEqual(valid.values.ui, {});
});

test('accepts JSON at the byte limit and rejects one byte more', () => {
  const text = JSON.stringify({schemaVersion: 1, scope: 'global', values: {}});
  const padded = text + ' '.repeat(262144 - Buffer.byteLength(text));
  assert.deepEqual(parseConfigDocument(padded), JSON.parse(text));
  assert.throws(() => parseConfigDocument(padded + ' '), invalidError);
});

test('counts UTF-8 bytes rather than characters', () => {
  // The later scope wins in JSON.parse, producing a valid document containing Unicode.
  const json = '{"scope":"é","schemaVersion":1,"scope":"global","values":{}}';
  const text = json + ' '.repeat(262144 - Buffer.byteLength(json));
  assert.equal(Buffer.byteLength(text), 262144);
  assert.deepEqual(parseConfigDocument(text), {schemaVersion: 1, scope: 'global', values: {}});
  assert.throws(() => parseConfigDocument(text + ' '), err => invalidError(err) && err.issues[0].code === 'size');
});

test('malformed JSON does not expose its body', () => {
  assert.throws(() => parseConfigDocument('{"password":"private-credential"'), err =>
    invalidError(err) && !String(err.message).includes('private-credential') && !JSON.stringify(err).includes('private-credential'));
});
