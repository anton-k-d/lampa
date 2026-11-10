import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { openConfigDatabase } from '../../src/config/database.mjs';
import { createConfigRepository } from '../../src/config/repository.mjs';

const doc = n => ({ schemaVersion: 1, scope: 'global', value: n });
const input = (n, extra = {}) => ({ scopeKey: 'global', expectedRevision: 0, mutationId: `m${n}`, actorId: 'actor', reason: null, document: doc(n), ...extra });
const valid = () => {};
function setup(t) { const dir = mkdtempSync(join(tmpdir(), 'config-repo-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return join(dir, 'db.sqlite'); }
const code = expected => error => error.code === expected;

test('persists revisions, deduplicates retries and migrates on reopen', t => {
  const path = setup(t); let db = openConfigDatabase(path); let repo = createConfigRepository(db);
  assert.equal(repo.getHead('global'), null);
  const first = repo.publish(input(1), valid); assert.equal(first.revision, 1);
  assert.deepEqual(repo.listHeads(), [first]); db.close();
  db = openConfigDatabase(path); repo = createConfigRepository(db);
  assert.deepEqual(repo.getHead('global'), first); assert.deepEqual(repo.listRevisions('global', {}), [first]);
  assert.deepEqual(repo.publish(input(1), valid), first);
  assert.throws(() => repo.publish(input(2, { mutationId: 'm1' }), valid), code('IDEMPOTENCY_MISMATCH'));
  assert.throws(() => repo.publish(input(1, { expectedRevision: 1 }), valid), code('IDEMPOTENCY_MISMATCH'));
  assert.throws(() => repo.rollback({ scopeKey:'global', expectedRevision:0, mutationId:'m1', actorId:'actor', reason:null, targetRevision:1 }, valid), code('IDEMPOTENCY_MISMATCH'));
  db.close();
});

test('rejects future schema without changing it', t => {
  const path = setup(t); const db = openConfigDatabase(path); db.exec('PRAGMA user_version=4'); db.close();
  assert.throws(() => openConfigDatabase(path), code('UNSUPPORTED_DB_VERSION'));
});

test('CAS, rollback, validation and database faults are atomic', t => {
  const path = setup(t); const db = openConfigDatabase(path); const other = openConfigDatabase(path); t.after(() => { db.close(); other.close(); });
  const repo = createConfigRepository(db); const second = createConfigRepository(other);
  const first = repo.publish(input(1), valid);
  assert.throws(() => second.publish(input(2), valid), code('REVISION_CONFLICT'));
  assert.throws(() => repo.publish(input(2, { expectedRevision: 1 }), () => { throw new Error('rejected'); }), /rejected/);
  assert.throws(() => repo.publish(input(2, { expectedRevision: 1 }), async () => { throw new Error('async rejection'); }), code('INVALID_CONFIG'));
  db.exec("CREATE TRIGGER fail_mutation BEFORE INSERT ON config_mutations BEGIN SELECT RAISE(ABORT, 'private SQL detail'); END");
  assert.throws(() => repo.publish(input(2, { expectedRevision: 1 }), valid), e => !e.message.includes('private SQL detail'));
  assert.deepEqual(repo.listRevisions('global', {}), [first]);
  db.exec('DROP TRIGGER fail_mutation');
  const next = repo.publish(input(2, { expectedRevision: 1 }), valid);
  assert.throws(() => repo.rollback({ scopeKey:'device:x', expectedRevision:0, mutationId:'r0', actorId:'actor', reason:null, targetRevision:1 }, valid), code('NOT_FOUND'));
  assert.throws(() => repo.rollback({ scopeKey:'global', expectedRevision:2, mutationId:'r1', actorId:'actor', reason:null, targetRevision:99 }, valid), code('NOT_FOUND'));
  const rolled = repo.rollback({ scopeKey:'global', expectedRevision:2, mutationId:'r2', actorId:'actor', reason:null, targetRevision:1 }, valid);
  assert.equal(rolled.revision, 3); assert.equal(rolled.parentRevision, 2); assert.equal(rolled.restoredFrom, 1); assert.deepEqual(rolled.document, first.document);
  assert.deepEqual(repo.getRevision(1), first); assert.deepEqual(repo.getRevision(2), next);
});

test('two independent processes racing from the same base commit once', async t => {
  const path = setup(t); const db = openConfigDatabase(path); db.close();
  const worker = `import { openConfigDatabase } from ${JSON.stringify(new URL('../../src/config/database.mjs', import.meta.url).href)}; import { createConfigRepository } from ${JSON.stringify(new URL('../../src/config/repository.mjs', import.meta.url).href)}; const db=openConfigDatabase(process.argv[1]); process.send('ready'); process.on('message',()=>{ try { const result=createConfigRepository(db).publish({scopeKey:'global',expectedRevision:0,mutationId:process.argv[2],actorId:'a',reason:null,document:{schemaVersion:1,scope:'global'}},()=>{}); process.send({revision:result.revision}); } catch(e) { process.send({code:e.code}); } db.close(); process.disconnect(); });`;
  const start = id => { const p = spawn(process.execPath, ['--input-type=module', '-e', worker, path, id], { stdio:['ignore','ignore','inherit','ipc'] }); return p; };
  const a=start('a'), b=start('b');
  const message = p => new Promise((resolve,reject) => { p.once('message',resolve); p.once('error',reject); p.once('exit', code => { if (code) reject(new Error(`worker exit ${code}`)); }); });
  await Promise.all([message(a),message(b)]); const results = Promise.all([message(a),message(b)]); a.send('go'); b.send('go');
  assert.deepEqual((await results).map(x => x.code ?? x.revision).sort(), [1,'REVISION_CONFLICT']);
  const check = openConfigDatabase(path); assert.equal(createConfigRepository(check).listRevisions('global', {}).length, 1); check.close();
});

test('scope matching, callback heads, and rejected rollback leave history intact', t => {
  const path = setup(t); const db = openConfigDatabase(path); t.after(() => db.close()); const repo = createConfigRepository(db);
  assert.throws(() => repo.publish(input(1, { scopeKey:'device:x' }), valid), code('INVALID_CONFIG'));
  const first = repo.publish(input(1), valid);
  const second = repo.publish(input(2, { expectedRevision:1 }), (document, heads) => { assert.deepEqual(document, doc(2)); assert.deepEqual(heads, [first]); });
  assert.throws(() => repo.rollback({scopeKey:'global',expectedRevision:2,mutationId:'r',actorId:'actor',reason:null,targetRevision:1}, () => { throw new Error('policy'); }), /policy/);
  assert.deepEqual(repo.listRevisions('global'), [second, first]);
  assert.deepEqual(repo.getHead('global'), second);
});

test('an extra operation property cannot make publish and rollback share a mutation', t => {
  const path = setup(t); const db = openConfigDatabase(path); t.after(() => db.close());
  const repo = createConfigRepository(db);
  const request = input(1, { operation: 'caller-value', targetRevision: 1 });
  repo.publish(request, valid);
  assert.throws(() => repo.rollback(request, valid), code('IDEMPOTENCY_MISMATCH'));
});
