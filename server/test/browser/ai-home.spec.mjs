import {test,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
let server,dir,base;
test.beforeAll(async()=>{dir=await mkdtemp(join(tmpdir(),'ai-home-'));server=spawn(process.execPath,['src/main.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:'0',RUNTIME_DIRECTORY:dir}});base=await new Promise((resolve,reject)=>{server.stdout.on('data',d=>{const m=String(d).match(/Server listening on [^:]+:(\d+)/);if(m)resolve(`http://127.0.0.1:${m[1]}`)});server.on('exit',c=>reject(Error(`exit ${c}`)))});});
test.afterAll(async()=>{server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));await rm(dir,{recursive:true,force:true})});
test('native home row reads fixture cache and uploads snapshot after initialization',async({page})=>{
 test.setTimeout(30000); const snapshots=[]; let homePosts=0; let refreshed=false;
 await page.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.fulfill({json:{results:[],page:1,total_pages:1},headers:{'access-control-allow-origin':'*'}}));
 await page.route('**/v1/devices/*/recommendations/**',route=>{const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/capabilities'))return route.fulfill({json:{enabled:true,state:'ready'}});
  if(path.endsWith('/signals')){const data=route.request().postDataJSON();snapshots.push(data);return route.fulfill({json:{acceptedSeq:data.seq,profileRevision:1,skipped:0}})}
  if(path.endsWith('/home/refresh')){homePosts++;refreshed=true;return route.fulfill({status:202,json:{jobId:'job',state:'queued'}})}
  if(path.endsWith('/home'))return route.fulfill({json:{state:'ready',generatedAt:'2026-01-01T00:00:00Z',stale:false,items:[{card:{id:12,source:'tmdb',media_type:'movie',title:refreshed?'Refreshed movie':'Fixture movie',release_date:'2020-01-01'},reason:refreshed?'Fresh reason':'Fixture reason',citationStatus:refreshed?'partial':'unverified',sources:[]}]}});
  return route.fulfill({json:{jobId:'job',state:'ready'}});
 });
 await page.addInitScript(()=>{localStorage.setItem('language','ru');localStorage.setItem('source','cub')});
 await page.goto(base+'/app/'); await page.waitForFunction(()=>window.appready===true); await expect.poll(()=>snapshots.length).toBeGreaterThan(0);
 const row=page.locator('.items-line').filter({hasText:'Для тебя'}).first();
 await expect(row).toContainText('Fixture movie');
 await expect(row).toContainText('Fixture reason');
 await expect(row.locator('.ai-recommendation-source-status')).toHaveText('Источники не подтверждены');
 await expect(row.locator('.items-line__title')).toContainText('2026');
 expect(homePosts).toBe(0); expect(snapshots[0].schemaVersion).toBe(1);
 await expect(row.locator('.scroll .ai-home-refresh')).toHaveCount(1);
 await row.locator('.ai-home-refresh').evaluate(el=>$(el).trigger('hover:focus'));
 await row.locator('.ai-home-refresh').evaluate(el=>$(el).trigger('hover:enter'));
 await expect(row).toContainText('Refreshed movie',{timeout:10000});
 await expect(row).toContainText('Fresh reason');
 await expect(row.locator('.ai-recommendation-source-status')).toHaveText('Часть ссылок не подтверждена');
 expect(homePosts).toBe(1);
 await page.evaluate(()=>{if(!Lampa.Settings.render(true).isConnected) document.body.appendChild(Lampa.Settings.render(true));Lampa.Settings.create('ai_home')});
 await expect(page.locator('.settings__body')).toContainText('Обновить подборку');
});
test('home refresh explains missing likes without polling a job',async({page})=>{
 test.setTimeout(30000);let polls=0,posts=0;
 await page.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.fulfill({json:{results:[],page:1,total_pages:1},headers:{'access-control-allow-origin':'*'}}));
 await page.route('**/v1/devices/*/recommendations/**',route=>{const req=route.request(),path=new URL(req.url()).pathname;
  if(path.endsWith('/capabilities'))return route.fulfill({json:{enabled:true,state:'ready'}});
  if(path.endsWith('/signals'))return route.fulfill({json:{acceptedSeq:req.postDataJSON().seq}});
  if(path.endsWith('/home/refresh')){posts++;return route.fulfill({json:{state:'no_likes'}})}
  if(path.includes('/jobs/')){polls++;return route.fulfill({json:{state:'failed'}})}
  return route.fulfill({json:{state:'ready',items:[{card:{id:12,source:'tmdb',media_type:'movie',title:'Fixture movie',release_date:'2020-01-01'}}]}});
 });
 await page.addInitScript(()=>{localStorage.setItem('language','ru');localStorage.setItem('source','cub')});
 await page.goto(base+'/app/');await page.waitForFunction(()=>window.appready===true);
 const row=page.locator('.items-line').filter({hasText:'Для тебя'}).first();await expect(row).toContainText('Fixture movie');
 await row.locator('.ai-home-refresh').evaluate(el=>$(el).trigger('hover:enter'));
 await expect(page.locator('body')).toContainText('Добавьте лайки');
 expect(posts).toBe(1);expect(polls).toBe(0);
});
