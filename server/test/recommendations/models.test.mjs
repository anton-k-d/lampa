import test from 'node:test';
import assert from 'node:assert/strict';
import {filterChatModels,listChatModels,FALLBACK_CHAT_MODELS} from '../../src/recommendations/openai.mjs';

test('chat model filter keeps completion models and drops specialized endpoints',()=>{
 assert.deepEqual(filterChatModels(['gpt-4.1-mini','text-embedding-3-small','whisper-1','tts-1','dall-e-3','gpt-4o-realtime-preview','gpt-4o-mini-tts','o3-mini','chatgpt-4o-latest','omni-moderation-latest','gpt-5',null,42]),['chatgpt-4o-latest','gpt-4.1-mini','gpt-5','o3-mini']);
});

test('model list uses the provider, caches the result and falls back without a key',async()=>{
 assert.deepEqual(await listChatModels(),[...FALLBACK_CHAT_MODELS]);
 let calls=0;const fetchImpl=async()=>{calls++;return new Response(JSON.stringify({object:'list',data:[{id:'gpt-5'},{id:'whisper-1'},{id:'text-embedding-3-large'}]}),{status:200,headers:{'content-type':'application/json'}});};
 const now=()=>0;
 assert.deepEqual(await listChatModels({apiKey:'live-key',fetchImpl,now}),['gpt-5']);
 assert.deepEqual(await listChatModels({apiKey:'live-key',fetchImpl,now}),['gpt-5']);
 assert.equal(calls,1);
 assert.deepEqual(await listChatModels({apiKey:'live-key',fetchImpl,now:()=>300001}),['gpt-5']);
 assert.equal(calls,2);
 let failed=0;assert.deepEqual(await listChatModels({apiKey:'other-key',fetchImpl:async()=>{failed++;throw Error('offline');}}),[...FALLBACK_CHAT_MODELS]);assert.equal(failed,1);
});

test('admin and diagnostics expose the same fallback list without a configured key',async()=>{
 const {openConfigDatabase}=await import('../../src/config/database.mjs');
 const {createRuntimeStore}=await import('../../src/runtime/store.mjs');
 const {createAISettings}=await import('../../src/recommendations/settings.mjs');
 const {createRecommendationService}=await import('../../src/recommendations/service.mjs');
 const {createHomeServer}=await import('../../src/http/server.mjs');
 const db=openConfigDatabase(':memory:');try{const settings=createAISettings(db,createRuntimeStore(db)),service=createRecommendationService({db,settings}),server=createHomeServer({db,aiSettings:settings,recommendationService:service});await new Promise(r=>server.listen(0,'127.0.0.1',r));try{const port=server.address().port;const admin=await (await fetch(`http://127.0.0.1:${port}/v1/admin/ai/models`)).json();const diagnostics=await (await fetch(`http://127.0.0.1:${port}/v1/admin/diagnostics/ai/models`)).json();assert.deepEqual(admin,{models:[...FALLBACK_CHAT_MODELS]});assert.deepEqual(diagnostics,admin);}finally{await new Promise(r=>server.close(r));}}finally{db.close();}
});
