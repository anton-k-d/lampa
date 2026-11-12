import { ConfigError } from '../config/errors.mjs';
import { aggregateRecords, digestRecords } from './profiles.mjs';
const allowed=new Set(['liked','bookmarked','planned','history','started','completed','abandoned']);
const profileIdPattern=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const deviceIdPattern=/^[A-Za-z0-9_-]{1,128}$/;
const pickKeyPattern=/^tmdb:(movie|tv):[1-9][0-9]{0,11}$/;
const fail=(code,message,extra)=>{ throw new ConfigError(code,message,extra); };
const validProfileId=id=>typeof id==='string' && profileIdPattern.test(id);
function cleanName(name) {
  if (typeof name!=='string') fail('BAD_REQUEST','Invalid profile name');
  const trimmed=name.trim();
  if (!trimmed || trimmed.length>80 || /[\u0000-\u001f]/.test(trimmed)) fail('BAD_REQUEST','Invalid profile name');
  return trimmed;
}
function cleanPicks(picks) {
  if (!Array.isArray(picks) || picks.length>200) fail('BAD_REQUEST','Invalid picks');
  const seen=new Set();
  return picks.map(pick => {
    const fields=pick && typeof pick==='object' && !Array.isArray(pick) ? Object.keys(pick).sort().join(',') : '';
    const key=pick?.key;
    if (fields!=='key,media_type,title,year' || typeof key!=='string' || !pickKeyPattern.test(key) || pick.media_type!==key.split(':')[1] || seen.has(key)) fail('BAD_REQUEST','Invalid pick');
    seen.add(key);
    if (typeof pick.title!=='string' || !pick.title.trim() || pick.title.trim().length>300) fail('BAD_REQUEST','Invalid pick');
    if (!Number.isSafeInteger(pick.year) || pick.year<1870 || pick.year>2100) fail('BAD_REQUEST','Invalid pick');
    return {key,title:pick.title.trim(),year:pick.year,media_type:pick.media_type};
  });
}
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
    const picks=db.prepare('SELECT key FROM ai_profile_picks WHERE profile_id=? ORDER BY key').all(profileId).map(pick=>({key:pick.key,signals:['liked'],rank:null,lastActivityAt:null}));
    const records=aggregateRecords([...snapshots.map(s=>JSON.parse(s.records_json)),...(picks.length?[picks]:[])]);
    return {profileId,revision:profile.revision,records,digest:digestRecords(records),devices:snapshots.length};
  }
  function requireProfile(id) {
    if (!validProfileId(id)) fail('BAD_REQUEST','Invalid profile');
    const profile=db.prepare('SELECT id,name,revision FROM ai_profiles WHERE id=?').get(id);
    if (!profile) fail('NOT_FOUND','Profile not found');
    return profile;
  }
  function listProfiles() {
    return db.prepare(`SELECT p.id,p.name,p.revision,
      (SELECT count(*) FROM ai_profile_devices d WHERE d.profile_id=p.id) AS devices,
      (SELECT count(*) FROM ai_profile_picks k WHERE k.profile_id=p.id) AS picks,
      (SELECT max(generated_at) FROM ai_batches b WHERE b.profile_id=p.id AND b.kind='home') AS lastBatchAt
      FROM ai_profiles p ORDER BY p.id`).all().map(row=>({id:row.id,name:row.name||row.id,revision:row.revision,devices:row.devices,picks:row.picks,lastBatchAt:row.lastBatchAt??null}));
  }
  function createProfile({id,name}) {
    if (!validProfileId(id)) fail('BAD_REQUEST','Invalid profile');
    const clean=cleanName(name);
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare('SELECT 1 FROM ai_profiles WHERE id=?').get(id)) fail('BAD_REQUEST','Profile already exists');
      db.prepare('INSERT INTO ai_profiles(id,revision,name) VALUES(?,0,?)').run(id,clean);
      db.exec('COMMIT');
      return {id,name:clean,revision:0};
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function renameProfile(id,name) {
    const profile=requireProfile(id);
    const clean=cleanName(name);
    db.prepare('UPDATE ai_profiles SET name=? WHERE id=?').run(clean,profile.id);
    return {id:profile.id,name:clean,revision:profile.revision};
  }
  function deleteProfile(id) {
    if (id==='home') fail('BAD_REQUEST','The home profile cannot be deleted');
    requireProfile(id);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM ai_job_mutations WHERE profile_id=? OR job_id IN (SELECT id FROM ai_jobs WHERE profile_id=?)').run(id,id);
      db.prepare('DELETE FROM ai_attempts WHERE profile_id=? OR job_id IN (SELECT id FROM ai_jobs WHERE profile_id=?)').run(id,id);
      db.prepare('DELETE FROM ai_jobs WHERE profile_id=?').run(id);
      db.prepare('DELETE FROM ai_batches WHERE profile_id=?').run(id);
      db.prepare('DELETE FROM ai_profile_picks WHERE profile_id=?').run(id);
      const moved=db.prepare("UPDATE ai_profile_devices SET profile_id='home' WHERE profile_id=?").run(id).changes;
      if (moved) db.prepare("UPDATE ai_profiles SET revision=revision+1 WHERE id='home'").run();
      db.prepare('DELETE FROM ai_profiles WHERE id=?').run(id);
      db.exec('COMMIT');
      return {id,movedDevices:moved};
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function listDevices() {
    return db.prepare(`SELECT d.device_id AS deviceId,d.profile_id AS profileId,s.updated_at AS updatedAt,s.records_json AS recordsJson
      FROM ai_profile_devices d LEFT JOIN ai_device_signals s ON s.device_id=d.device_id ORDER BY d.device_id`).all().map(row=>{
      let records=0;
      if (row.recordsJson) { try { records=JSON.parse(row.recordsJson).length; } catch { records=0; } }
      return {deviceId:row.deviceId,profileId:row.profileId,updatedAt:row.updatedAt??null,records};
    });
  }
  function assignDeviceProfile({deviceId,profileId}) {
    if (typeof deviceId!=='string' || !deviceIdPattern.test(deviceId)) fail('BAD_REQUEST','Invalid device');
    requireProfile(profileId);
    db.exec('BEGIN IMMEDIATE');
    try {
      const current=db.prepare('SELECT profile_id FROM ai_profile_devices WHERE device_id=?').get(deviceId);
      if (current?.profile_id===profileId) { db.exec('COMMIT'); return {deviceId,profileId}; }
      if (current) db.prepare('UPDATE ai_profile_devices SET profile_id=? WHERE device_id=?').run(profileId,deviceId);
      else db.prepare('INSERT INTO ai_profile_devices(device_id,profile_id) VALUES(?,?)').run(deviceId,profileId);
      if (current) db.prepare('UPDATE ai_profiles SET revision=revision+1 WHERE id=?').run(current.profile_id);
      db.prepare('UPDATE ai_profiles SET revision=revision+1 WHERE id=?').run(profileId);
      db.exec('COMMIT');
      return {deviceId,profileId};
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function getPicks(profileId) {
    const profile=requireProfile(profileId);
    const picks=db.prepare('SELECT key,title,year,media_type AS media_type FROM ai_profile_picks WHERE profile_id=? ORDER BY key').all(profileId).map(pick=>({key:pick.key,title:pick.title,year:pick.year,media_type:pick.media_type}));
    return {profileId,revision:profile.revision,picks};
  }
  function setPicks(profileId,picks,expectedRevision) {
    const clean=cleanPicks(picks);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision<0) fail('BAD_REQUEST','Invalid revision');
    requireProfile(profileId);
    db.exec('BEGIN IMMEDIATE');
    try {
      const profile=db.prepare('SELECT revision FROM ai_profiles WHERE id=?').get(profileId);
      if (!profile) fail('NOT_FOUND','Profile not found');
      if (profile.revision!==expectedRevision) fail('REVISION_CONFLICT','Profile changed',{currentRevision:profile.revision});
      db.prepare('DELETE FROM ai_profile_picks WHERE profile_id=?').run(profileId);
      const insert=db.prepare('INSERT INTO ai_profile_picks(profile_id,key,title,year,media_type,added_at) VALUES(?,?,?,?,?,?)');
      const now=new Date().toISOString();
      for (const pick of clean) insert.run(profileId,pick.key,pick.title,pick.year,pick.media_type,now);
      db.prepare('UPDATE ai_profiles SET revision=revision+1 WHERE id=?').run(profileId);
      db.exec('COMMIT');
      return getPicks(profileId);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return {profileForDevice,replaceSnapshot,getProfileSignals,listProfiles,createProfile,renameProfile,deleteProfile,listDevices,assignDeviceProfile,getPicks,setPicks};
}
