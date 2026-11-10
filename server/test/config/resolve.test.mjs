import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveManagedConfig, validateResolvedConfig } from '../../src/config/resolve.mjs';
import { canonicalJson, sha256Json } from '../../src/config/canonical.mjs';
import { ConfigError } from '../../src/config/errors.mjs';

const doc = (scope, values) => ({ schemaVersion: 1, scope, ...(scope === 'device' ? { deviceId: 'tv' } : {}), values });
const endpoint = (url, extra = {}) => ({ url, mode: 'gateway', ...extra });
const paths = issues => issues.map(issue => issue.path);

test('merges defaults and objects, replaces arrays, unions locks without mutating inputs', () => {
  const global = doc('global', { ui: { theme: 'dark' }, sources: [{ id: 'one', enabled: true, endpoint: endpoint('https://example.com') }], lockedPaths: ['/ui', '/sources'] });
  const device = doc('device', { ui: { animations: false }, sources: [], lockedPaths: ['/sources', '/parser'] });
  const before = structuredClone([global, device]);
  const result = resolveManagedConfig(global, device);
  assert.deepEqual(result.ui, { theme: 'dark', density: 'comfortable', animations: false });
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.lockedPaths, ['/ui', '/sources', '/parser']);
  assert.deepEqual([global, device], before);
  assert.equal('metadata' in result, false);
  result.lockedPaths.push('/features');
  assert.deepEqual([global, device], before);
});

test('rejects prototype keys at any depth before merge without pollution', () => {
  for (const key of ['__proto__', 'prototype', 'constructor']) {
    const input = JSON.parse(`{"schemaVersion":1,"scope":"global","values":{"ui":{"${key}":{"polluted":true}}}}`);
    const before = structuredClone(input);
    assert.throws(() => resolveManagedConfig(input, null), error => error instanceof ConfigError && error.code === 'INVALID_CONFIG' && !JSON.stringify(error).includes(key));
    assert.deepEqual(input, before);
    assert.equal({}.polluted, undefined);
  }
});

test('reports duplicate ids, invalid default and missing enabled endpoints', () => {
  const values = resolveManagedConfig(doc('global', { sources: [{ id:'x', enabled:false, endpoint:endpoint('https://example.com') }, { id:'x', enabled:true, endpoint:endpoint('https://example.com') }], defaultSourceId:'missing', plugins:[{id:'p',enabled:false},{id:'p',enabled:false}], torrServer:{enabled:true}, parser:{enabled:true} }), null);
  const p = paths(validateResolvedConfig(values));
  for (const path of ['/sources/1/id','/plugins/1/id','/defaultSourceId','/torrServer/primary','/parser/endpoint']) assert.ok(p.includes(path), path);
  values.defaultSourceId = 'x'; values.sources[1].id = 'y';
  assert.ok(paths(validateResolvedConfig(values)).includes('/defaultSourceId'));
});

test('validates providers, secret references and reviewed enabled plugins', () => {
  const plugin = { id:'p', enabled:true, url:'https://example.com/plugin', sha256:'a'.repeat(64), minClientVersion:'1.0.0', permissions:[] };
  const values = resolveManagedConfig(doc('global', { metadata:{providerId:'tmdb',endpoint:endpoint('https://example.com',{credentialRef:'secret:token'})}, plugins:[plugin] }), null);
  assert.deepEqual(paths(validateResolvedConfig(values)).sort(), ['/metadata/endpoint/credentialRef','/metadata/providerId','/plugins/0']);
  const policy = {providerIds:new Set(['tmdb']),secretRefs:new Set(['secret:token']),reviewedPlugins:new Map([['p',{url:plugin.url,sha256:plugin.sha256,minClientVersion:plugin.minClientVersion}]])};
  assert.deepEqual(validateResolvedConfig(values, policy), []);
  for (const field of ['url','sha256','minClientVersion']) {
    const reviewed = {url:plugin.url,sha256:plugin.sha256,minClientVersion:plugin.minClientVersion,[field]:'different'};
    assert.ok(paths(validateResolvedConfig(values,{...policy,reviewedPlugins:new Map([['p',reviewed]])})).includes('/plugins/0'));
  }
  assert.deepEqual(validateResolvedConfig(resolveManagedConfig(null,null)), []);
});

test('enforces lexical URL and direct-device credential policy without leaking values', () => {
  const urls = ['http://192.168.1.4:8080/base','https://user:password@example.com','https://example.com/?token=secret','https://example.com/#fragment'];
  for (const url of urls) {
    const values = resolveManagedConfig(doc('global',{metadata:{endpoint:endpoint(url)}}),null);
    const issues = validateResolvedConfig(values);
    assert.ok(paths(issues).includes('/metadata/endpoint/url'));
    assert.equal(JSON.stringify(issues).includes(url),false);
    assert.equal(JSON.stringify(issues).includes('password'),false);
    assert.equal(JSON.stringify(issues).includes('token'),false);
  }
  const values = resolveManagedConfig(doc('global',{metadata:{endpoint:endpoint(urls[0])}}),null);
  assert.deepEqual(validateResolvedConfig(values,{allowedLanOrigins:new Set(['http://192.168.1.4:8080'])}),[]);
  values.metadata.endpoint = endpoint('https://example.com',{mode:'direct-device',credentialRef:'secret:token'});
  assert.ok(paths(validateResolvedConfig(values,{secretRefs:new Set(['secret:token'])})).includes('/metadata/endpoint/credentialRef'));
});

test('canonical JSON sorts nested keys and preserves array order in hashes', () => {
  const a = {z:[{b:2,a:1},3],a:true};
  const b = {a:true,z:[{a:1,b:2},3]};
  assert.equal(canonicalJson(a), '{"a":true,"z":[{"a":1,"b":2},3]}');
  assert.equal(sha256Json(a), sha256Json(b));
  assert.notEqual(sha256Json(a), sha256Json({a:true,z:[3,{a:1,b:2}]}));
});

test('applies URL policy to reviewed enabled plugin URLs', () => {
  const plugin = { id:'p', enabled:true, url:'http://example.com/plugin', sha256:'a'.repeat(64), minClientVersion:'1.0.0', permissions:[] };
  const values = resolveManagedConfig(doc('global',{plugins:[plugin]}),null);
  const policy = {reviewedPlugins:new Map([['p',{url:plugin.url,sha256:plugin.sha256,minClientVersion:plugin.minClientVersion}]])};
  const issues = validateResolvedConfig(values,policy);
  assert.ok(paths(issues).includes('/plugins/0/url'));
});

for (const enabled of [true, false]) {
  test(`rejects credentials and fragments in ${enabled ? 'enabled' : 'disabled'} plugin URLs without exposing them`, () => {
    for (const url of ['https://user:password@example.com/plugin', 'https://example.com/plugin?token=secret', 'https://example.com/plugin#fragment']) {
      const plugin = { id: 'p', enabled, url, sha256: 'a'.repeat(64), minClientVersion: '1.0.0', permissions: [] };
      const values = resolveManagedConfig(doc('global', { plugins: [plugin] }), null);
      const reviewedPlugins = new Map([['p', { url, sha256: plugin.sha256, minClientVersion: plugin.minClientVersion }]]);
      const issues = validateResolvedConfig(values, { reviewedPlugins });
      assert.ok(paths(issues).includes('/plugins/0/url'));
      for (const sensitive of [url, 'password', 'token', 'secret', 'fragment']) assert.equal(JSON.stringify(issues).includes(sensitive), false);
    }
  });
}

test('accepts an unreviewed disabled plugin with a safe URL', () => {
  const plugin = { id: 'p', enabled: false, url: 'https://example.com/plugin', sha256: 'a'.repeat(64), minClientVersion: '1.0.0', permissions: [] };
  assert.deepEqual(validateResolvedConfig(resolveManagedConfig(doc('global', { plugins: [plugin] }), null)), []);
});
