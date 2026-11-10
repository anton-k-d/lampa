import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetadataCatalog } from '../../src/recommendations/metadata.mjs';
import { buildCandidates } from '../../src/recommendations/candidates.mjs';

test('catalog maps proxy paths and caches normalized results', async () => {
  const calls=[];
  const catalog=createMetadataCatalog({baseUrl:'https://proxy.test/tmdb-proxy.js',fetchImpl:async url=>{ calls.push(String(url)); return new Response(JSON.stringify({results:[{id:2,title:'Film',adult:false,genre_ids:[1],secret:'discard'}]})); }});
  const args={type:'movie',id:1,category:'similar',locale:'ru-RU',page:2};
  const a=await catalog.getList(args); await catalog.getList(args);
  assert.match(calls[0],/\/3\/movie\/1\/similar\?language=ru-RU&page=2/); assert.equal(calls.length,1);
  assert.equal(a[0].key,'tmdb:movie:2'); assert.equal(a[0].secret,undefined);
});

test('candidate selection excludes viewed, started, seed and adult, preserves typed IDs and partial pools', async () => {
  const cards=[{id:1,title:'seed'},{id:2,title:'watched'},{id:3,title:'started'},{id:4,title:'adult',adult:true},{id:5,title:'ok'}];
  const catalog=createMetadataCatalog({baseUrl:'https://proxy.test',fetchImpl:async url=>{ if(String(url).includes('/similar')) throw Error('offline'); return new Response(JSON.stringify({results:cards})); }});
  const profile={records:[{key:'tmdb:movie:1',signals:['liked']},{key:'tmdb:movie:2',signals:['completed']},{key:'tmdb:movie:3',signals:['started']}]};
  const result=await buildCandidates({profile,locale:'en-US',provider:catalog});
  assert.equal(result.partial,true); assert(result.candidates.some(x=>x.key==='tmdb:movie:5')); assert(!result.candidates.some(x=>['tmdb:movie:1','tmdb:movie:2','tmdb:movie:3','tmdb:movie:4'].includes(x.key))); assert(result.candidates.some(x=>x.key==='tmdb:tv:2'));
});

test('hydrated TV cards retain native navigation fields and overlapping IDs',async()=>{
 const catalog=createMetadataCatalog({baseUrl:'https://proxy.test',fetchImpl:async url=>new Response(JSON.stringify(String(url).includes('/tv/')?{id:42,name:'Series',original_name:'Original',first_air_date:'2020-01-01'}:{id:42,title:'Film'}))});
 const cards=await catalog.hydrateCards(['tmdb:tv:42','tmdb:movie:42']);
 assert.equal(cards[0].media_type,'tv');assert.equal(cards[0].name,'Series');assert.equal(cards[0].original_name,'Original');assert.equal(cards[0].first_air_date,'2020-01-01');assert.equal(cards[1].media_type,'movie');assert.notEqual(cards[0].key,cards[1].key);
});

test('caller cancellation settles even if an injected provider ignores the signal',async()=>{
 const controller=new AbortController();const pending=buildCandidates({profile:{records:[]},provider:{getList:()=>new Promise(()=>{})},signal:controller.signal});controller.abort(new Error('cancelled'));
 await assert.rejects(Promise.race([pending,new Promise((_,reject)=>setTimeout(()=>reject(Error('hung')),100))]),/cancelled/);
});

test('catalog limits concurrent requests and expires cached results after 24 hours',async()=>{
 let active=0,peak=0,calls=0,clock=0;
 const catalog=createMetadataCatalog({baseUrl:'https://proxy.test',now:()=>clock,fetchImpl:async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;return new Response(JSON.stringify({results:[]}));}});
 await Promise.all(Array.from({length:8},(_,i)=>catalog.getList({type:'movie',category:'discover',page:i+1})));
 assert.equal(peak,3);await catalog.getList({type:'movie',category:'discover',page:1});assert.equal(calls,8);clock=86400001;await catalog.getList({type:'movie',category:'discover',page:1});assert.equal(calls,9);
});

test('deadline preserves hydrated seeds and successful lists when one list stalls',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const profile={records:[{key:'tmdb:movie:1',signals:['liked']}]};
 const provider={getList:({category})=>category==='similar'?new Promise(()=>{}):Promise.resolve([{key:'tmdb:movie:2',id:2,title:'good'}]),hydrateCards:async()=>[{key:'tmdb:movie:1',title:'Seed'}]};
 const pending=buildCandidates({profile,provider});await Promise.resolve();await Promise.resolve();t.mock.timers.tick(20000);const result=await pending;
 assert.equal(result.partial,true);assert.equal(result.seeds[0]?.key,'tmdb:movie:1');assert(result.candidates.some(c=>c.key==='tmdb:movie:2'));
});

test('full seed result lists leave space for discover results',async()=>{
 const profile={records:Array.from({length:8},(_,i)=>({key:`tmdb:movie:${i+1}`,signals:['liked']}))};
 const provider={getList:async({category,id,type})=>Array.from({length:20},(_,i)=>({key:`tmdb:${type}:${category==='discover'?9000+i:100+id*100+(category==='similar'?50:0)+i}`,id:i,title:category})),hydrateCards:async()=>[]};
 const result=await buildCandidates({profile,provider});assert.equal(result.candidates.length,120);assert(result.candidates.some(c=>c.title==='discover'));assert(result.candidates.some(c=>c.key.startsWith('tmdb:tv:')));
});
