import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigError } from '../config/errors.mjs';
import { configRoute, safeIssuePath } from './config-routes.mjs';
import { serveStatic } from './static.mjs';
import { recommendationRoute } from './recommendation-routes.mjs';
import { aiAdminRoute } from './ai-admin-routes.mjs';

const limit = 262144;
const statusCodes = {BAD_REQUEST:400, INVALID_CONFIG:422, UNSUPPORTED_CAPABILITY:422, REVISION_CONFLICT:412, PRECONDITION_REQUIRED:428, IDEMPOTENCY_MISMATCH:409, NOT_FOUND:404, BUSY:503, TOO_LARGE:413, FORBIDDEN:403, QUOTA_EXCEEDED:429};
function hostAllowed(header, allowedHosts) {
  if (typeof header !== 'string' || !header || /[\s/@,\\]/.test(header)) return false;
  try {
    const url = new URL(`http://${header}`);
    return url.host === header.toLowerCase() && allowedHosts.has(url.hostname.toLowerCase());
  } catch { return false; }
}
async function readBody(req, maxBytes = limit) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) throw new ConfigError('BAD_REQUEST','Expected JSON content type');
  const declared = req.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new ConfigError('TOO_LARGE','Request body too large');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) { req.resume(); throw new ConfigError('TOO_LARGE','Request body too large'); }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ConfigError('BAD_REQUEST','Invalid JSON'); }
}
function safeIssues(issues) {
  return issues?.map(issue => ({path:safeIssuePath(issue),code:issue.code,message:issue.message}));
}
export function createHomeServer({repository, service, runtimeStore, adminRoot, clientRoot, allowedHosts = ['127.0.0.1','localhost'], recommendationRepository, recommendationService, aiSettings, db}) {
  const hosts = new Set([...allowedHosts].map(host => host.toLowerCase()));
  const server = createServer(async (req, res) => {
    const requestId = randomUUID();
    try {
      if (!hostAllowed(req.headers.host, hosts)) throw new ConfigError('FORBIDDEN','Host is not allowed');
      const origin = req.headers.origin;
      if (origin && !['GET','HEAD'].includes(req.method)) {
        const sameOrigin = origin === `http://${req.headers.host}`;
        if (!sameOrigin) throw new ConfigError('FORBIDDEN','Origin is not allowed');
      }
      const rawPath = (req.url ?? '').split('?')[0];
      const url = new URL(req.url, 'http://local.invalid');
      if (['/msx/start.json','/app/msx/start.json'].includes(rawPath) && ['GET','HEAD'].includes(req.method)) {
        let available = false;
        try { available = !!clientRoot && (await stat(join(clientRoot, 'index.html'))).isFile(); } catch {}
        const base = `http://${req.headers.host}`;
        const data = JSON.stringify(available
          ? {name:'Lampa',version:'latest',parameter:`content:${base}/msx/start.json`,action:`link:${base}/app/`}
          : {code:'BUILD_MISSING',message:'WEB build missing; run npm run build:web'});
        res.writeHead(available ? 200 : 503, {'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(data),'cache-control':'no-store','access-control-allow-origin':'*','x-content-type-options':'nosniff'});
        res.end(req.method === 'HEAD' ? undefined : data);
        return;
      }
      if (rawPath === '/' && ['GET','HEAD'].includes(req.method)) {
        res.writeHead(302, {location:'/admin/'});
        res.end();
        return;
      }
      if ((rawPath.startsWith('/admin/') && await serveStatic(req,res,rawPath,adminRoot,'/admin/')) || (rawPath.startsWith('/app/') && await serveStatic(req,res,rawPath,clientRoot,'/app/'))) return;
      const result = (recommendationService && await recommendationRoute(req,rawPath,url,{recommendationRepository,recommendationService,aiSettings},()=>readBody(req, rawPath.endsWith('/signals') ? 192 * 1024 : limit))) || (aiSettings && await aiAdminRoute(req,rawPath,{aiSettings,db,recommendationService},()=>readBody(req))) || await configRoute(req, rawPath, url, {repository,service,runtimeStore}, () => readBody(req));
      if (!result) throw new ConfigError('NOT_FOUND','Resource not found');
      const headers = {'cache-control':'no-store', 'x-content-type-options':'nosniff'};
      if (result.etag) headers.etag = result.etag;
      if (result.status === 304) {
        res.writeHead(304,headers);
        res.end();
        return;
      }
      const data = JSON.stringify(result.body);
      res.writeHead(result.status ?? 200, {...headers,'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(data)});
      res.end(data);
    } catch (error) {
      let code = error instanceof ConfigError ? error.code : 'BAD_REQUEST';
      if (error?.issues?.some(issue => issue.code === 'unsupported_capability')) code = 'UNSUPPORTED_CAPABILITY';
      const payload = {code,message:code === 'UNSUPPORTED_CAPABILITY' ? 'Capability is not supported by Lite' : error instanceof ConfigError ? error.message : 'Invalid request',requestId};
      if (error?.issues) payload.issues = safeIssues(error.issues);
      if (error?.currentRevision !== undefined) payload.currentRevision = error.currentRevision;
      if (!res.headersSent) {
        res.writeHead(statusCodes[code] ?? 400, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
        res.end(JSON.stringify(payload));
      } else {
        res.destroy();
      }
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}
