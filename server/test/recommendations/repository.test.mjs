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
 db=openConfigDatabase(path); assert.equal(db.prepare('PRAGMA user_version').get().user_version,5); assert.equal(db.prepare('SELECT value FROM runtime_secrets').get().value,'value'); assert.equal(db.prepare('SELECT origin FROM runtime_lan_origins').get().origin,'http://example.test'); db.close();
 db=openConfigDatabase(path); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_profiles').get().n,1); db.close();
});

test('oversized and invalid snapshots leave existing data unchanged', t => {
 const db=openConfigDatabase(':memory:'); t.after(()=>db.close()); const repo=createRecommendationRepository(db), records=[record(1)];
 repo.replaceSnapshot({deviceId:'a',seq:1,digest:digest(records),records});
 const excess=Array.from({length:1001},(_,i)=>record(i+1)).sort((a,b)=>a.key.localeCompare(b.key));
 assert.throws(()=>repo.replaceSnapshot({deviceId:'a',seq:2,digest:digest(excess),records:excess}),code('SNAPSHOT_TOO_LARGE'));
 assert.deepEqual(repo.getProfileSignals('home').records,records);
});

test('migration creates durable job mutation aliases with profile-scoped uniqueness', t => {
 const db=openConfigDatabase(':memory:'); t.after(()=>db.close());
 db.exec("INSERT INTO ai_jobs(id,profile_id,kind,cache_key,request_digest,state,created_at) VALUES('j','home','home','home','digest','queued','now')");
 db.exec("INSERT INTO ai_job_mutations(profile_id,mutation_id,request_digest,job_id) VALUES('home','m','digest','j')");
 assert.throws(()=>db.exec("INSERT INTO ai_job_mutations(profile_id,mutation_id,request_digest,job_id) VALUES('home','m','other','j')"));
 assert.equal(db.prepare("SELECT job_id FROM ai_job_mutations WHERE profile_id='home' AND mutation_id='m'").get().job_id,'j');
});
