import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let server, dir, base;
test.beforeAll(async () => {
  dir=await mkdtemp(join(tmpdir(),'lampa-bridge-browser-'));
  server=spawn(process.execPath,['src/main.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:'0',RUNTIME_DIRECTORY:dir}});
  base=await new Promise((resolve,reject)=>{
    server.stdout.on('data',data=>{const match=String(data).match(/Server listening on [^:]+:(\d+)/);if(match)resolve(`http://127.0.0.1:${match[1]}`);});
    server.on('exit',code=>reject(Error(`server exited ${code}`)));
  });
});
test.afterAll(async()=>{server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));await rm(dir,{recursive:true,force:true});});

test('admin connections reach the built client and native connectors, without overwriting local settings', async ({ page }) => {
  test.setTimeout(30000);
  const diagnosticLogs=[];
  page.on('console',message=>{if(message.type()==='log') diagnosticLogs.push(message.text());});
  await page.goto(base+'/admin/');
  await expect(page.locator('#status')).toContainText('Открыта');
  await page.locator('#tmdb').fill('https://metadata.fixture');
  await page.locator('#jackett').fill('https://jackett.fixture');
  await page.locator('#jackettKey').fill('synthetic-bridge-key');
  await page.locator('#jackettEnabled').selectOption('true');
  await page.locator('#torr').fill('https://torr.fixture');
  await page.locator('#torrEnabled').selectOption('true');
  await page.locator('.primary').click();
  await expect(page.locator('#status')).toContainText('Сохранено');
  await page.addInitScript(()=>{
    localStorage.setItem('language','ru');
    localStorage.setItem('source','cub');
    localStorage.setItem('jackett_url','https://old.fixture');
    localStorage.setItem('jackett_key','old-local-key');
    localStorage.setItem('torrserver_url','https://old-torr.fixture');
  });
  const requested=[];
  await page.route('**/*',async route=>{
    const url=route.request().url();
    if(url.startsWith(base+'/'))return route.continue();
    requested.push(url);
    if(url.startsWith('https://jackett.fixture/'))return route.fulfill({json:{Results:[]},headers:{'access-control-allow-origin':'*'}});
    if(url.startsWith('https://torr.fixture/'))return route.fulfill({json:[{title:'fixture'}],headers:{'access-control-allow-origin':'*'}});
    if(url.startsWith('https://metadata.fixture/'))return route.fulfill({json:{results:[],page:1,total_pages:1},headers:{'access-control-allow-origin':'*'}});
    return route.abort();
  });
  await page.goto(base+'/app/');
  await page.waitForFunction(()=>window.Lampa?.HomeConfig?.status().state==='online');
  const id=await page.evaluate(()=>Lampa.HomeConfig.status().deviceId);
  expect(await page.evaluate(()=>Lampa.Storage.field('source'))).toBe('tmdb');
  const native=await page.evaluate(()=>({
    parser:Lampa.Storage.field('jackett_url'),key:Lampa.Storage.field('jackett_key'),
    torr:Lampa.Storage.get('torrserver_url'),local:localStorage.getItem('jackett_url'),
    metadata:Lampa.TMDB.api('search/movie?query=fixture'),image:Lampa.TMDB.image('t/p/w500/test.jpg')
  }));
  expect(native).toEqual({parser:'https://jackett.fixture',key:'synthetic-bridge-key',torr:'https://torr.fixture',local:'https://old.fixture',metadata:'https://metadata.fixture/3/search/movie?query=fixture',image:'https://metadata.fixture/image/t/p/w500/test.jpg'});
  await page.evaluate(async()=>{
    await fetch(Lampa.TMDB.api('search/movie?query=fixture'));
    await new Promise((resolve,reject)=>Lampa.Parser.get({search:'fixture',from_search:true},resolve,reject));
    await new Promise((resolve,reject)=>Lampa.Torserver.my(resolve,reject));
  });
  expect(requested.some(url=>url.startsWith('https://jackett.fixture/api/v2.0/indexers/all/results?apikey=synthetic-bridge-key'))).toBe(true);
  expect(requested.some(url=>url==='https://torr.fixture/torrents')).toBe(true);
  await page.route('https://jackett.fixture/**',route=>route.abort());
  await page.evaluate(()=>new Promise(resolve=>Lampa.Parser.get({search:'offline-fixture',from_search:true},resolve,()=>resolve())));
  expect(diagnosticLogs.join('\n')).not.toContain('synthetic-bridge-key');
  await page.waitForFunction(()=>window.appready===true);
  await page.evaluate(()=>{
    if(!Lampa.Settings.render(true).isConnected) document.body.appendChild(Lampa.Settings.render(true));
    Lampa.Settings.create('home');
  });
  await expect(page.locator('.settings__body')).toContainText('https://torr.fixture');
  await page.evaluate(()=>Lampa.Storage.set('jackett_url','https://should-not-persist.fixture'));
  expect(await page.evaluate(()=>localStorage.getItem('jackett_url'))).toBe('https://old.fixture');
  await page.evaluate(()=>{window.bridgePlaybackMarker='keep-playing';});
  const stored=await (await page.request.get(base+'/v1/admin/config/global')).json();
  stored.document.values.parser.enabled=false;
  stored.document.values.torrServer.enabled=false;
  const disabled=await page.request.put(base+'/v1/admin/config/global',{headers:{'if-match':`"r-${stored.revision}"`,'idempotency-key':'bridge-disable'},data:stored.document});
  expect(disabled.status()).toBe(200);
  await page.evaluate(()=>Lampa.HomeConfig.refresh());
  expect(await page.evaluate(()=>({parser:Lampa.Storage.field('parser_use'),torr:Lampa.Torserver.url(),marker:window.bridgePlaybackMarker})))
    .toEqual({parser:false,torr:'',marker:'keep-playing'});
  await expect(page.locator('.settings__body')).not.toContainText('https://torr.fixture');
  const disabledState=await disabled.json();
  const restored=await page.request.put(base+'/v1/admin/config/global',{headers:{'if-match':`"r-${disabledState.revision}"`,'idempotency-key':'bridge-restore'},data:stored.document={...stored.document,values:{}}});
  expect(restored.status()).toBe(200);
  await page.evaluate(()=>Lampa.HomeConfig.refresh());
  expect(await page.evaluate(()=>Lampa.Storage.field('jackett_url'))).toBe('https://old.fixture');
  const emptyState=await restored.json();
  const original={...stored.document,values:{parser:{enabled:true,endpoint:{url:'https://jackett.fixture',mode:'gateway',credentialRef:disabledState.document.values.parser.endpoint.credentialRef}},metadata:{providerId:'tmdb',endpoint:{url:'https://metadata.fixture',mode:'gateway'}}}};
  expect((await page.request.put(base+'/v1/admin/config/global',{headers:{'if-match':`"r-${emptyState.revision}"`,'idempotency-key':'bridge-reenable'},data:original})).status()).toBe(200);
  await page.evaluate(()=>Lampa.HomeConfig.refresh());
  await page.reload();
  await page.waitForFunction(()=>window.Lampa?.HomeConfig?.status().state==='online');
  expect(await page.evaluate(()=>Lampa.HomeConfig.status().deviceId)).toBe(id);
  await page.route('**/v1/devices/*/client-config',route=>route.abort());
  await page.reload();
  await page.waitForFunction(()=>window.Lampa?.HomeConfig?.status().state==='offline');
  expect(await page.evaluate(()=>Lampa.Storage.field('jackett_key'))).toBe('synthetic-bridge-key');
});
