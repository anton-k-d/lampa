import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=(await readFile(new URL('../../../src/core/account/bookmarks.js',import.meta.url),'utf8')).replace(/^import .*$/gm,'').replace('export default {','globalThis.bookmarksApi = {');
function fixture({cache,tracker,dump}) {
 const context={console:{log(){},warn(){},error(){}},Permit:{sync:true,account:{profile:{id:1}}},Cache:{getData:async()=>cache,getDataAnyCase:async()=>tracker,rewriteData:async()=>{}},Api:{load:async path=>path==='bookmarks/dump'?JSON.stringify({bookmarks:dump,version:2}):{changelog:[],version:2}},Arrays:{decodeJson:JSON.parse,isArray:Array.isArray},Utils:{onceInit:f=>f,clearCard:x=>x},WebWorker:{utils:(_,done)=>done({data:dump})},Platform:{is:()=>false},LoadingProgress:{status(){}},setTimeout,clearTimeout};
 vm.runInNewContext(source,context);return context.bookmarksApi;
}
const update=api=>new Promise(resolve=>api.update(resolve));
test('missing cache and incremental changelog cannot authorize a snapshot',async()=>{const api=fixture({cache:null,tracker:{time:Date.now(),version:1}});await update(api);assert.equal(api.recommendationReady(),false)});
test('an empty full dump is an authoritative snapshot',async()=>{const api=fixture({cache:null,tracker:{time:0},dump:[]});await update(api);assert.equal(api.recommendationReady(),true)});
