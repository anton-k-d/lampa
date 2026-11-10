import { DatabaseSync } from 'node:sqlite';
import { chmodSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ConfigError } from './errors.mjs';

export function openConfigDatabase(path) {
  let db;
  try {
    if (path !== ':memory:') {
      const absolute = resolve(path), dir = dirname(absolute);
      try { mkdirSync(dir, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      const info = lstatSync(dir);
      if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077)) throw new Error('Insecure database directory');
      const fd = openSync(absolute, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
      try {
        const file = fstatSync(fd);
        if (!file.isFile() || file.uid !== process.getuid()) throw new Error('Insecure database file');
        chmodSync(absolute, 0o600);
      } finally { closeSync(fd); }
    }
    db = new DatabaseSync(path);
    db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > 4) throw new ConfigError('UNSUPPORTED_DB_VERSION', 'Unsupported database version');
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS config_revisions (
        revision INTEGER PRIMARY KEY AUTOINCREMENT, scope_key TEXT NOT NULL, document TEXT NOT NULL,
        content_hash TEXT NOT NULL, parent_revision INTEGER, restored_from INTEGER,
        actor_id TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL,
        FOREIGN KEY(parent_revision) REFERENCES config_revisions(revision),
        FOREIGN KEY(restored_from) REFERENCES config_revisions(revision));
        CREATE TABLE IF NOT EXISTS config_heads (scope_key TEXT PRIMARY KEY, revision INTEGER NOT NULL REFERENCES config_revisions(revision));
        CREATE TABLE IF NOT EXISTS config_mutations (actor_id TEXT NOT NULL, mutation_id TEXT NOT NULL, request_hash TEXT NOT NULL, revision INTEGER NOT NULL REFERENCES config_revisions(revision), PRIMARY KEY(actor_id, mutation_id));
        CREATE TABLE IF NOT EXISTS runtime_secrets (ref TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS runtime_lan_origins (origin TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS ai_profiles (id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0);
        INSERT OR IGNORE INTO ai_profiles(id,revision) VALUES('home',0);
        CREATE TABLE IF NOT EXISTS ai_profile_devices (device_id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES ai_profiles(id));
        CREATE TABLE IF NOT EXISTS ai_device_signals (device_id TEXT PRIMARY KEY REFERENCES ai_profile_devices(device_id), seq INTEGER NOT NULL, digest TEXT NOT NULL, records_json TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ai_settings (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, document_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ai_jobs (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES ai_profiles(id), kind TEXT NOT NULL, cache_key TEXT NOT NULL, mutation_id TEXT, request_digest TEXT NOT NULL, state TEXT NOT NULL, lease_until TEXT, fencing_token INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, error_code TEXT);
        CREATE UNIQUE INDEX IF NOT EXISTS ai_jobs_active_key ON ai_jobs(profile_id,kind,cache_key) WHERE state IN ('queued','running');
        CREATE UNIQUE INDEX IF NOT EXISTS ai_jobs_active_home ON ai_jobs(profile_id) WHERE kind='home' AND state IN ('queued','running');
        CREATE UNIQUE INDEX IF NOT EXISTS ai_jobs_mutation ON ai_jobs(profile_id,mutation_id) WHERE mutation_id IS NOT NULL;
        CREATE TABLE IF NOT EXISTS ai_job_mutations (profile_id TEXT NOT NULL REFERENCES ai_profiles(id), mutation_id TEXT NOT NULL, request_digest TEXT NOT NULL, job_id TEXT NOT NULL REFERENCES ai_jobs(id), PRIMARY KEY(profile_id,mutation_id));
        CREATE TABLE IF NOT EXISTS ai_attempts (id TEXT PRIMARY KEY, job_id TEXT REFERENCES ai_jobs(id), profile_id TEXT REFERENCES ai_profiles(id), budget_date TEXT NOT NULL, outcome TEXT NOT NULL, usage_json TEXT);
        CREATE TABLE IF NOT EXISTS ai_batches (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES ai_profiles(id), kind TEXT NOT NULL, cache_key TEXT NOT NULL, items_json TEXT NOT NULL, provenance_json TEXT NOT NULL, generated_at TEXT NOT NULL, expires_at TEXT);
        CREATE TABLE IF NOT EXISTS ai_metadata_cache (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, fetched_at TEXT NOT NULL, expires_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS diagnostic_client_logs (id TEXT PRIMARY KEY, device_id TEXT NOT NULL, received_at TEXT NOT NULL, snapshot_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS diagnostic_ai_events (id TEXT PRIMARY KEY, time TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, event_json TEXT NOT NULL);
        PRAGMA user_version=4`);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return db;
  } catch (error) {
    db?.close();
    if (error instanceof ConfigError) throw error;
    throw databaseError(error);
  }
}

export function databaseError(error) {
  if (error?.code === 'SQLITE_BUSY' || (error?.errcode & 255) === 5 || (error?.errcode & 255) === 6) return new ConfigError('BUSY', 'Configuration database is busy');
  return new ConfigError('INVALID_CONFIG', 'Configuration database operation failed');
}
