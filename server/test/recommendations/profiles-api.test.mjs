import test from 'node:test';
import assert from 'node:assert/strict';
import { openConfigDatabase } from '../../src/config/database.mjs';
import { createRuntimeStore } from '../../src/runtime/store.mjs';
import { createConfigRepository } from '../../src/config/repository.mjs';
import { createRecommendationRepository } from '../../src/recommendations/repository.mjs';
import { createAISettings } from '../../src/recommendations/settings.mjs';
import { createJobs } from '../../src/recommendations/jobs.mjs';
import { createRecommendationService } from '../../src/recommendations/service.mjs';
import { createHomeServer } from '../../src/http/server.mjs';
import { digestRecords } from '../../src/recommendations/profiles.mjs';

const pick = {key:'tmdb:movie:2', title:'Фильм', year:2020, media_type:'movie'};
const history = [{key:'tmdb:movie:1', signals:['history'], rank:null, lastActivityAt:null}];

test('admin profile, pick, device and catalog routes stay profile-scoped', async () => {
  const db = openConfigDatabase(':memory:');
  const runtimeStore = createRuntimeStore(db);
  const repository = createConfigRepository(db);
  const recommendationRepository = createRecommendationRepository(db);
  const aiSettings = createAISettings(db, runtimeStore);
  const document = aiSettings.read().document;
  aiSettings.save({...document, enabled:true, limits:{...document.limits, manualHome:1}}, 0, {key:'fixture'});
  let catalogMode = 'ready';
  const metadataProvider = () => {
    if (catalogMode === 'missing') throw Object.assign(new Error('missing'), {code:'METADATA_NOT_CONFIGURED'});
    return {
      getList: async ({type}) => [
        {key:`tmdb:${type}:4`, type, title:'Adult', release_date:'2022-01-01', poster_path:'/a.jpg', adult:true},
        {key:`tmdb:${type}:5`, type, title:'Visible', release_date:'2023-05-01', poster_path:'/v.jpg', adult:false}
      ],
      search: async ({query, type}) => [{key:`tmdb:${type}:6`, type, title:query, release_date:'2021-01-01', poster_path:'/s.jpg', adult:false}],
      imageUrl: path => path ? `https://images.test${path}` : null
    };
  };
  const recommendationService = createRecommendationService({db, repository:recommendationRepository, jobs:createJobs(db), settings:aiSettings, provider:() => { throw Error('unexpected'); }, transportFactory:() => { throw Error('unexpected'); }});
  const server = createHomeServer({db, repository, runtimeStore, aiSettings, recommendationRepository, recommendationService, metadataProvider, allowedHosts:['127.0.0.1']});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = async (method, path, body, headers = {}) => {
    const response = await fetch(base + path, {method, headers:{...(body ? {'content-type':'application/json'} : {}), ...headers}, body:body ? JSON.stringify(body) : undefined});
    return {status:response.status, body:await response.json()};
  };
  try {
    const created = await send('POST', '/v1/admin/ai/profiles', {name:' Дети '});
    assert.equal(created.status, 200);
    assert.deepEqual(created.body, {id:'deti', name:'Дети', revision:0});
    const duplicate = await send('POST', '/v1/admin/ai/profiles', {name:'Дети'});
    assert.equal(duplicate.body.id, 'deti-2');
    const renamed = await send('PUT', '/v1/admin/ai/profiles/deti', {name:'Дочь и сын'});
    assert.equal(renamed.body.name, 'Дочь и сын');
    assert.equal((await send('DELETE', '/v1/admin/ai/profiles/home')).status, 400);
    assert.equal((await send('PUT', '/v1/admin/ai/profiles/deti/picks', {picks:[pick]})).status, 428);
    assert.equal((await send('PUT', '/v1/admin/ai/profiles/deti/picks', {picks:[pick]}, {'if-match':'"r-9"'})).status, 412);
    assert.equal((await send('PUT', '/v1/admin/ai/profiles/deti/picks', {picks:[{...pick, posterUrl:'/x.jpg'}]}, {'if-match':'"r-0"'})).status, 400);
    const saved = await send('PUT', '/v1/admin/ai/profiles/deti/picks', {picks:[pick]}, {'if-match':'"r-0"'});
    assert.equal(saved.status, 200);
    assert.equal(saved.body.revision, 1);
    assert.deepEqual((await send('GET', '/v1/admin/ai/profiles/deti/picks')).body.picks, [pick]);
    const assigned = await send('PUT', '/v1/admin/ai/devices/tv/profile', {profileId:'deti'});
    assert.deepEqual(assigned.body, {deviceId:'tv', profileId:'deti'});
    assert.equal((await send('GET', '/v1/admin/ai/devices')).body.devices[0].profileId, 'deti');
    const early = await send('POST', '/v1/admin/ai/profiles/deti/refresh', undefined, {'idempotency-key':'refresh-1'});
    assert.equal(early.status, 200);
    assert.equal(early.body.state, 'needs_history');
    recommendationRepository.replaceSnapshot({deviceId:'tv', seq:1, digest:digestRecords(history), records:history});
    const queued = await send('POST', '/v1/admin/ai/profiles/deti/refresh', undefined, {'idempotency-key':'refresh-1'});
    assert.equal(queued.status, 202);
    const repeated = await send('POST', '/v1/admin/ai/profiles/deti/refresh', undefined, {'idempotency-key':'refresh-1'});
    assert.equal(repeated.body.jobId, queued.body.jobId);
    db.prepare("UPDATE ai_jobs SET state='ready' WHERE id=?").run(queued.body.jobId);
    const limited = await send('POST', '/v1/admin/ai/profiles/deti/refresh', undefined, {'idempotency-key':'refresh-2'});
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, 'QUOTA_EXCEEDED');
    catalogMode = 'missing';
    const missing = await send('GET', '/v1/admin/ai/catalog/browse?type=movie&category=trending');
    assert.equal(missing.status, 422);
    assert.equal(missing.body.code, 'METADATA_NOT_CONFIGURED');
    catalogMode = 'ready';
    const browse = await send('GET', '/v1/admin/ai/catalog/browse?type=movie&category=discover');
    assert.deepEqual(browse.body.cards, [{key:'tmdb:movie:5', title:'Visible', year:2023, media_type:'movie', posterUrl:'https://images.test/v.jpg'}]);
    const search = await send('GET', '/v1/admin/ai/catalog/search?query=Query');
    assert.deepEqual(search.body.cards.map(card => card.key), ['tmdb:movie:6', 'tmdb:tv:6']);
    const removed = await send('DELETE', '/v1/admin/ai/profiles/deti');
    assert.deepEqual(removed.body, {id:'deti', movedDevices:1});
    assert.equal((await send('GET', '/v1/admin/ai/devices')).body.devices[0].profileId, 'home');
    assert.equal((await send('GET', '/v1/admin/ai/profiles/missing')).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});
