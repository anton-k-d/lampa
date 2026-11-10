import { ConfigError } from './errors.mjs';
import { canonicalJson, sha256Json } from './canonical.mjs';
import { databaseError } from './database.mjs';

const invalid = () => new ConfigError('INVALID_CONFIG', 'Invalid configuration request');
const snapshot = row => row ? ({ revision: row.revision, scopeKey: row.scope_key, document: JSON.parse(row.document), contentHash: row.content_hash, parentRevision: row.parent_revision, restoredFrom: row.restored_from, actorId: row.actor_id, reason: row.reason, createdAt: row.created_at }) : null;
const revisionOk = n => Number.isSafeInteger(n) && n >= 0;
function matches(scope, document) {
  return document && typeof document === 'object' && ((scope === 'global' && document.scope === 'global' && !Object.hasOwn(document, 'deviceId')) || (scope.startsWith('device:') && scope.length > 7 && document.scope === 'device' && document.deviceId === scope.slice(7)));
}

export function createConfigRepository(db) {
  const query = (sql, ...args) => { try { return db.prepare(sql).all(...args); } catch (e) { throw databaseError(e); } };
  const getRevision = revision => snapshot(query('SELECT * FROM config_revisions WHERE revision=?', revision)[0]);
  const getHead = scope => snapshot(query('SELECT r.* FROM config_heads h JOIN config_revisions r ON r.revision=h.revision WHERE h.scope_key=?', scope)[0]);
  const listHeads = () => query('SELECT r.* FROM config_heads h JOIN config_revisions r ON r.revision=h.revision ORDER BY h.scope_key').map(snapshot);
  const listRevisions = (scope, { beforeRevision, limit = 20 } = {}) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || (beforeRevision !== undefined && (!revisionOk(beforeRevision) || beforeRevision === 0))) throw invalid();
    return query('SELECT * FROM config_revisions WHERE scope_key=? AND revision<? ORDER BY revision DESC LIMIT ?', scope, beforeRevision ?? Number.MAX_SAFE_INTEGER, Math.min(limit, 100)).map(snapshot);
  };
  function change(operation, input, validateCandidate) {
    const validCommon = input && typeof input.scopeKey === 'string'
      && revisionOk(input.expectedRevision)
      && typeof input.actorId === 'string' && input.actorId.length > 0
      && typeof input.mutationId === 'string' && input.mutationId.length > 0
      && (input.reason === null || typeof input.reason === 'string')
      && typeof validateCandidate === 'function';
    if (!validCommon) throw invalid();
    const validOperation = operation === 'rollback'
      ? revisionOk(input.targetRevision) && input.targetRevision > 0
      : matches(input.scopeKey, input.document);
    if (!validOperation) throw invalid();
    let hash;
    try { hash = sha256Json({ ...input, operation }); } catch { throw invalid(); }
    let inTransaction = false;
    try {
      db.exec('BEGIN IMMEDIATE');
      inTransaction = true;
      const prior = db.prepare('SELECT request_hash, revision FROM config_mutations WHERE actor_id=? AND mutation_id=?').get(input.actorId, input.mutationId);
      if (prior) {
        if (prior.request_hash !== hash) throw new ConfigError('IDEMPOTENCY_MISMATCH', 'Mutation ID already used for a different request');
        const result = getRevision(prior.revision);
        db.exec('COMMIT');
        inTransaction = false;
        return result;
      }
      const head = getHead(input.scopeKey);
      const currentRevision = head?.revision ?? 0;
      if (currentRevision !== input.expectedRevision) {
        throw new ConfigError('REVISION_CONFLICT', 'Configuration revision conflict', { currentRevision });
      }
      let document = input.document;
      if (operation === 'rollback') {
        const target = getRevision(input.targetRevision);
        if (!target || target.scopeKey !== input.scopeKey) throw new ConfigError('NOT_FOUND', 'Configuration revision not found');
        document = target.document;
      }
      const result = validateCandidate(document, listHeads());
      if (result != null && typeof result.then === 'function') {
        Promise.resolve(result).catch(() => {});
        throw invalid();
      }
      const serialized = canonicalJson(document);
      const insert = db.prepare(`INSERT INTO config_revisions
        (scope_key, document, content_hash, parent_revision, restored_from, actor_id, reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        input.scopeKey, serialized, sha256Json(document), head?.revision ?? null,
        operation === 'rollback' ? input.targetRevision : null,
        input.actorId, input.reason, new Date().toISOString(),
      );
      const revision = Number(insert.lastInsertRowid);
      if (!Number.isSafeInteger(revision)) throw invalid();
      db.prepare('INSERT INTO config_heads(scope_key,revision) VALUES(?,?) ON CONFLICT(scope_key) DO UPDATE SET revision=excluded.revision').run(input.scopeKey, revision);
      db.prepare('INSERT INTO config_mutations(actor_id,mutation_id,request_hash,revision) VALUES(?,?,?,?)').run(input.actorId, input.mutationId, hash, revision);
      const committed = getRevision(revision);
      db.exec('COMMIT');
      inTransaction = false;
      return committed;
    } catch (error) {
      if (inTransaction) { try { db.exec('ROLLBACK'); } catch {} }
      if (error instanceof ConfigError) throw error;
      if (error?.code?.startsWith('SQLITE_') || error?.code === 'ERR_SQLITE_ERROR') throw databaseError(error);
      throw error;
    }
  }
  return { getHead, getRevision, listHeads, listRevisions, publish: (input, validate) => change('publish', input, validate), rollback: (input, validate) => change('rollback', input, validate) };
}
