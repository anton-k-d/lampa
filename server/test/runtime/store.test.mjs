import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup } from 'node:sqlite';
import { openConfigDatabase } from '../../src/config/database.mjs';
import { createConfigRepository } from '../../src/config/repository.mjs';
import { createRuntimeStore } from '../../src/runtime/store.mjs';

function setup(t) { const dir = mkdtempSync(join(tmpdir(), 'runtime-')); t.after(() => rmSync(dir,{recursive:true,force:true})); return {dir,path:join(dir,'db.sqlite')}; }
const publish = repo => repo.publish({scopeKey:'global', expectedRevision:0, mutationId:'m', actorId:'a', reason:null, document:{schemaVersion:1,scope:'global'}},()=>{});

test('migration preserves revisions and runtime refs persist without exposing values', t => {
  const {dir,path}=setup(t); let db=openConfigDatabase(path); const revision=publish(createConfigRepository(db));
  db.exec('DROP TABLE runtime_secrets; DROP TABLE runtime_lan_origins; PRAGMA user_version=1'); db.close();
  db=openConfigDatabase(path); const store=createRuntimeStore(db); const ref=store.addSecret('private-value'); const ref2=store.addSecret('rotated-value');
  assert.match(ref,/^secret:[0-9a-f-]{36}$/); assert.notEqual(ref,ref2);
  assert.equal(store.readSecret(ref),'private-value'); assert.equal(JSON.stringify(store.secretStatus()).includes('private-value'),false);
  assert.equal(statSync(dir).mode & 0o777,0o700); assert.equal(statSync(path).mode & 0o777,0o600); db.close();
  db=openConfigDatabase(path); t.after(()=>db.close()); const reopened=createRuntimeStore(db);
  assert.deepEqual(createConfigRepository(db).getHead('global'),revision); assert.equal(db.prepare('PRAGMA user_version').get().user_version,5);
  assert.ok(reopened.context.secretRefs.has(ref)); assert.ok(reopened.context.secretRefs.has(ref2)); assert.equal(reopened.readSecret(ref2),'rotated-value');
  assert.deepEqual([...reopened.context.providerIds],['tmdb']); assert.equal(reopened.context.reviewedPlugins.size,0);
});

test('origin policy accepts canonical HTTP origins and rejects unsafe hosts', t => {
  const {path}=setup(t); const db=openConfigDatabase(path); t.after(()=>db.close()); const s=createRuntimeStore(db);
  for (const value of ['http://10.0.0.1','http://172.16.0.1:8080','http://192.168.1.1','http://server.local:8080','http://5.35.103.226:49117','http://example.com']) { s.allowLanOrigin(value); assert.ok(s.context.allowedLanOrigins.has(value)); }
  for (const value of ['https://192.168.1.1','http://127.0.0.1','http://169.254.169.254','http://user@server.local','http://server.local/path','http://server.local?','http://server.local#','http://SERVER.local','http://10.0.0.1:80']) assert.throws(()=>s.allowLanOrigin(value),value);
  const dev=createRuntimeStore(db,{allowLoopbackForDevelopment:true}); dev.allowLanOrigin('http://127.0.0.1:1234'); assert.ok(dev.context.allowedLanOrigins.has('http://127.0.0.1:1234'));
});

test('two connections keep writes and observe live context', t => {
  const {path}=setup(t); const a=openConfigDatabase(path), b=openConfigDatabase(path); t.after(()=>{a.close();b.close()});
  const x=createRuntimeStore(a), y=createRuntimeStore(b); const first=x.addSecret('one'), second=y.addSecret('two');
  x.allowLanOrigin('http://10.0.0.1'); y.allowLanOrigin('http://10.0.0.2');
  assert.ok(x.context.secretRefs.has(second)); assert.ok(y.context.secretRefs.has(first)); assert.equal(x.context.allowedLanOrigins.size,2);
});

test('failed writes preserve data and context without revealing private errors', t => {
  const {path}=setup(t); const db=openConfigDatabase(path); t.after(()=>db.close()); const s=createRuntimeStore(db); const ref=s.addSecret('existing');
  db.exec("CREATE TRIGGER failure BEFORE INSERT ON runtime_secrets BEGIN SELECT RAISE(ABORT,'secret error detail'); END");
  assert.throws(()=>s.addSecret('sensitive'), e=>!e.message.includes('sensitive') && !e.message.includes('secret error detail'));
  assert.deepEqual([...s.context.secretRefs],[ref]); assert.equal(s.readSecret(ref),'existing');
  assert.throws(()=>s.addSecret('x'.repeat(16385))); assert.throws(()=>s.addSecret(''));
});

test('consistent backup restores config and runtime together', async t => {
  const {dir,path}=setup(t); const db=openConfigDatabase(path); const rev=publish(createConfigRepository(db)); const s=createRuntimeStore(db); const ref=s.addSecret('value'); s.allowLanOrigin('http://host.local');
  const target=join(dir,'backup.sqlite'); await backup(db,target); db.close();
  const restored=openConfigDatabase(target); t.after(()=>restored.close()); const r=createRuntimeStore(restored);
  assert.deepEqual(createConfigRepository(restored).getHead('global'),rev); assert.equal(r.readSecret(ref),'value'); assert.ok(r.context.secretRefs.has(ref)); assert.ok(r.context.allowedLanOrigins.has('http://host.local'));
});

test('rejects insecure existing data directory without changing permissions', t => {
  const {dir,path}=setup(t); chmodSync(dir,0o755); assert.throws(()=>openConfigDatabase(path)); assert.equal(statSync(dir).mode & 0o777,0o755);
});
