import {test,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
async function focusReachesRefresh(page){
 return page.evaluate(()=>{
  const row=[...document.querySelectorAll('.items-line')].find(el=>el.querySelector('.ai-home-refresh'));
  const scroll=row&&row.querySelector('.scroll');
  const cards=scroll?[...scroll.querySelectorAll('.card.selector')]:[];
  const button=scroll&&scroll.querySelector('.ai-home-refresh');
  const width=el=>el.getBoundingClientRect().width;
  if(!cards.length||!button||cards.some(el=>width(el)<10)||width(button)<10) return {ok:false,cards:cards.length,button:button?width(button):0};
  Lampa.Controller.collectionSet(scroll);
  Navigator.focus(cards[0]);
  const seen=[cards[0]];
  for(let i=0;i<40 && seen[seen.length-1]!==button;i++){
   const next=Navigator.navigate(Navigator.getFocusedElement(),'right');
   if(!next) break;
   Navigator.focus(next);
   seen.push(next);
  }
  return {ok:seen.includes(cards[cards.length-1]) && seen[seen.length-1]===button,cards:cards.length,steps:seen.length};
 });
}
let server,dir,base;
test.beforeAll(async()=>{dir=await mkdtemp(join(tmpdir(),'ai-home-'));server=spawn(process.execPath,['src/main.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:'0',RUNTIME_DIRECTORY:dir}});base=await new Promise((resolve,reject)=>{server.stdout.on('data',d=>{const m=String(d).match(/Server listening on [^:]+:(\d+)/);if(m)resolve(`http://127.0.0.1:${m[1]}`)});server.on('exit',c=>reject(Error(`exit ${c}`)))});});
test.afterAll(async()=>{server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));await rm(dir,{recursive:true,force:true})});
test('native home row reads fixture cache and uploads snapshot after initialization',async({page})=>{
 test.setTimeout(45000); const snapshots=[]; let homePosts=0; let refreshed=false;
 await page.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.fulfill({json:{results:[],page:1,total_pages:1},headers:{'access-control-allow-origin':'*'}}));
 await page.route('**/v1/devices/*/recommendations/**',route=>{const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/capabilities'))return route.fulfill({json:{enabled:true,state:'ready'}});
  if(path.endsWith('/signals')){const data=route.request().postDataJSON();snapshots.push(data);return route.fulfill({json:{acceptedSeq:data.seq,profileRevision:1,skipped:0}})}
  if(path.endsWith('/home/refresh')){homePosts++;refreshed=true;return route.fulfill({status:202,json:{jobId:'job',state:'queued'}})}
  if(path.endsWith('/home'))return route.fulfill({json:{state:'ready',generatedAt:'2026-01-01T00:00:00Z',stale:false,targetCount:30,items:[{card:{id:12,source:'tmdb',media_type:'movie',title:refreshed?'Refreshed movie':'Fixture movie',release_date:'2020-01-01'},reason:refreshed?'Fresh reason':'Fixture reason',citationStatus:refreshed?'partial':'unverified',sources:[]},...(refreshed?[]:[{card:{id:13,source:'tmdb',media_type:'movie',title:'Second movie',release_date:'2019-05-01'},reason:'Second reason',citationStatus:'verified',sources:[]}])]}});
  return route.fulfill({json:{jobId:'job',state:'ready'}});
 });
 await page.addInitScript(()=>{localStorage.setItem('language','ru');localStorage.setItem('source','cub')});
 await page.goto(base+'/app/'); await page.waitForFunction(()=>window.appready===true); await expect.poll(()=>snapshots.length).toBeGreaterThan(0);
 const row=page.locator('.items-line').filter({hasText:'ИИ подборка'}).first();
 await expect(page.locator('.items-line').first()).toContainText('ИИ подборка');
 await expect(row.locator('.items-line__title')).toHaveText('ИИ подборка');
 await expect(row.locator('.ai-home-date')).toHaveText(/\d{2}\.\d{2}\.2026 \d{2}:\d{2}/);
 await expect(row.locator('.card__title').nth(0)).toHaveText('Fixture movie');
 await expect(row.locator('.card__age').nth(0)).toHaveText('2020');
 await expect(row.locator('.card__title').nth(1)).toHaveText('Second movie');
 await expect(row.locator('.ai-recommendation-reason')).toHaveCount(0);
 expect(homePosts).toBe(0); expect(snapshots[0].schemaVersion).toBe(1);
 await expect(row.locator('.scroll .ai-home-refresh')).toHaveCount(1);
 expect(await focusReachesRefresh(page)).toMatchObject({ok:true,cards:2});
 await row.locator('.ai-home-refresh').evaluate(el=>$(el).trigger('hover:focus'));
 await row.locator('.ai-home-refresh').evaluate(el=>$(el).trigger('hover:enter'));
 await expect(row).toContainText('Refreshed movie',{timeout:20000});
 await expect(row.locator('.card__title')).toHaveText('Refreshed movie');
 await expect(row.locator('.ai-recommendation-reason')).toHaveCount(0);
 expect(homePosts).toBe(1);
 expect(await focusReachesRefresh(page)).toMatchObject({ok:true,cards:1});
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
 const row=page.locator('.items-line').filter({hasText:'ИИ подборка'}).first();await expect(row).toContainText('Fixture movie');
 await row.locator('.ai-home-refresh').evaluate(el=>$(el).trigger('hover:enter'));
 await expect(page.locator('body')).toContainText('Добавьте лайки');
 expect(posts).toBe(1);expect(polls).toBe(0);
});
test('partial saved home cards show selection and last failure without generation',async({page})=>{
 test.setTimeout(30000);let posts=0;
 await page.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.fulfill({json:{results:[],page:1,total_pages:1},headers:{'access-control-allow-origin':'*'}}));
 await page.route('**/v1/devices/*/recommendations/**',route=>{const req=route.request(),path=new URL(req.url()).pathname;
  if(path.endsWith('/capabilities'))return route.fulfill({json:{enabled:true,state:'ready'}});
  if(path.endsWith('/signals'))return route.fulfill({json:{acceptedSeq:req.postDataJSON().seq}});
  if(path.endsWith('/home/refresh'))posts++;
  return route.fulfill({json:{state:'ready',stale:true,targetCount:30,selection:{requested:30,proposed:8,resolved:5,excluded:2,returned:3,unresolved:3},lastError:{code:'METADATA_TIMEOUT',stage:'metadata',message:'Каталог не ответил вовремя',action:'Попробуйте ещё раз',retryable:true},items:[{card:{id:12,source:'tmdb',media_type:'movie',title:'Saved movie',release_date:'2020-01-01'}}]}});
 });
 await page.addInitScript(()=>{localStorage.setItem('language','ru');localStorage.setItem('source','cub')});
 await page.goto(base+'/app/');await page.waitForFunction(()=>window.appready===true);await page.waitForFunction(()=>Lampa.Activity.active()?.component==='main');
 const row=page.locator('.items-line').filter({hasText:'ИИ подборка'}).first();await expect(row.locator('.card__title')).toHaveText('Saved movie');await expect(row.locator('.items-line__title')).toHaveText('ИИ подборка');await expect(row.locator('.ai-recommendation-status')).toContainText('3 из 30');await expect(row.locator('.ai-recommendation-status')).toContainText('исключено: 2');await expect(row.locator('.ai-recommendation-status')).toContainText('не найдено: 3');await expect(row.locator('.ai-recommendation-status')).toContainText('Каталог не ответил вовремя');await expect(row.locator('.ai-recommendation-status')).toContainText('METADATA_TIMEOUT');expect(posts).toBe(0);
});
test('home quota recheck offers an explicit new generation only after eligibility returns',async({page})=>{
 test.setTimeout(30000);let posts=0,gets=0;
 const failure={code:'QUOTA_EXCEEDED',stage:'prepare',message:'Лимит исчерпан',action:'Дождитесь обновления',retryable:false};
 await page.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.fulfill({json:{results:[],page:1,total_pages:1},headers:{'access-control-allow-origin':'*'}}));
 await page.route('**/v1/devices/*/recommendations/**',route=>{const req=route.request(),path=new URL(req.url()).pathname;
  if(path.endsWith('/capabilities'))return route.fulfill({json:{enabled:true,state:'ready'}});
  if(path.endsWith('/signals'))return route.fulfill({json:{acceptedSeq:req.postDataJSON().seq}});
  if(path.endsWith('/home/refresh')){posts++;return route.fulfill({json:{state:'no_likes'}})}
  if(path.endsWith('/home')){gets++;return route.fulfill({json:{state:'ready',canGenerate:gets>1,lastError:failure,items:[{card:{id:12,source:'tmdb',media_type:'movie',title:'Saved movie',release_date:'2020-01-01'}}]}})}
  return route.fulfill({json:{state:'ready'}});
 });
 await page.addInitScript(()=>{localStorage.setItem('language','ru');localStorage.setItem('source','cub')});await page.goto(base+'/app/');await page.waitForFunction(()=>window.appready===true);await page.waitForFunction(()=>Lampa.Activity.active()?.component==='main');
 const row=page.locator('.items-line').filter({hasText:'ИИ подборка'}).first();await expect(row).toContainText('Saved movie');await expect(row.locator('.ai-home-recovery')).toBeHidden();
 await row.locator('.ai-home-refresh').evaluate(el=>$(el).trigger('hover:enter'));await expect(row.locator('.ai-home-recovery')).toBeVisible();expect(posts).toBe(0);
 await row.locator('.ai-home-recovery').evaluate(el=>$(el).trigger('hover:enter'));await expect.poll(()=>posts).toBe(1);
});
test('listed movie card opens without a regional restriction screen',async({page})=>{
 test.setTimeout(30000);
 await page.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 await page.route('**/v1/devices/*/recommendations/**',route=>{const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/capabilities'))return route.fulfill({json:{enabled:false,state:'disabled'}});
  if(path.endsWith('/signals'))return route.fulfill({json:{acceptedSeq:1}});
  return route.fulfill({json:{state:'ready',items:[]}});
 });
 await page.addInitScript(()=>{localStorage.setItem('language','ru');localStorage.setItem('source','cub')});
 await page.goto(base+'/app/');await page.waitForFunction(()=>window.appready===true);await page.waitForFunction(()=>Lampa.Activity.active()?.component==='main');
 await page.evaluate(()=>{
  window.lampa_settings.lgbt={'5_movie':true};
  const movie={id:5,source:'tmdb',media_type:'movie',title:'Listed movie',original_title:'Listed movie',overview:'Open card',release_date:'2020-01-01',genres:[{name:'Drama'}],keywords:{keywords:[{name:'lgbt'}]},production_countries:[],production_companies:[],runtime:90,vote_average:7};
  Lampa.Api.full=(params,done)=>setTimeout(()=>done({movie,results:[]}),0);
  Lampa.Activity.push({component:'full',id:5,method:'movie',card:{id:5,source:'tmdb',media_type:'movie',title:'Listed movie',release_date:'2020-01-01'}});
 });
 await expect(page.locator('.full-start-new__title')).toHaveText('Listed movie');
 await expect(page.locator('body')).not.toContainText('возможно содержит ЛГБТ');
});
