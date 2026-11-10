import { test } from 'node:test';
import { request } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHomeServer } from '../../src/http/server.mjs';

async function fixture(t, built = true) {
  const root = mkdtempSync(join(tmpdir(), 'lampa-msx-'));
  if (built) { mkdirSync(join(root, 'msx')); writeFileSync(join(root, 'index.html'), '<script src="app.js"></script>'); writeFileSync(join(root, 'app.js'), 'local'); writeFileSync(join(root, 'msx/start.json'), '{PREFIX}{domain}'); }
  const server = createHomeServer({clientRoot:root, allowedHosts:['127.0.0.1']});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(root,{recursive:true,force:true}); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('MSX launcher uses validated local host and serves local app', async t => {
  const base = await fixture(t);
  const response = await fetch(base+'/msx/start.json', {headers:{origin:'http://msx.example','x-forwarded-host':'evil.example'}});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('access-control-allow-origin'),'*');
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{name:'Lampa',version:'latest',parameter:`content:${base}/msx/start.json`,action:`link:${base}/app/`});
  const head = await fetch(base+'/msx/start.json',{method:'HEAD'});
  assert.equal(head.status,200); assert.equal(await head.text(),'');
  assert.equal(await (await fetch(base+'/app/app.js')).text(),'local');
  assert.ok(!(await (await fetch(base+'/app/msx/start.json')).text()).includes('{PREFIX}'));
  assert.equal((await fetch(base+'/v1/admin/config/global',{headers:{origin:'http://msx.example'}})).headers.get('access-control-allow-origin'),null);
  const invalid = await new Promise((resolve, reject) => { const req = request(base+'/msx/start.json',{headers:{host:'evil.example'}},res => { res.resume(); res.on('end',() => resolve(res)); }); req.on('error',reject); req.end(); });
  assert.equal(invalid.statusCode,403); assert.equal(invalid.headers['access-control-allow-origin'],undefined);
});

test('MSX launcher reports missing build', async t => {
  const base = await fixture(t,false);
  const response = await fetch(base+'/msx/start.json');
  assert.equal(response.status,503); assert.match(await response.text(),/build/i);
});
