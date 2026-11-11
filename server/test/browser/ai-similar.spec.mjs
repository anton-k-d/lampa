import {test,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
let server,dir,base;
test.beforeAll(async()=>{dir=await mkdtemp(join(tmpdir(),'ai-similar-'));server=spawn(process.execPath,['src/main.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:'0',RUNTIME_DIRECTORY:dir}});base=await new Promise((resolve,reject)=>{server.stdout.on('data',d=>{const m=String(d).match(/Server listening on [^:]+:(\d+)/);if(m)resolve(`http://127.0.0.1:${m[1]}`)});server.on('exit',c=>reject(Error(`exit ${c}`)))});});
test.afterAll(async()=>{server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));await rm(dir,{recursive:true,force:true})});
test('same-title cache renders ordinary cards and escaped reason without generation',async({page})=>{
 test.setTimeout(30000);let posts=0;
 await page.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 await page.route('**/v1/devices/*/recommendations/**',route=>{const req=route.request(), path=new URL(req.url()).pathname;
  if(path.endsWith('/capabilities'))return route.fulfill({json:{enabled:true,state:'ready'}});
  if(path.endsWith('/signals'))return route.fulfill({json:{acceptedSeq:req.postDataJSON().seq,profileRevision:1,skipped:0}});
  if(path.endsWith('/similar')){if(req.method()==='POST')posts++;return route.fulfill({json:{state:'ready',items:[{card:{id:33,source:'tmdb',media_type:'tv',name:'Fixture show',original_name:'Fixture show',first_air_date:'2020-01-01'},reason:'<img src=x onerror=alert(1)>',citationStatus:'unverified',sources:[]}]}})}
  return route.fulfill({json:{state:'ready'}});
 });
 await page.addInitScript(()=>{localStorage.setItem('language','ru');localStorage.setItem('source','cub')});
 await page.goto(base+'/app/');await page.waitForFunction(()=>window.appready===true);await page.waitForFunction(()=>Lampa.Activity.active()?.component==='main');await page.waitForTimeout(500);
 await page.evaluate(()=>{
   Lampa.Api.full=(params,done)=>setTimeout(()=>done({movie:{id:22,source:'tmdb',media_type:'movie',title:'Seed',original_title:'Seed',release_date:'2020-01-01',genres:[],production_countries:[],production_companies:[],runtime:90,vote_average:7},results:[]}),0);
   Lampa.Activity.push({component:'full',id:22,method:'movie',card:{id:22,source:'tmdb',media_type:'movie',title:'Seed',release_date:'2020-01-01'}});
 });
 await expect(page.locator('.button--home-ai')).toBeVisible();
 const icon=page.locator('.button--home-ai svg');await expect(icon).toHaveCount(1);const iconBox=await icon.boundingBox();expect(iconBox?.width).toBeGreaterThan(0);expect(iconBox?.height).toBeGreaterThan(0);
 await page.locator('.button--home-ai').evaluate(el=>$(el).trigger('hover:enter'));
 await expect(page.locator('.ai-recommendation-reason:not(.ai-recommendation-source-status)')).toHaveText('<img src=x onerror=alert(1)>');expect(await page.locator('.ai-recommendation-reason img').count()).toBe(0);await expect(page.locator('.ai-recommendation-source-status')).toHaveText('Источники не подтверждены');expect(posts).toBe(0);
});
test('leaving while the cache request is pending does not start generation',async({page})=>{
 test.setTimeout(30000);let posts=0, release;
 const pending=new Promise(resolve=>{release=resolve});
 await page.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 await page.route('**/v1/devices/*/recommendations/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path.endsWith('/capabilities'))return route.fulfill({json:{enabled:true,state:'ready'}});
  if(path.endsWith('/signals'))return route.fulfill({json:{acceptedSeq:req.postDataJSON().seq}});
  if(path.endsWith('/similar') && req.method()==='GET'){await pending;return route.fulfill({json:{state:'empty',items:[]}}).catch(()=>{});}
  if(path.endsWith('/similar') && req.method()==='POST')posts++;
  return route.fulfill({json:{state:'ready'}});
 });
 await page.addInitScript(()=>{localStorage.setItem('language','ru');localStorage.setItem('source','cub')});
 await page.goto(base+'/app/');await page.waitForFunction(()=>window.appready===true);await page.waitForFunction(()=>Lampa.Activity.active()?.component==='main');
 await page.evaluate(()=>{
  Lampa.Api.full=(params,done)=>setTimeout(()=>done({movie:{id:22,source:'tmdb',media_type:'movie',title:'Seed',original_title:'Seed',release_date:'2020-01-01',genres:[],production_countries:[],production_companies:[],runtime:90,vote_average:7},results:[]}),0);
  Lampa.Activity.push({component:'full',id:22,method:'movie',card:{id:22,source:'tmdb',media_type:'movie',title:'Seed',release_date:'2020-01-01'}});
 });
 await expect(page.locator('.button--home-ai')).toBeVisible();
 const get=page.waitForRequest(req=>req.url().includes('/similar?'));
 await page.locator('.button--home-ai').evaluate(el=>$(el).trigger('hover:enter'));await get;
 await page.evaluate(()=>Lampa.Activity.backward());release();
 await expect(page.locator('.button--home-ai')).toBeVisible();
 await page.waitForTimeout(500);expect(posts).toBe(0);
});
for (const scenario of ['stale','running']) test(`explicit similar action handles ${scenario} cache`,async({page})=>{
 test.setTimeout(40000); let posts=0, polls=0;
 await page.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 await page.route('**/v1/devices/*/recommendations/**',route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path.endsWith('/capabilities'))return route.fulfill({json:{enabled:true,state:'ready'}});
  if(path.endsWith('/signals'))return route.fulfill({json:{acceptedSeq:req.postDataJSON().seq}});
  if(path.includes('/jobs/')){polls++;return route.fulfill({json:{jobId:'job',state:'ready'}})}
  if(path.endsWith('/similar')&&req.method()==='POST'){posts++;return route.fulfill({json:{jobId:'job',state:'queued'}})}
  if(path.endsWith('/similar'))return route.fulfill({json:polls?{state:'ready',items:[{card:{id:33,source:'tmdb',media_type:'tv',name:'Fresh result',first_air_date:'2020-01-01'},reason:'Fresh reason'}]}:scenario==='stale'?{state:'ready',stale:true,items:[]}:{state:'running',jobId:'job',items:[]}});
  return route.fulfill({json:{state:'ready'}});
 });
 await page.addInitScript(()=>{localStorage.setItem('language','ru');localStorage.setItem('source','cub')});
 await page.goto(base+'/app/'); await page.waitForFunction(()=>window.appready===true);await page.waitForFunction(()=>Lampa.Activity.active()?.component==='main');
 await page.evaluate(()=>{Lampa.Api.full=(params,done)=>setTimeout(()=>done({movie:{id:22,source:'tmdb',media_type:'movie',title:'Seed',original_title:'Seed',release_date:'2020-01-01',genres:[],production_countries:[],production_companies:[],runtime:90,vote_average:7},results:[]}),0);Lampa.Activity.push({component:'full',id:22,method:'movie',card:{id:22,source:'tmdb',media_type:'movie',title:'Seed',release_date:'2020-01-01'}})});
 await expect(page.locator('.button--home-ai')).toBeVisible(); await page.locator('.button--home-ai').evaluate(el=>$(el).trigger('hover:enter'));
 await expect(page.locator('.ai-recommendation-reason')).toHaveText('Fresh reason',{timeout:10000});expect(polls).toBeGreaterThan(0);expect(posts).toBe(scenario==='stale'?1:0);
});
for (const failure of [
 {code:'METADATA_TIMEOUT',stage:'metadata',message:'Каталог не ответил вовремя',action:'Попробуйте ещё раз',retryable:true},
 {code:'QUOTA_EXCEEDED',stage:'prepare',message:'Лимит исчерпан',action:'Проверьте лимит',retryable:false}
]) test(`failed cache explains ${failure.code} without generating`,async({page})=>{
 test.setTimeout(30000);let posts=0,gets=0;
 await page.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 await page.route('**/v1/devices/*/recommendations/**',route=>{const req=route.request(),path=new URL(req.url()).pathname;
  if(path.endsWith('/capabilities'))return route.fulfill({json:{enabled:true,state:'ready'}});
  if(path.endsWith('/signals'))return route.fulfill({json:{acceptedSeq:req.postDataJSON().seq}});
  if(path.endsWith('/similar')){if(req.method()==='POST')posts++;else gets++;return route.fulfill({json:gets>1?{state:'empty',items:[]}:{state:'failed',lastError:failure,items:[]}})}
  return route.fulfill({json:{state:'ready'}});
 });
 await page.addInitScript(()=>{localStorage.setItem('language','ru');localStorage.setItem('source','cub')});
 await page.goto(base+'/app/');await page.waitForFunction(()=>window.appready===true);await page.waitForFunction(()=>Lampa.Activity.active()?.component==='main');
 await page.evaluate(()=>{Lampa.Api.full=(params,done)=>setTimeout(()=>done({movie:{id:22,source:'tmdb',media_type:'movie',title:'Seed',release_date:'2020-01-01',genres:[],production_countries:[],production_companies:[],runtime:90,vote_average:7},results:[]}),0);Lampa.Activity.push({component:'full',id:22,method:'movie',card:{id:22,source:'tmdb',media_type:'movie',title:'Seed',release_date:'2020-01-01'}})});
 await expect(page.locator('.button--home-ai')).toBeVisible();await page.locator('.button--home-ai').evaluate(el=>$(el).trigger('hover:enter'));
 const status=page.locator('.ai-recommendation-status');await expect(status).toContainText(failure.message);await expect(status).toContainText(failure.action);await expect(status).toContainText(failure.code);expect(posts).toBe(0);
 if(failure.retryable) await expect(status.locator('.selector')).toContainText('Повторить');
 else {await expect(status.locator('.selector')).toContainText('Проверить снова');await status.locator('.selector').evaluate(el=>$(el).trigger('hover:enter'));await expect(status).toContainText('Подборка пока пуста');expect(gets).toBe(2);expect(posts).toBe(0)}
});
for (const code of ['QUOTA_EXCEEDED','PROVIDER_AUTH']) test(`${code} recovery requires recheck and explicit generation`,async({page})=>{
 test.setTimeout(30000);let posts=0,gets=0;
 const failure={code,stage:'prepare',message:'Причина ошибки',action:'Исправьте настройки',retryable:false};
 await page.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 await page.route('**/v1/devices/*/recommendations/**',route=>{const req=route.request(),path=new URL(req.url()).pathname;
  if(path.endsWith('/capabilities'))return route.fulfill({json:{enabled:true,state:'ready'}});
  if(path.endsWith('/signals'))return route.fulfill({json:{acceptedSeq:req.postDataJSON().seq}});
  if(path.endsWith('/similar')){if(req.method()==='POST'){posts++;return route.fulfill({json:{state:'no_likes'}})}gets++;return route.fulfill({json:{state:'failed',lastError:failure,canGenerate:gets>1,items:[]}})}
  return route.fulfill({json:{state:'ready'}});
 });
 await page.addInitScript(()=>{localStorage.setItem('language','ru');localStorage.setItem('source','cub')});await page.goto(base+'/app/');await page.waitForFunction(()=>window.appready===true);await page.waitForFunction(()=>Lampa.Activity.active()?.component==='main');
 await page.evaluate(()=>{Lampa.Api.full=(params,done)=>setTimeout(()=>done({movie:{id:22,source:'tmdb',media_type:'movie',title:'Seed',release_date:'2020-01-01',genres:[],production_countries:[],production_companies:[],runtime:90,vote_average:7},results:[]}),0);Lampa.Activity.push({component:'full',id:22,method:'movie',card:{id:22,source:'tmdb',media_type:'movie',title:'Seed',release_date:'2020-01-01'}})});
 await expect(page.locator('.button--home-ai')).toBeVisible();await page.locator('.button--home-ai').evaluate(el=>$(el).trigger('hover:enter'));
 const status=page.locator('.ai-recommendation-status');await expect(status).toContainText('Проверить снова');await expect(status).not.toContainText('Создать заново');
 await status.locator('.selector').filter({hasText:'Проверить снова'}).evaluate(el=>$(el).trigger('hover:enter'));await expect(status).toContainText('Создать заново');expect(posts).toBe(0);
 await status.locator('.selector').filter({hasText:'Создать заново'}).evaluate(el=>$(el).trigger('hover:enter'));await expect.poll(()=>posts).toBe(1);
});
test('terminal recheck after a polling network failure permits an explicit retry',async({page})=>{
 test.setTimeout(30000);let posts=0,gets=0;
 const failure={code:'METADATA_TIMEOUT',stage:'metadata',message:'Каталог не ответил',action:'Попробуйте ещё раз',retryable:true};
 await page.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 await page.route('**/v1/devices/*/recommendations/**',route=>{const req=route.request(),path=new URL(req.url()).pathname;
  if(path.endsWith('/capabilities'))return route.fulfill({json:{enabled:true,state:'ready'}});
  if(path.endsWith('/signals'))return route.fulfill({json:{acceptedSeq:req.postDataJSON().seq}});
  if(path.includes('/jobs/'))return route.abort();
  if(path.endsWith('/similar')){if(req.method()==='POST'){posts++;return route.fulfill({json:{state:'no_likes'}})}gets++;return route.fulfill({json:gets===1?{state:'running',jobId:'pending-job',items:[]}:{state:'failed',lastError:failure,canGenerate:true,items:[]}})}
  return route.fulfill({json:{state:'ready'}});
 });
 await page.addInitScript(()=>{localStorage.setItem('language','ru');localStorage.setItem('source','cub')});await page.goto(base+'/app/');await page.waitForFunction(()=>window.appready===true);await page.waitForFunction(()=>Lampa.Activity.active()?.component==='main');
 await page.evaluate(()=>{Lampa.Api.full=(params,done)=>setTimeout(()=>done({movie:{id:22,source:'tmdb',media_type:'movie',title:'Seed',release_date:'2020-01-01',genres:[],production_countries:[],production_companies:[],runtime:90,vote_average:7},results:[]}),0);Lampa.Activity.push({component:'full',id:22,method:'movie',card:{id:22,source:'tmdb',media_type:'movie',title:'Seed',release_date:'2020-01-01'}})});
 await expect(page.locator('.button--home-ai')).toBeVisible();await page.locator('.button--home-ai').evaluate(el=>$(el).trigger('hover:enter'));
 const status=page.locator('.ai-recommendation-status');await expect(status).toContainText('Проверить снова',{timeout:10000});await status.locator('.selector').evaluate(el=>$(el).trigger('hover:enter'));await expect(status).toContainText('Каталог не ответил');expect(posts).toBe(0);
 await status.locator('.selector').evaluate(el=>$(el).trigger('hover:enter'));await expect.poll(()=>posts).toBe(1);
});
test('legacy stale cards remain visible until explicit refresh creates ten',async({page})=>{
 test.setTimeout(30000);let posts=0,ready=false;
 const cards=count=>Array.from({length:count},(_,i)=>({card:{id:i+30,source:'tmdb',media_type:'movie',title:'Result '+i,release_date:'2020-01-01'}}));
 await page.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 await page.route('**/v1/devices/*/recommendations/**',route=>{const req=route.request(),path=new URL(req.url()).pathname;
  if(path.endsWith('/capabilities'))return route.fulfill({json:{enabled:true,state:'ready'}});
  if(path.endsWith('/signals'))return route.fulfill({json:{acceptedSeq:req.postDataJSON().seq}});
  if(path.includes('/jobs/')){ready=true;return route.fulfill({json:{state:'ready',jobId:'new-job'}})}
  if(path.endsWith('/similar')){if(req.method()==='POST'){posts++;return route.fulfill({json:{state:'queued',jobId:'new-job'}})}return route.fulfill({json:ready?{state:'ready',items:cards(10)}:{state:'ready',stale:true,canGenerate:true,selection:null,lastError:null,items:cards(5)}})}
  return route.fulfill({json:{state:'ready'}});
 });
 await page.addInitScript(()=>{localStorage.setItem('language','ru');localStorage.setItem('source','cub')});await page.goto(base+'/app/');await page.waitForFunction(()=>window.appready===true);await page.waitForFunction(()=>Lampa.Activity.active()?.component==='main');
 await page.evaluate(()=>{Lampa.Api.full=(params,done)=>setTimeout(()=>done({movie:{id:22,source:'tmdb',media_type:'movie',title:'Seed',release_date:'2020-01-01',genres:[],production_countries:[],production_companies:[],runtime:90,vote_average:7},results:[]}),0);Lampa.Activity.push({component:'full',id:22,method:'movie',card:{id:22,source:'tmdb',media_type:'movie',title:'Seed',release_date:'2020-01-01'}})});
 await expect(page.locator('.button--home-ai')).toBeVisible();await page.locator('.button--home-ai').evaluate(el=>$(el).trigger('hover:enter'));
 const status=page.locator('.ai-recommendation-status');await expect(status).toContainText('Обновить');expect(posts).toBe(0);await expect(page.locator('.card')).toHaveCount(5);
 await status.locator('.selector').filter({hasText:'Обновить'}).evaluate(el=>$(el).trigger('hover:enter'));await expect.poll(()=>posts).toBe(1);await expect(page.locator('.card')).toHaveCount(10,{timeout:10000});
});
