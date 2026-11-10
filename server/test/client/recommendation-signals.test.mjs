import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSignals } from '../../../src/core/home/recommendations/signals.mjs';
import { normalizeCard } from '../../src/recommendations/metadata.mjs';

test('syncs catalog TV likes and views separately from a movie with the same ID', async () => {
 const tv=normalizeCard({id:42,name:'Show',original_name:'Show',first_air_date:'2020-01-01'},'tv');
 const movie=normalizeCard({id:42,title:'Film',original_title:'Film',release_date:'2020-01-01'},'movie');
 assert.equal(tv.original_title,'Show'); assert.equal(tv.release_date,'2020-01-01');
 const result=await normalizeSignals({favorites:{like:[tv,movie],viewed:[tv]}});
 assert.deepEqual(result.records.map(r=>[r.key,r.signals]),[['tmdb:movie:42',['liked']],['tmdb:tv:42',['completed','liked']]]);
 assert.equal(result.skipped,0);
});

test('normalizes native favorites and episode-aware progress without leaking card data', async () => {
  const movie={id:42,original_title:'film',source:'tmdb',url:'secret'};
  const tv={id:42,original_name:'show',source:'tmdb'};
  const input={favorites:{history:[movie,tv],like:[movie],book:[tv],viewed:[{id:9,original_title:'seen'}],like_extra:[],wath:[{id:7,original_title:'cub',source:'cub'}]},timeline:{a:{card:'movie_42',source:'tmdb',percent:90,updated:1700000000000},b:{card:'tv_42',source:'tmdb',season:1,episode:1,percent:99,updated:1700000000000},c:{percent:75}}};
  const a=await normalizeSignals(input);
  assert.deepEqual(a.records.map(r=>[r.key,r.signals]),[['tmdb:movie:42',['completed','history','liked','started']],['tmdb:movie:9',['completed']],['tmdb:tv:42',['bookmarked','history','started']]]);
  assert.equal(a.skipped,2); assert.equal(a.records[0].lastActivityAt,'2023-11-14T22:13:20.000Z');
  assert.equal(JSON.stringify(a).includes('secret'),false);
  assert.equal((await normalizeSignals({...input,uploadTime:123})).digest,a.digest);
});

test('history alone is not completion and deleting a favorite removes its signal', async () => {
 const card={id:1,original_title:'x'};
 const first=await normalizeSignals({favorites:{history:[card],like:[card]},timeline:{}});
 const second=await normalizeSignals({favorites:{history:[card]},timeline:{}});
 assert.deepEqual(second.records[0].signals,['history']); assert.notEqual(first.digest,second.digest);
});

test('digest works without Web Crypto on plain HTTP', async () => {
 const saved=globalThis.crypto; Object.defineProperty(globalThis,'crypto',{value:undefined,configurable:true});
 try { assert.equal((await normalizeSignals({favorites:{},timeline:{}})).digest,'4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'); }
 finally { Object.defineProperty(globalThis,'crypto',{value:saved,configurable:true}); }
});

test('normalizer digest agrees with server SHA-256 for longer snapshots', async () => {
 const {createHash}=await import('node:crypto');
 const history=Array.from({length:35},(_,i)=>({id:i+1,original_title:'film'}));
 const result=await normalizeSignals({favorites:{history},timeline:{}});
 assert.equal(result.digest,createHash('sha256').update(JSON.stringify(result.records)).digest('hex'));
});

test('does not infer TMDB for an orphan timeline link shared by CUB and TMDB', async () => {
 const result=await normalizeSignals({favorites:{},timeline:{hash:{card:'movie_77',percent:95}}});
 assert.deepEqual(result.records,[]); assert.equal(result.skipped,1);
});

test('rejects explicit unsupported and conflicting media types', async () => {
 const result=await normalizeSignals({favorites:{history:[{id:12,media_type:'person',original_title:'x'},{id:13,media_type:'tv',type:'movie'},{id:14,original_title:'x',original_name:'y'},{id:15,media_type:'movie',type:'person'}]},timeline:{}});
 assert.deepEqual(result.records,[]); assert.equal(result.skipped,4);
});


test('only explicit TMDB timeline provenance attaches progress, even with a same-ID favorite', async () => {
 const favorites={history:[{id:77,original_title:'film',source:'tmdb'}]};
 const legacy=await normalizeSignals({favorites,timeline:{hash:{card:'movie_77',percent:95}}});
 assert.deepEqual(legacy.records[0].signals,['history']); assert.equal(legacy.skipped,1);
 const cub=await normalizeSignals({favorites,timeline:{hash:{card:'movie_77',source:'cub',percent:95}}});
 assert.deepEqual(cub.records[0].signals,['history']); assert.equal(cub.skipped,1);
 const tmdb=await normalizeSignals({favorites,timeline:{hash:{card:'movie_77',source:'tmdb',percent:95}}});
 assert.deepEqual(tmdb.records[0].signals,['completed','history','started']);
});

test('native timeline persists source on new links and clears stale provenance on source-less updates', async () => {
 const {readFile}=await import('node:fs/promises'); const {runInNewContext}=await import('node:vm');
 let source=await readFile(new URL('../../../src/interaction/timeline.js',import.meta.url),'utf8');
 source=source.replace(/^import .*$/gm,'').replace('export default {','globalThis.timelineModule = {');
 const storage={}; const element={toggleClass(){return this},css(){return this},each(){return this}};
 const context={Storage:{get:()=>storage,set:(key,value)=>Object.assign(storage,value)},Subscribe:()=>({send(){}}),Utils:{onceInit:fn=>fn},Account:{Permit:{sync:false},hasPremium:()=>false},Activity:{renderLayers:()=>[]},Lampa:{Listener:{send(){}}},document:{},$:()=>element};
 runInNewContext(source,context); const timeline=context.timelineModule; timeline.init();
 const link=timeline.link({id:77,original_title:'film',source:'tmdb'});
 assert.equal(link.source,'tmdb'); timeline.view(123,link).handler(95,100,105);
 assert.equal(storage[123].source,'tmdb');
 timeline.update({card:'movie_77',hash:123,percent:95}); assert.equal(storage[123].source,undefined);
});
