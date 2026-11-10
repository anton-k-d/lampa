import { ConfigError } from '../config/errors.mjs';
import { aggregateRecords, digestRecords } from './profiles.mjs';
const allowed=new Set(['liked','bookmarked','planned','history','started','completed','abandoned']);
const fail=(code,message)=>{ throw new ConfigError(code,message); };
function validate(records) {
  if (!Array.isArray(records)) fail('INVALID_SIGNALS','Invalid records');
  if (records.length>1000 || Buffer.byteLength(JSON.stringify(records))>192*1024) fail('SNAPSHOT_TOO_LARGE','Snapshot is too large');
  let previous='';
  for (const r of records) {
    if (!r || Object.keys(r).sort().join(',')!=='key,lastActivityAt,rank,signals' || typeof r.key!=='string' || !/^tmdb:(movie|tv):[1-9][0-9]{0,11}$/.test(r.key) || r.key<=previous || !Array.isArray(r.signals) || !r.signals.length || r.signals.some((s,i)=>!allowed.has(s) || (i>0 && r.signals[i-1]>=s)) || !(r.rank===null || Number.isSafeInteger(r.rank) && r.rank>=0) || !(r.lastActivityAt===null || typeof r.lastActivityAt==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.lastActivityAt) && Number.isFinite(Date.parse(r.lastActivityAt)) && new Date(r.lastActivityAt).toISOString()===r.lastActivityAt)) fail('INVALID_SIGNALS','Invalid record');
    previous=r.key;
  }
}
export function createRecommendationRepository(db) {
  function profileForDevice(deviceId) {
    if (typeof deviceId!=='string' || !deviceId || deviceId.length>256) fail('INVALID_SIGNALS','Invalid device');
    db.prepare("INSERT OR IGNORE INTO ai_profile_devices(device_id,profile_id) VALUES(?,'home')").run(deviceId);
    return db.prepare('SELECT profile_id FROM ai_profile_devices WHERE device_id=?').get(deviceId).profile_id;
  }
  function replaceSnapshot({deviceId,seq,digest,records}) {
    validate(records);
    if (!Number.isSafeInteger(seq) || seq<0 || typeof digest!=='string' || digest!==digestRecords(records)) fail('INVALID_SIGNALS','Invalid snapshot');
    db.exec('BEGIN IMMEDIATE');
    try {
      const profileId=profileForDevice(deviceId);
      const old=db.prepare('SELECT seq,digest FROM ai_device_signals WHERE device_id=?').get(deviceId);
      if (old && seq<old.seq) fail('STALE_SEQUENCE','Stale snapshot');
      if (old && seq===old.seq && digest!==old.digest) fail('SEQUENCE_CONFLICT','Sequence conflict');
      if (!old || seq!==old.seq) {
        db.prepare('INSERT INTO ai_device_signals(device_id,seq,digest,records_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET seq=excluded.seq,digest=excluded.digest,records_json=excluded.records_json,updated_at=excluded.updated_at').run(deviceId,seq,digest,JSON.stringify(records),new Date().toISOString());
        db.prepare('UPDATE ai_profiles SET revision=revision+1 WHERE id=?').run(profileId);
      }
      const profileRevision=db.prepare('SELECT revision FROM ai_profiles WHERE id=?').get(profileId).revision;
      db.exec('COMMIT'); return {acceptedSeq:seq,profileRevision,skipped:0};
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function getProfileSignals(profileId) {
    const profile=db.prepare('SELECT revision FROM ai_profiles WHERE id=?').get(profileId);
    if (!profile) fail('NOT_FOUND','Profile not found');
    const snapshots=db.prepare('SELECT s.records_json FROM ai_device_signals s JOIN ai_profile_devices d ON d.device_id=s.device_id WHERE d.profile_id=?').all(profileId);
    const records=aggregateRecords(snapshots.map(s=>JSON.parse(s.records_json)));
    return {profileId,revision:profile.revision,records,digest:digestRecords(records),devices:snapshots.length};
  }
  return {profileForDevice,replaceSnapshot,getProfileSignals};
}
