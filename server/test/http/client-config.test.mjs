import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openConfigDatabase } from '../../src/config/database.mjs';
import { createConfigRepository } from '../../src/config/repository.mjs';
import { createRuntimeStore } from '../../src/runtime/store.mjs';
import { createConfigService } from '../../src/config/service.mjs';
import { createHomeServer } from '../../src/http/server.mjs';

test('LAN client receives assigned connections and only its selected Jackett key', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lampa-client-'));
  const db = openConfigDatabase(join(dir, 'config.sqlite'));
  const repository = createConfigRepository(db), runtimeStore = createRuntimeStore(db);
  const service = createConfigService({repository, policy:runtimeStore.context});
  const server = createHomeServer({repository, service, runtimeStore, allowedHosts:['127.0.0.1']});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); rmSync(dir,{recursive:true,force:true}); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const read = (id,headers) => fetch(`${base}/v1/devices/${id}/client-config`,{headers});
  let response = await read('tv-one');
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).settings,{});
  const unused = runtimeStore.addSecret('never-delivered');
  const selected = runtimeStore.addSecret('selected-jackett-key');
  const other = runtimeStore.addSecret('other-tv-key');
  const publish = (scopeKey,document,mutationId) => service.publish({scopeKey,document,expectedRevision:0,mutationId,actorId:'test',reason:null});
  publish('global',{schemaVersion:1,scope:'global',values:{
    parser:{enabled:true,endpoint:{url:'https://jackett.example',mode:'gateway',credentialRef:selected}},
    torrServer:{enabled:true,primary:{url:'https://torr.example',mode:'gateway'}},
    metadata:{providerId:'tmdb',endpoint:{url:'https://tmdb.example',mode:'gateway'},locale:'ru-RU'},
    ui:{animations:false,theme:'dark'}
  }},'global');
  publish('device:tv-two',{schemaVersion:1,scope:'device',deviceId:'tv-two',values:{parser:{endpoint:{url:'https://other.example',mode:'gateway',credentialRef:other}}}},'device');
  response = await read('tv-one');
  const etag = response.headers.get('etag');
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'),null);
  const text = await response.text(), result = JSON.parse(text);
  assert.equal(result.schemaVersion,1);
  assert.equal(result.deviceId,'tv-one');
  assert.equal(result.settings.parser_use,true);
  assert.equal(result.settings.jackett_key,'selected-jackett-key');
  assert.equal(result.settings.jackett_url_two,'');
  assert.equal(result.settings.torrserver_url,'https://torr.example');
  assert.equal(result.settings.animation,false);
  assert.equal(result.metadata.baseUrl,'https://tmdb.example');
  assert.equal(result.settings.source,'tmdb');
  assert.equal(text.includes(unused),false);
  assert.equal(text.includes('never-delivered'),false);
  assert.equal(text.includes('other-tv-key'),false);
  assert.equal(text.includes('credentialRef'),false);
  assert.equal((await read('tv-one',{'if-none-match':etag})).status,304);
  const second = await (await read('tv-two')).json();
  assert.equal(second.settings.jackett_key,'other-tv-key');
  assert.equal(second.settings.jackett_url,'https://other.example');
  const head=repository.getHead('global');
  const disabled=structuredClone(head.document);
  disabled.values.parser.enabled=false;
  disabled.values.torrServer.enabled=false;
  service.publish({scopeKey:'global',document:disabled,expectedRevision:head.revision,mutationId:'disable',actorId:'test',reason:null});
  const off=await (await read('tv-one')).json();
  assert.equal(off.settings.parser_use,false);
  assert.equal(off.settings.jackett_key,'');
  assert.equal(off.settings.torrserver_url,'');
  runtimeStore.context.providerIds.clear();
  const invalid=await read('tv-one',{'if-none-match':etag});
  assert.equal(invalid.status,422);
  assert.equal((await invalid.text()).includes('selected-jackett-key'),false);
});
