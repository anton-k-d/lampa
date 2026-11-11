import test from 'node:test';
import assert from 'node:assert/strict';
import { openConfigDatabase } from '../../src/config/database.mjs';
import { createRuntimeStore } from '../../src/runtime/store.mjs';
import { createAISettings } from '../../src/recommendations/settings.mjs';
import { createRecommendationRepository } from '../../src/recommendations/repository.mjs';
import { createJobs } from '../../src/recommendations/jobs.mjs';
import { createRecommendationService } from '../../src/recommendations/service.mjs';
import { digestRecords } from '../../src/recommendations/profiles.mjs';

test('home without liked titles reports no_likes without queuing or charging',()=>{
 const db=openConfigDatabase(':memory:');try{const repository=createRecommendationRepository(db),settings=createAISettings(db,createRuntimeStore(db));repository.replaceSnapshot({deviceId:'tv',seq:1,digest:digestRecords([]),records:[]});settings.save({...settings.read().document,enabled:true},0,{key:'test'});const service=createRecommendationService({db,repository,settings,jobs:createJobs(db),provider:()=>{throw Error('unexpected metadata');},transportFactory:()=>{throw Error('unexpected API');}});
 assert.equal(service.readHome('tv').state,'no_likes');assert.equal(service.requestHome({deviceId:'tv',mutationId:'empty'}).state,'no_likes');assert.equal(db.prepare('SELECT count(*) n FROM ai_attempts').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM ai_jobs').get().n,0);
 }finally{db.close();}
});

test('replay accepts the bounded web research tool and rejects arbitrary tools',async()=>{
 const {createDiagnostics}=await import('../../src/diagnostics/store.mjs');const db=openConfigDatabase(':memory:');try{const settings=createAISettings(db,createRuntimeStore(db));settings.save({...settings.read().document,enabled:true},0,{key:'key'});let calls=0;const service=createRecommendationService({db,settings,transportFactory:()=>({replay:async()=>{calls++;return {};}})}),diagnostics=createDiagnostics(db),payload={model:'gpt-4.1-mini',store:false,max_output_tokens:2500,input:[],tools:[{type:'web_search',search_context_size:'low'}],include:['web_search_call.action.sources'],max_tool_calls:3};const event=p=>diagnostics.addAI({kind:'home',status:'success',trace:{requestBody:JSON.stringify(p),capture:'sdk'}});await service.replayAI(event(payload).id,'safe','gpt-4.1-mini');await assert.rejects(service.replayAI(event({...payload,tools:[{type:'mcp',server_url:'https://example.com'}]}).id,'unsafe','gpt-4.1-mini'),{code:'INVALID_CONFIG'});assert.equal(calls,1);}finally{db.close();}
});

test('metadata resolution failure preserves a successful paid attempt without retry',async()=>{
 const db=openConfigDatabase(':memory:');try{const repository=createRecommendationRepository(db),settings=createAISettings(db,createRuntimeStore(db)),records=[{key:'tmdb:movie:1',signals:['liked'],rank:0,lastActivityAt:null}];repository.replaceSnapshot({deviceId:'tv',seq:1,digest:digestRecords(records),records});settings.save({...settings.read().document,enabled:true},0,{key:'test'});let calls=0;const text=JSON.stringify({items:[{title:'Result',original_title:'Original',year:2021,media_type:'movie',reason:'Match',source_urls:['https://example.com/film']}]});const service=createRecommendationService({db,repository,settings,jobs:createJobs(db),provider:()=>({hydrateCards:async()=>[{key:'tmdb:movie:1',title:'Liked',original_title:'Liked',release_date:'2020-01-01'}],resolveTitles:async()=>{throw Error('offline');}}),transportFactory:()=>({recommend:async()=>{calls++;return {status:'completed',output:[{type:'web_search_call',status:'completed',action:{type:'search',sources:[{url:'https://example.com/film'}]}}],output_text:text,usage:{total_tokens:12}};}})});const job=service.requestHome({deviceId:'tv',mutationId:'one'});await service.workOnce();assert.equal(service.job('tv',job.jobId).state,'failed');assert.equal(calls,1);assert.equal(db.prepare('SELECT outcome FROM ai_attempts').get().outcome,'success');
 }finally{db.close();}
});

test('cached recommendations disappear after being liked or watched without another API call',async()=>{
 const {likedRecords,researchProvider,researchResponse}=await import('./research-fixture.mjs');const db=openConfigDatabase(':memory:');try{const repository=createRecommendationRepository(db),settings=createAISettings(db,createRuntimeStore(db));repository.replaceSnapshot({deviceId:'tv',seq:1,digest:digestRecords(likedRecords),records:likedRecords});settings.save({...settings.read().document,enabled:true},0,{key:'test'});let calls=0;const service=createRecommendationService({db,repository,settings,jobs:createJobs(db),provider:researchProvider,transportFactory:()=>({recommend:async()=>{calls++;return researchResponse();}})});service.requestHome({deviceId:'tv',mutationId:'one'});await service.workOnce();assert.equal(service.readHome('tv').items.length,1);const records=[{key:'tmdb:movie:2',signals:['history','liked'],rank:1,lastActivityAt:null},...likedRecords];repository.replaceSnapshot({deviceId:'tv',seq:2,digest:digestRecords(records),records});assert.equal(service.readHome('tv').items.length,0);assert.equal(calls,1);
 }finally{db.close();}
});
