import { readFileSync } from 'node:fs';
import { resolveManagedConfig, validateResolvedConfig } from '../config/resolve.mjs';
import { ConfigError } from '../config/errors.mjs';
import { validateLiteValues } from './lite-policy.mjs';

const schema = JSON.parse(readFileSync(new URL('../../../schemas/managed-config.v1.schema.json', import.meta.url), 'utf8'));
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
const scopeValid = scope => scope === 'global' || (typeof scope === 'string' && scope.startsWith('device:') && idPattern.test(scope.slice(7)));
const empty = scope => scope === 'global' ? {schemaVersion:1, scope:'global', values:{}} : {schemaVersion:1, scope:'device', deviceId:scope.slice(7), values:{}};
function envelope(repository, scope) {
  const head = repository.getHead(scope);
  return {document:head?.document ?? empty(scope), revision:head?.revision ?? 0};
}
const fail = (code, message) => { throw new ConfigError(code, message); };
function checkScope(scope) {
  if (!scopeValid(scope)) fail('BAD_REQUEST', 'Invalid scope');
  return scope;
}
function mutation(req, scopeKey) {
  const match = req.headers['if-match'];
  if (match === undefined) fail('PRECONDITION_REQUIRED', 'If-Match is required');
  if (typeof match !== 'string' || !/^"r-(0|[1-9][0-9]*)"$/.test(match)) fail('BAD_REQUEST', 'Invalid If-Match');
  const expectedRevision = Number(match.slice(3, -1));
  const mutationId = req.headers['idempotency-key'];
  if (!Number.isSafeInteger(expectedRevision) || typeof mutationId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(mutationId)) fail('BAD_REQUEST', 'Invalid mutation headers');
  return {scopeKey, expectedRevision, mutationId, actorId:'lan-admin', reason:null};
}
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, allowed) => object(value) && Object.keys(value).every(k => allowed.includes(k));

export async function configRoute(req, pathname, url, deps, body) {
  const {repository, service, runtimeStore} = deps;
  const method = req.method;
  if (pathname === '/healthz' && method === 'GET') return {body:{status:'ok'}};
  if (pathname === '/readyz' && method === 'GET') {
    repository.listHeads();
    return {body:{status:'ok'}};
  }
  if (pathname === '/v1/admin/config/schema' && method === 'GET') return {body:schema};
  let scope;
  if (pathname === '/v1/admin/config/global') scope = 'global';
  else {
    const match = /^\/v1\/admin\/devices\/([^/]+)\/config$/.exec(pathname);
    if (match) scope = checkScope(`device:${decodeURIComponent(match[1])}`);
  }
  if (scope && method === 'GET') {
    const result = envelope(repository, scope);
    return {body:result, etag:`"r-${result.revision}"`};
  }
  if (scope && method === 'PUT') {
    const params = mutation(req, scope);
    const document = await body();
    const result = service.publish({...params, document});
    return {body:{document:result.document,revision:result.revision}, etag:`"r-${result.revision}"`};
  }
  if (pathname === '/v1/admin/config/validate' && method === 'POST') {
    const input = await body();
    if (!exact(input, ['scopeKey','document']) || !Object.hasOwn(input, 'document')) fail('BAD_REQUEST', 'Invalid request');
    const result = service.preview({scopeKey:checkScope(input.scopeKey),document:input.document});
    return {body:{valid:result.valid,issues:result.issues.map(issue => ({...issue,path:issue.code === 'unsupported_capability' ? issue.path : ''}))}};
  }
  if (pathname === '/v1/admin/config/revisions' && method === 'GET') {
    const scopeKey = checkScope(url.searchParams.get('scopeKey'));
    if ([...url.searchParams.keys()].some(k => !['scopeKey','beforeRevision','limit'].includes(k)) || [...new Set(url.searchParams.keys())].some(k => url.searchParams.getAll(k).length !== 1)) fail('BAD_REQUEST', 'Invalid query');
    const number = name => {
      const value = url.searchParams.get(name);
      if (value === null) return undefined;
      if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        fail('BAD_REQUEST','Invalid query');
      }
      return Number(value);
    };
    return {body:{revisions:repository.listRevisions(scopeKey,{beforeRevision:number('beforeRevision'),limit:number('limit')})}};
  }
  if (pathname === '/v1/admin/config/rollback' && method === 'POST') {
    const input = await body();
    if (!exact(input,['scopeKey','targetRevision','reason']) || !Number.isSafeInteger(input.targetRevision) || input.targetRevision < 1 || (input.reason !== undefined && (typeof input.reason !== 'string' || input.reason.length > 512))) fail('BAD_REQUEST','Invalid request');
    const params = mutation(req, checkScope(input.scopeKey));
    const result = service.rollback({...params,targetRevision:input.targetRevision,reason:input.reason ?? null});
    return {body:{document:result.document,revision:result.revision},etag:`"r-${result.revision}"`};
  }
  const effective = /^\/v1\/devices\/([^/]+)\/config$/.exec(pathname);
  if (effective && method === 'GET') {
    const deviceScope = checkScope(`device:${decodeURIComponent(effective[1])}`);
    const heads = repository.listHeads();
    const global = heads.find(h => h.scopeKey === 'global');
    const device = heads.find(h => h.scopeKey === deviceScope);
    const values = resolveManagedConfig(global?.document, device?.document);
    const issues = [...validateResolvedConfig(values, runtimeStore.context), ...validateLiteValues(values)];
    if (issues.length) throw new ConfigError('INVALID_CONFIG','Invalid effective configuration',{issues});
    const revisions = {global:global?.revision ?? 0, device:device?.revision ?? 0};
    const etag = `"e-${revisions.global}-${revisions.device}"`;
    if (req.headers['if-none-match']?.split(',').map(v => v.trim()).includes(etag)) return {status:304, etag};
    return {body:{values,revisions},etag};
  }
  if (pathname === '/v1/admin/secrets' && method === 'POST') {
    const input = await body();
    if (!exact(input,['value']) || typeof input.value !== 'string') fail('BAD_REQUEST','Invalid request');
    return {status:201,body:{ref:runtimeStore.addSecret(input.value),configured:true}};
  }
  if (pathname === '/v1/admin/secrets/status' && method === 'GET') return {body:{secrets:runtimeStore.secretStatus().map(({ref}) => ({ref,configured:true}))}};
  if (pathname === '/v1/admin/lan-origins' && method === 'GET') return {body:{origins:[...runtimeStore.context.allowedLanOrigins].sort()}};
  if (pathname === '/v1/admin/lan-origins' && method === 'POST') {
    const input = await body();
    if (!exact(input,['origin']) || typeof input.origin !== 'string') fail('BAD_REQUEST','Invalid request');
    runtimeStore.allowLanOrigin(input.origin);
    return {body:{origins:[...runtimeStore.context.allowedLanOrigins].sort()}};
  }
  return null;
}
