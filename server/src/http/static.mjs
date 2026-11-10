import { realpath, stat, readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.woff2':'font/woff2' };
export async function serveStatic(req, res, pathname, root, prefix) {
  if (!root || !['GET', 'HEAD'].includes(req.method)) return false;
  try {
    const raw = pathname.slice(prefix.length);
    const decoded = decodeURIComponent(raw);
    if (decoded.includes('\\') || decoded.split('/').some(part => part === '..' || part === '.')) return false;
    const base = await realpath(root);
    const candidate = await realpath(resolve(base, decoded || 'index.html'));
    if (!candidate.startsWith(base + sep) || !(await stat(candidate)).isFile()) return false;
    const content = await readFile(candidate);
    res.writeHead(200, { 'content-type': types[extname(candidate)] || 'application/octet-stream', 'content-length': content.length, 'x-content-type-options':'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : content);
    return true;
  } catch { return false; }
}
