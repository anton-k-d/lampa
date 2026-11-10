import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openConfigDatabase } from '../../src/config/database.mjs';
import { createConfigRepository } from '../../src/config/repository.mjs';
import { createConfigService } from '../../src/config/service.mjs';

const global = values => ({schemaVersion:1, scope:'global', values});
const device = (id, values) => ({schemaVersion:1, scope:'device', deviceId:id, values});
const source = {id:'sourceA', enabled:true, endpoint:{url:'https://example.com', mode:'gateway'}};
const request = (scopeKey, document, expectedRevision, mutationId) => ({scopeKey,document,expectedRevision,mutationId,actorId:'admin',reason:null});
const invalid = e => e.code === 'INVALID_CONFIG';
function setup(t, policy = {}) {
  const db = openConfigDatabase(':memory:'); t.after(() => db.close());
  const repository = createConfigRepository(db);
  return {db, repository, service:createConfigService({repository,policy})};
}
const counts = db => ['config_revisions','config_heads','config_mutations'].map(table => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n);

test('global changes validate every device atomically and corrected global succeeds', t => {
  const {db,repository,service} = setup(t);
  const g = service.publish(request('global',global({sources:[source]}),0,'g'));
  service.publish(request('device:a',device('a',{sources:[source],defaultSourceId:'sourceA'}),0,'a'));
  service.publish(request('device:z',device('z',{defaultSourceId:'sourceA'}),0,'z'));
  const heads = repository.listHeads(), before = counts(db);
  assert.throws(() => service.publish(request('global',global({sources:[]}),g.revision,'bad')),invalid);
  assert.deepEqual(repository.listHeads(),heads); assert.deepEqual(counts(db),before);
  assert.ok(service.publish(request('global',global({sources:[source],ui:{theme:'dark'}}),g.revision,'good')).revision > g.revision);
});

test('rollback revalidates the target against live policy without devices', t => {
  const plugin={id:'p',enabled:true,url:'https://example.com/p',sha256:'a'.repeat(64),minClientVersion:'1.0.0',permissions:[]};
  const policy={reviewedPlugins:new Map([['p',{url:plugin.url,sha256:plugin.sha256,minClientVersion:plugin.minClientVersion}]])};
  const {db,repository,service}=setup(t,policy);
  const old=service.publish(request('global',global({plugins:[plugin]}),0,'g1'));
  const next=service.publish(request('global',global({}),old.revision,'g2'));
  policy.reviewedPlugins.clear(); const heads=repository.listHeads(), before=counts(db);
  assert.throws(() => service.rollback({scopeKey:'global',expectedRevision:next.revision,targetRevision:old.revision,actorId:'admin',mutationId:'rollback',reason:null}),invalid);
  assert.deepEqual(repository.listHeads(),heads); assert.deepEqual(counts(db),before);
});

test('global update rejects a device invalidated by live policy without repairing it', t => {
  const plugin={id:'p',enabled:true,url:'https://example.com/p',sha256:'a'.repeat(64),minClientVersion:'1.0.0',permissions:[]};
  const policy={reviewedPlugins:new Map([['p',{url:plugin.url,sha256:plugin.sha256,minClientVersion:plugin.minClientVersion}]])};
  const {db,repository,service}=setup(t,policy);
  const current=service.publish(request('global',global({}),0,'g'));
  service.publish(request('device:tv',device('tv',{plugins:[plugin]}),0,'d'));
  policy.reviewedPlugins.clear(); const heads=repository.listHeads(), before=counts(db);
  assert.throws(() => service.publish(request('global',global({ui:{theme:'dark'}}),current.revision,'g2')),invalid);
  assert.deepEqual(repository.listHeads(),heads); assert.deepEqual(counts(db),before);
});

test('preview is read only and publish revalidates against changed global', t => {
  const {db,service}=setup(t);
  const g=service.publish(request('global',global({sources:[source]}),0,'g'));
  const candidate=device('tv',{defaultSourceId:'sourceA'}), before=counts(db);
  assert.deepEqual(service.preview({scopeKey:'device:tv',document:candidate}),{valid:true,issues:[]});
  assert.deepEqual(counts(db),before);
  service.publish(request('global',global({sources:[]}),g.revision,'g2'));
  assert.throws(() => service.publish(request('device:tv',candidate,0,'d')),invalid);
});

test('scope/schema errors are atomic and device scopes remain isolated', t => {
  const {db,repository,service}=setup(t); const before=counts(db);
  for (const req of [request('device:a',device('b',{}),0,'x'),request('global',global({ui:{theme:'invalid'}}),0,'y')]) assert.throws(() => service.publish(req),invalid);
  assert.deepEqual(counts(db),before);
  const a=service.publish(request('device:a',device('a',{ui:{theme:'dark'}}),0,'a'));
  const b=service.publish(request('device:b',device('b',{ui:{theme:'light'}}),0,'b'));
  assert.deepEqual(repository.getHead('device:a'),a); assert.deepEqual(repository.getHead('device:b'),b);
});

test('diagnostics hide unknown keys, secret references and credential URLs', t => {
  const {service}=setup(t);
  for (const document of [global({metadata:{providerId:'missing',endpoint:{url:'https://user:password@example.com/?token=secret',mode:'gateway',credentialRef:'secret:private'}}}),global({'secret-bearing-key':'secret-value'})]) {
    const result=service.preview({scopeKey:'global',document}); assert.equal(result.valid,false);
    assert.throws(() => service.publish(request('global',document,0,'bad')), e => {
      const diagnostic=JSON.stringify({message:e.message,issues:e.issues});
      for (const text of ['password','token','secret:private','secret-bearing-key','secret-value','SELECT','https://']) assert.equal(diagnostic.includes(text),false);
      return invalid(e);
    });
  }
});

test('additional validator checks every effective device inside publish and rollback', t => {
  const {repository} = setup(t);
  const permissive = createConfigService({repository});
  const old = permissive.publish(request('global',global({features:{sync:true}}),0,'old'));
  const current = permissive.publish(request('global',global({}),old.revision,'current'));
  permissive.publish(request('device:a',device('a',{}),0,'da'));
  permissive.publish(request('device:z',device('z',{features:{sync:true}}),0,'dz'));
  const validator = values => values.features.sync ? [{path:'/features/sync',code:'unsupported_capability',message:'Unsupported'}] : [];
  const strict = createConfigService({repository,additionalValidator:validator});
  assert.throws(() => strict.publish(request('global',global({ui:{theme:'dark'}}),current.revision,'bad')), invalid);
  assert.throws(() => strict.rollback({scopeKey:'global',targetRevision:old.revision,expectedRevision:current.revision,mutationId:'rb',actorId:'admin',reason:null}), invalid);
  assert.equal(repository.getHead('global').revision,current.revision);
});

test('additional validator rechecks changed global after preview', t => {
  const {repository} = setup(t);
  const permissive = createConfigService({repository});
  const strict = createConfigService({repository,additionalValidator:values => values.features.sync ? [{path:'/features/sync',code:'unsupported_capability',message:'Unsupported'}] : []});
  const candidate = device('tv',{});
  assert.equal(strict.preview({scopeKey:'device:tv',document:candidate}).valid,true);
  permissive.publish(request('global',global({features:{sync:true}}),0,'changed'));
  assert.throws(() => strict.publish(request('device:tv',candidate,0,'tv')),invalid);
});
