import { DatabaseSync } from 'node:sqlite';
import { ConfigError } from './errors.mjs';

export function openConfigDatabase(path) {
  let db;
  try {
    db = new DatabaseSync(path);
    db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) throw new ConfigError('UNSUPPORTED_DB_VERSION', 'Unsupported database version');
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
        PRAGMA user_version=1`);
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
