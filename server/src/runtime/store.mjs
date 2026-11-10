import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { ConfigError } from '../config/errors.mjs';
import { databaseError } from '../config/database.mjs';

const invalid = () => new ConfigError('INVALID_CONFIG', 'Invalid runtime request');
function validOrigin(origin, allowLoopback) {
  if (typeof origin !== 'string') return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || url.origin !== origin || url.username || url.password || url.pathname !== '/' || url.search || url.hash || origin.includes('?') || origin.includes('#')) return false;
    const host = url.hostname;
    if (isIP(host) === 4) {
      const [a,b] = host.split('.').map(Number);
      return a !== 0 && a < 224 && !(a === 169 && b === 254) && (a !== 127 || allowLoopback);
    }
    if (host === 'localhost' || host.endsWith('.localhost')) return allowLoopback;
    if (host === 'metadata.google.internal') return false;
    return host.length <= 253 && host.split('.').every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
  } catch { return false; }
}

export function createRuntimeStore(db, { allowLoopbackForDevelopment = false } = {}) {
  const read = (sql, ...params) => { try { return db.prepare(sql).all(...params); } catch (e) { throw databaseError(e); } };
  const context = {
    providerIds: new Set(['tmdb']), reviewedPlugins: new Map(),
    get secretRefs() { return new Set(read('SELECT ref FROM runtime_secrets ORDER BY ref').map(row => row.ref)); },
    get allowedLanOrigins() { return new Set(read('SELECT origin FROM runtime_lan_origins ORDER BY origin').map(row => row.origin)); },
  };
  function write(sql, ...params) {
    let active = false;
    try { db.exec('BEGIN IMMEDIATE'); active = true; db.prepare(sql).run(...params); db.exec('COMMIT'); active = false; }
    catch (error) { if (active) { try { db.exec('ROLLBACK'); } catch {} } throw databaseError(error); }
  }
  return {
    context,
    addSecret(value) {
      if (typeof value !== 'string' || !value.length || Buffer.byteLength(value, 'utf8') > 16384) throw invalid();
      const ref = `secret:${randomUUID()}`;
      write('INSERT INTO runtime_secrets(ref,value,created_at) VALUES(?,?,?)', ref, value, new Date().toISOString());
      return ref;
    },
    secretStatus() { return read('SELECT ref, created_at FROM runtime_secrets ORDER BY created_at, ref').map(row => ({ ref: row.ref, createdAt: row.created_at })); },
    allowLanOrigin(origin) {
      if (!validOrigin(origin, allowLoopbackForDevelopment)) throw invalid();
      write('INSERT OR IGNORE INTO runtime_lan_origins(origin) VALUES(?)', origin);
      return origin;
    },
    readSecret(ref) { return read('SELECT value FROM runtime_secrets WHERE ref=?', ref)[0]?.value ?? null; },
  };
}
