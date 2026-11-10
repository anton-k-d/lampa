import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openConfigDatabase } from '../../src/config/database.mjs';
import { createConfigRepository } from '../../src/config/repository.mjs';
import { createConfigService } from '../../src/config/service.mjs';
import { createRuntimeStore } from '../../src/runtime/store.mjs';
import { createHomeServer } from '../../src/http/server.mjs';

const document = {schemaVersion:1,scope:'global',values:{ui:{theme:'dark'}}};
const headers = {'content-type':'application/json','if-match':'"r-0"','idempotency-key':'lost'};
async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(),'lampa-review-'));
  const db = openConfigDatabase(join(dir,'db'));
  const repository = createConfigRepository(db);
  const runtimeStore = createRuntimeStore(db);
  const service = createConfigService({repository,policy:runtimeStore.context});
  const server = createHomeServer({repository,service,runtimeStore,allowedHosts:['127.0.0.1'],...options});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); rmSync(dir,{recursive:true,force:true}); });
  return {base:`http://127.0.0.1:${server.address().port}`, repository};
}

test('only same-origin browser writes are accepted, even if a foreign origin is supplied in options', {timeout:5000}, async t => {
  const {base} = await fixture(t,{allowedOrigins:['http://evil.example']});
  const write = (origin,key) => fetch(base+'/v1/admin/config/global',{method:'PUT',headers:{...headers,origin,'idempotency-key':key},body:JSON.stringify(document)});
  assert.equal((await write('http://evil.example','foreign')).status,403);
  assert.equal((await write(base,'same')).status,200);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const req = request(base+'/healthz', {headers:{host:'evil.example'}}, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(foreignHostStatus,403);
});

test('secret and LAN origin actions do not disclose values or modify configuration', {timeout:5000}, async t => {
  const {base} = await fixture(t);
  const secret = 'secret-sensitive-value-123';
  const post = (path,body) => fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  let response = await post('/v1/admin/secrets',{value:secret});
  assert.equal(response.status,201);
  const text = await response.text(); assert.equal(text.includes(secret),false);
  const created = JSON.parse(text); assert.equal(created.configured,true);
  response = await fetch(base+'/v1/admin/secrets/status');
  const status = await response.text(); assert.equal(status.includes(secret),false); assert.deepEqual(JSON.parse(status),{secrets:[created]});
  response = await post('/v1/admin/lan-origins',{origin:'http://192.168.1.10:8080'});
  assert.deepEqual(await response.json(),{origins:['http://192.168.1.10:8080']});
  response = await fetch(base+'/v1/admin/config/global',{method:'PUT',headers:{...headers,'if-match':'"r-99"'},body:JSON.stringify(document)});
  assert.equal(response.status,412);
  response = await fetch(base+'/v1/admin/config/global'); assert.equal((await response.json()).revision,0);
  response = await fetch(base+'/v1/admin/lan-origins'); assert.deepEqual(await response.json(),{origins:['http://192.168.1.10:8080']});
});

test('chunked request exceeding the limit is rejected', {timeout:5000}, async t => {
  const {base} = await fixture(t);
  const status = await new Promise((resolve,reject) => {
    const req = request(base+'/v1/admin/config/global',{method:'PUT',headers},res => {res.resume(); res.on('end',() => resolve(res.statusCode));});
    req.on('error',reject); req.write('x'.repeat(131073)); req.end('x'.repeat(131073));
  });
  assert.equal(status,413);
});

test('retry after proxy drops a committed response creates one revision', {timeout:5000}, async t => {
  const {base,repository} = await fixture(t);
  const target = new URL(base);
  const proxy = createServer((req,res) => {
    const upstream = request(base+req.url,{method:req.method,headers:{...req.headers,host:target.host}},upstreamResponse => {
      upstreamResponse.resume();
      upstreamResponse.on('end',() => res.destroy());
    });
    upstream.on('error',() => res.destroy()); req.pipe(upstream);
  });
  await new Promise(resolve => proxy.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => proxy.close(resolve)));
  await assert.rejects(fetch(`http://127.0.0.1:${proxy.address().port}/v1/admin/config/global`,{method:'PUT',headers,body:JSON.stringify(document)}));
  assert.equal(repository.listRevisions('global').length,1);
  const response = await fetch(base+'/v1/admin/config/global',{method:'PUT',headers,body:JSON.stringify(document)});
  assert.equal(response.status,200); assert.equal((await response.json()).revision,repository.getHead('global').revision);
  assert.equal(repository.listRevisions('global').length,1);
});

async function launch(path) {
  const child = spawn(process.execPath,['src/main.mjs'],{cwd:new URL('../../',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATABASE_PATH:path},stdio:['ignore','pipe','pipe']});
  let output = '';
  const port = await new Promise((resolve,reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Startup timed out: ${output}`)); },2000);
    child.stdout.on('data',chunk => { output += chunk; const match = /listening on 127\.0\.0\.1:(\d+)/.exec(output); if (match) {clearTimeout(timer); resolve(Number(match[1]));} });
    child.stderr.on('data',chunk => { output += chunk; });
    child.once('exit',() => {clearTimeout(timer); reject(new Error(`Exited during startup: ${output}`));});
  });
  return {child,base:`http://127.0.0.1:${port}`};
}
async function stop(child) {
  const exited = once(child,'exit'); child.kill('SIGTERM');
  const [code,signal] = await exited; assert.equal(code,0); assert.equal(signal,null);
}
test('entrypoint closes on SIGTERM and persists configuration across restart', {timeout:10000}, async t => {
  const dir = mkdtempSync(join(tmpdir(),'lampa-main-')); const path = join(dir,'db');
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  const first = await launch(path); t.after(() => first.child.kill('SIGKILL'));
  const response = await fetch(first.base+'/v1/admin/config/global',{method:'PUT',headers,body:JSON.stringify(document)});
  assert.equal(response.status,200); const saved = await response.json(); await stop(first.child);
  const second = await launch(path); t.after(() => second.child.kill('SIGKILL'));
  const reloaded = await (await fetch(second.base+'/v1/admin/config/global')).json();
  assert.deepEqual(reloaded,saved); await stop(second.child);
});
