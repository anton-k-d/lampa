import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openConfigDatabase } from '../../src/config/database.mjs';
import { createRecommendationRepository } from '../../src/recommendations/repository.mjs';
const digest = records => createHash('sha256').update(JSON.stringify(records)).digest('hex');
const record = (id,signal='history') => ({key:`tmdb:movie:${id}`,signals:[signal],rank:null,lastActivityAt:null});
const code = value => e => e.code===value;
test('device snapshots use atomic CAS, isolate deletion, and follow profile membership', t => {
 const db=openConfigDatabase(':memory:'); t.after(()=>db.close()); const repo=createRecommendationRepository(db);
 const a=[record(1)],b=[record(2)];
 assert.equal(repo.profileForDevice('a'),'home');
 assert.deepEqual(repo.replaceSnapshot({deviceId:'a',seq:1,digest:digest(a),records:a}),{acceptedSeq:1,profileRevision:1,skipped:0});
 assert.equal(repo.replaceSnapshot({deviceId:'a',seq:1,digest:digest(a),records:a}).profileRevision,1);
 assert.throws(()=>repo.replaceSnapshot({deviceId:'a',seq:1,digest:digest(b),records:b}),code('SEQUENCE_CONFLICT'));
 assert.throws(()=>repo.replaceSnapshot({deviceId:'a',seq:0,digest:digest(b),records:b}),code('STALE_SEQUENCE'));
 repo.replaceSnapshot({deviceId:'b',seq:1,digest:digest(b),records:b});
 repo.replaceSnapshot({deviceId:'a',seq:2,digest:digest([]),records:[]});
 assert.deepEqual(repo.getProfileSignals('home').records,b);
 db.exec("INSERT INTO ai_profiles(id,revision) VALUES('other',0); UPDATE ai_profile_devices SET profile_id='other' WHERE device_id='b'");
 assert.deepEqual(repo.getProfileSignals('home').records,[]); assert.deepEqual(repo.getProfileSignals('other').records,b);
 assert.throws(()=>repo.replaceSnapshot({deviceId:'b',seq:2,digest:'0'.repeat(64),records:[]}),code('INVALID_SIGNALS'));
 assert.deepEqual(repo.getProfileSignals('other').records,b);
});

test('migration preserves existing v2 configuration data and reopens', async t => {
 const {mkdtempSync,rmSync}=await import('node:fs'); const {tmpdir}=await import('node:os'); const {join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'ai-migration-')); t.after(()=>rmSync(dir,{recursive:true,force:true})); const path=join(dir,'config.db');
 let db=openConfigDatabase(path); db.exec("INSERT INTO runtime_secrets VALUES('test','value','2026-01-01'); INSERT INTO runtime_lan_origins VALUES('http://example.test'); DROP TABLE ai_metadata_cache; DROP TABLE ai_batches; DROP TABLE ai_attempts; DROP TABLE ai_job_mutations; DROP TABLE ai_jobs; DROP TABLE ai_settings; DROP TABLE ai_device_signals; DROP TABLE ai_profile_devices; DROP TABLE ai_profiles; PRAGMA user_version=2"); db.close();
 db=openConfigDatabase(path); assert.equal(db.prepare('PRAGMA user_version').get().user_version,6); assert.equal(db.prepare("SELECT name FROM ai_profiles WHERE id='home'").get().name,'Общий'); assert.equal(db.prepare('SELECT value FROM runtime_secrets').get().value,'value'); assert.equal(db.prepare('SELECT origin FROM runtime_lan_origins').get().origin,'http://example.test'); db.close();
 db=openConfigDatabase(path); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_profiles').get().n,1); db.close();
});

test('oversized and invalid snapshots leave existing data unchanged', t => {
 const db=openConfigDatabase(':memory:'); t.after(()=>db.close()); const repo=createRecommendationRepository(db), records=[record(1)];
 repo.replaceSnapshot({deviceId:'a',seq:1,digest:digest(records),records});
 const excess=Array.from({length:1001},(_,i)=>record(i+1)).sort((a,b)=>a.key.localeCompare(b.key));
 assert.throws(()=>repo.replaceSnapshot({deviceId:'a',seq:2,digest:digest(excess),records:excess}),code('SNAPSHOT_TOO_LARGE'));
 assert.deepEqual(repo.getProfileSignals('home').records,records);
});

test('v5 profiles gain a display name and an empty pick list without losing devices', async t => {
 const {mkdtempSync,rmSync}=await import('node:fs'); const {tmpdir}=await import('node:os'); const {join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'ai-profiles-v5-')); t.after(()=>rmSync(dir,{recursive:true,force:true})); const path=join(dir,'config.db');
 let db=openConfigDatabase(path);
 db.exec("PRAGMA foreign_keys=OFF; CREATE TABLE ai_profiles_v5 (id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0); INSERT INTO ai_profiles_v5(id,revision) SELECT id,revision FROM ai_profiles; DROP TABLE ai_profiles; ALTER TABLE ai_profiles_v5 RENAME TO ai_profiles; INSERT INTO ai_profile_devices(device_id,profile_id) VALUES('tv-old','home'); PRAGMA user_version=5");
 db.close();
 db=openConfigDatabase(path);
 assert.equal(db.prepare('PRAGMA user_version').get().user_version,6);
 assert.equal(db.prepare("SELECT name FROM ai_profiles WHERE id='home'").get().name,'Общий');
 assert.equal(db.prepare("SELECT profile_id FROM ai_profile_devices WHERE device_id='tv-old'").get().profile_id,'home');
 assert.equal(db.prepare('SELECT count(*) AS n FROM ai_profile_picks').get().n,0);
 db.close();
});

test('profiles, device assignment and survey picks are durable and revision-checked', t => {
 const db=openConfigDatabase(':memory:'); t.after(()=>db.close()); const repo=createRecommendationRepository(db);
 const history=[record(1,'history')];
 repo.replaceSnapshot({deviceId:'tv',seq:1,digest:digest(history),records:history});
 assert.equal(repo.listProfiles().find(profile=>profile.id==='home').name,'Общий');
 assert.deepEqual(repo.createProfile({id:'kids',name:' Дети '}),{id:'kids',name:'Дети',revision:0});
 assert.throws(()=>repo.createProfile({id:'kids',name:'Ещё'}),code('BAD_REQUEST'));
 assert.throws(()=>repo.createProfile({id:'Дети',name:'Дети'}),code('BAD_REQUEST'));
 assert.equal(repo.renameProfile('kids','Дочь и сын').name,'Дочь и сын');
 assert.deepEqual(repo.assignDeviceProfile({deviceId:'tv',profileId:'kids'}),{deviceId:'tv',profileId:'kids'});
 assert.equal(repo.listDevices().find(device=>device.deviceId==='tv').records,1);
 const pick={key:'tmdb:movie:2',title:'Фильм',year:2020,media_type:'movie'};
 const saved=repo.setPicks('kids',[pick],1);
 assert.equal(saved.revision,2); assert.deepEqual(saved.picks,[pick]);
 assert.throws(()=>repo.setPicks('kids',[pick],1),e=>e.code==='REVISION_CONFLICT' && e.currentRevision===2);
 assert.throws(()=>repo.setPicks('kids',[{...pick,poster:'/x.jpg'}],2),code('BAD_REQUEST'));
 assert.throws(()=>repo.setPicks('kids',[{...pick,key:'tmdb:tv:2'}],2),code('BAD_REQUEST'));
 const signals=repo.getProfileSignals('kids');
 assert.deepEqual(signals.records.find(item=>item.key==='tmdb:movie:2').signals,['liked']);
 assert.ok(signals.records.some(item=>item.key==='tmdb:movie:1' && item.signals.includes('history')));
 db.prepare("INSERT INTO ai_jobs(id,profile_id,kind,cache_key,request_digest,state,created_at) VALUES('job','kids','home','home','null','queued','2026-11-12T00:00:00.000Z')").run();
 db.prepare("INSERT INTO ai_job_mutations(profile_id,mutation_id,request_digest,job_id) VALUES('kids','m','null','job')").run();
 db.prepare("INSERT INTO ai_attempts(id,job_id,profile_id,budget_date,outcome) VALUES('attempt','job','kids','2026-11-12','reserved')").run();
 db.prepare("INSERT INTO ai_batches(id,profile_id,kind,cache_key,items_json,provenance_json,generated_at,expires_at) VALUES('batch','kids','home','home','[]','{}','2026-11-12T00:00:00.000Z','2026-11-13T00:00:00.000Z')").run();
 assert.deepEqual(repo.deleteProfile('kids'),{id:'kids',movedDevices:1});
 assert.equal(repo.profileForDevice('tv'),'home');
 assert.equal(db.prepare("SELECT count(*) AS n FROM ai_jobs WHERE profile_id='kids'").get().n,0);
 assert.equal(db.prepare("SELECT count(*) AS n FROM ai_profile_picks WHERE profile_id='kids'").get().n,0);
 assert.equal(db.prepare('SELECT count(*) AS n FROM ai_batches').get().n,0);
 assert.throws(()=>repo.deleteProfile('home'),code('BAD_REQUEST'));
 assert.throws(()=>repo.getPicks('kids'),code('NOT_FOUND'));
});

test('survey picks count as likes and drop out of a served home batch', async t => {
 const {createRuntimeStore}=await import('../../src/runtime/store.mjs');
 const {createAISettings}=await import('../../src/recommendations/settings.mjs');
 const {createJobs}=await import('../../src/recommendations/jobs.mjs');
 const {createRecommendationService}=await import('../../src/recommendations/service.mjs');
 const db=openConfigDatabase(':memory:'); t.after(()=>db.close());
 const repo=createRecommendationRepository(db), settings=createAISettings(db,createRuntimeStore(db));
 const history=[record(1,'history')];
 repo.replaceSnapshot({deviceId:'tv',seq:1,digest:digest(history),records:history});
 repo.createProfile({id:'kids',name:'Дети'});
 repo.assignDeviceProfile({deviceId:'tv',profileId:'kids'});
 repo.setPicks('kids',[{key:'tmdb:movie:2',title:'Фильм',year:2020,media_type:'movie'}],1);
 settings.save({...settings.read().document,enabled:true},0,{key:'fixture'});
 const selection={requested:30,proposed:2,resolved:2,excluded:0,returned:2,unresolved:0};
 db.prepare('INSERT INTO ai_batches(id,profile_id,kind,cache_key,items_json,provenance_json,generated_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').run('batch','kids','home','home',JSON.stringify([{card:{key:'tmdb:movie:2'}},{card:{key:'tmdb:movie:3'}}]),JSON.stringify({pipeline:'web-research-v3',selection}),'2026-11-12T09:00:00.000Z','2099-11-13T09:00:00.000Z');
 const read=createRecommendationService({db,repository:repo,settings,jobs:createJobs(db),provider:()=>{throw Error('unexpected');},transportFactory:()=>{throw Error('unexpected');}}).readHome('tv');
 assert.equal(read.state,'ready');
 assert.deepEqual(read.items.map(item=>item.card.key),['tmdb:movie:3']);
 assert.equal(read.selection.returned,1);
});

test('migration creates durable job mutation aliases with profile-scoped uniqueness', t => {
 const db=openConfigDatabase(':memory:'); t.after(()=>db.close());
 db.exec("INSERT INTO ai_jobs(id,profile_id,kind,cache_key,request_digest,state,created_at) VALUES('j','home','home','home','digest','queued','now')");
 db.exec("INSERT INTO ai_job_mutations(profile_id,mutation_id,request_digest,job_id) VALUES('home','m','digest','j')");
 assert.throws(()=>db.exec("INSERT INTO ai_job_mutations(profile_id,mutation_id,request_digest,job_id) VALUES('home','m','other','j')"));
 assert.equal(db.prepare("SELECT job_id FROM ai_job_mutations WHERE profile_id='home' AND mutation_id='m'").get().job_id,'j');
});
