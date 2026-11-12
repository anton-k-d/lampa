import test from 'node:test';
import assert from 'node:assert/strict';
import { openConfigDatabase } from '../../src/config/database.mjs';
import { createRuntimeStore } from '../../src/runtime/store.mjs';
import { createAISettings } from '../../src/recommendations/settings.mjs';
import { createRecommendationRepository } from '../../src/recommendations/repository.mjs';
import { createJobs } from '../../src/recommendations/jobs.mjs';
import { createRecommendationService } from '../../src/recommendations/service.mjs';
import { digestRecords } from '../../src/recommendations/profiles.mjs';

const now = new Date('2026-11-12T08:00:00.000Z');
const yesterday = '2026-11-11T08:00:00.000Z';

test('resetting today’s quota allows another home request and keeps published data', () => {
  const db = openConfigDatabase(':memory:');
  try {
    const repository = createRecommendationRepository(db);
    const settings = createAISettings(db, createRuntimeStore(db));
    const records = [{ key: 'tmdb:movie:1', signals: ['liked'], rank: null, lastActivityAt: null }];
    repository.replaceSnapshot({ deviceId: 'tv', seq: 1, digest: digestRecords(records), records });
    const document = settings.read().document;
    settings.save({ ...document, enabled: true, limits: { ...document.limits, manualHome: 1 } }, 0, { key: 'test' });
    const jobs = createJobs(db);
    const service = createRecommendationService({
      db, repository, settings, jobs,
      provider: () => { throw new Error('unexpected metadata'); },
      transportFactory: () => { throw new Error('unexpected API'); },
      clock: () => now,
    });
    const profileId = repository.profileForDevice('tv');
    jobs.enqueue({ profileId, kind: 'home', cacheKey: 'home', mutationId: 'manual-1', now, requestDigest: 'null' });
    db.prepare("UPDATE ai_jobs SET state='ready' WHERE mutation_id='manual-1'").run();
    jobs.enqueue({ profileId, kind: 'home', cacheKey: 'home', mutationId: 'auto:2026-11-12', now, requestDigest: 'null' });
    db.prepare("UPDATE ai_jobs SET state='ready' WHERE mutation_id='auto:2026-11-12'").run();
    jobs.enqueue({ profileId, kind: 'similar', cacheKey: 'tmdb:movie:9', mutationId: 'similar-1', now, requestDigest: '{"type":"movie","id":9}' });
    db.prepare("UPDATE ai_jobs SET state='ready' WHERE mutation_id='similar-1'").run();
    const queued = jobs.enqueue({ profileId, kind: 'similar', cacheKey: 'tmdb:movie:8', mutationId: 'similar-queued', now, requestDigest: '{"type":"movie","id":8}' });
    db.prepare("INSERT INTO ai_jobs(id,profile_id,kind,cache_key,mutation_id,request_digest,state,lease_until,fencing_token,attempts,created_at,error_code) VALUES('yesterday',?,'home','home','manual-old','null','ready',NULL,0,0,? ,NULL)").run(profileId, yesterday);
    db.prepare("INSERT INTO ai_job_mutations(profile_id,mutation_id,request_digest,job_id) VALUES(?,'manual-old','null','yesterday')").run(profileId);
    const manualId = db.prepare("SELECT id FROM ai_jobs WHERE mutation_id='manual-1'").get().id;
    db.prepare("INSERT INTO ai_attempts(id,job_id,profile_id,budget_date,outcome,usage_json) VALUES('today',NULL,?,?,'success',NULL)").run(profileId, '2026-11-12');
    db.prepare("INSERT INTO ai_attempts(id,job_id,profile_id,budget_date,outcome,usage_json) VALUES('linked',? ,?,?,'success',NULL)").run(manualId, profileId, '2026-11-11');
    db.prepare("INSERT INTO ai_attempts(id,job_id,profile_id,budget_date,outcome,usage_json) VALUES('older',NULL,?,?,'success',NULL)").run(profileId, '2026-11-11');
    db.prepare("INSERT INTO ai_batches(id,profile_id,kind,cache_key,items_json,provenance_json,generated_at,expires_at) VALUES('batch',?,'home','home','[]','{}',?,?)").run(profileId, now.toISOString(), new Date(+now + 86400000).toISOString());
    db.prepare("INSERT INTO diagnostic_ai_events(id,time,kind,status,event_json) VALUES('event',?,'home','success','{}')").run(now.toISOString());

    assert.throws(() => service.requestHome({ deviceId: 'tv', mutationId: 'manual-2', now }), error => error.code === 'QUOTA_EXCEEDED');
    const result = service.resetDailyQuota(now);
    assert.deepEqual(result, { ok: true, date: '2026-11-12', jobs: 2, attempts: 2 });
    assert.equal(db.prepare("SELECT count(*) n FROM ai_jobs WHERE mutation_id='manual-1'").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM ai_jobs WHERE mutation_id='similar-1'").get().n, 0);
    assert.equal(db.prepare("SELECT id FROM ai_jobs WHERE mutation_id='auto:2026-11-12'").get().id !== undefined, true);
    assert.equal(db.prepare('SELECT state FROM ai_jobs WHERE id=?').get(queued.jobId).state, 'queued');
    assert.equal(db.prepare("SELECT count(*) n FROM ai_jobs WHERE id='yesterday'").get().n, 1);
    assert.equal(db.prepare("SELECT count(*) n FROM ai_attempts WHERE budget_date='2026-11-12'").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM ai_attempts WHERE id='older'").get().n, 1);
    assert.equal(db.prepare("SELECT count(*) n FROM ai_batches").get().n, 1);
    assert.equal(db.prepare("SELECT count(*) n FROM diagnostic_ai_events").get().n, 1);
    const next = service.requestHome({ deviceId: 'tv', mutationId: 'manual-2', now });
    assert.equal(next.state, 'queued');
  } finally {
    db.close();
  }
});
