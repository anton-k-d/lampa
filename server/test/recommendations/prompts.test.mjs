import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openConfigDatabase } from '../../src/config/database.mjs';
import { createRuntimeStore } from '../../src/runtime/store.mjs';
import { createAISettings } from '../../src/recommendations/settings.mjs';
import { createRecommendationRepository } from '../../src/recommendations/repository.mjs';
import { createJobs } from '../../src/recommendations/jobs.mjs';
import { createRecommendationService } from '../../src/recommendations/service.mjs';
import { createOpenAITransport } from '../../src/recommendations/openai.mjs';
import { rankCandidates } from '../../src/recommendations/ranking.mjs';
import { digestRecords } from '../../src/recommendations/profiles.mjs';

const prompts={home:'Prefer thoughtful home picks',similar:'Prefer close matches'};
test('legacy settings gain defaults and prompt edits persist with revision checks across restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ai-prompts-'));let db;
 try {const path=join(dir,'db.sqlite');db=openConfigDatabase(path);let settings=createAISettings(db,createRuntimeStore(db));const {prompts:defaults,...legacy}=settings.read().document;assert.ok(defaults.home.trim()&&defaults.similar.trim());
 db.prepare('INSERT INTO ai_settings(id,revision,document_json) VALUES(1,1,?)').run(JSON.stringify(legacy));assert.deepEqual(settings.read().document.prompts,defaults);
 assert.deepEqual(settings.save(legacy,1).document.prompts,defaults);const saved=settings.save({...legacy,prompts},2);assert.deepEqual(saved.document.prompts,prompts);assert.throws(()=>settings.save({...legacy,prompts},2),{code:'REVISION_CONFLICT'});db.close();db=openConfigDatabase(path);settings=createAISettings(db,createRuntimeStore(db));assert.deepEqual(settings.read().document.prompts,prompts);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});
test('prompt validation requires exactly two trimmed, nonempty bounded strings',()=>{
 const db=openConfigDatabase(':memory:');try{const settings=createAISettings(db,createRuntimeStore(db)),doc=settings.read().document;
 for(const bad of [{home:' ',similar:'ok'},{home:'ok',similar:''},{home:'x'.repeat(4001),similar:'ok'},{home:'ok'},{...prompts,extra:'x'},{home:42,similar:'ok'},null]) assert.throws(()=>settings.save({...doc,prompts:bad},0),{code:'INVALID_CONFIG'});
 assert.deepEqual(settings.save({...doc,prompts:{home:'  hello  ',similar:'  world  '}},0).document.prompts,{home:'hello',similar:'world'});
 }finally{db.close();}
});
test('ranking sends custom instructions as developer content while preserving system guard',async()=>{
 let payload;const transport=createOpenAITransport({client:{responses:{create:async p=>{payload=p;return {output_text:JSON.stringify({items:[{key:'tmdb:movie:2',reasonCode:'discovery',seedKey:null}]})};}}}});
 await rankCandidates({candidates:[{key:'tmdb:movie:2',title:'Title',genre_ids:[],relations:[]}],prompt:'Prefer obscure films',transport});
 assert.equal(payload.input.find(m=>m.role==='developer')?.content,'Prefer obscure films');assert.match(payload.input.find(m=>m.role==='system').content,/untrusted/);assert.match(payload.input.find(m=>m.role==='system').content,/candidate/);assert.equal(payload.text.format.strict,true);
});
test('jobs use kind-specific prompts, settings changes invalidate similar cache, and admin test ignores prompts',async()=>{
 const db=openConfigDatabase(':memory:');try{const repo=createRecommendationRepository(db),settings=createAISettings(db,createRuntimeStore(db)),jobs=createJobs(db);repo.replaceSnapshot({deviceId:'tv',seq:1,digest:digestRecords([]),records:[]});settings.save({...settings.read().document,enabled:true,prompts},0,{key:'fixture'});
 const seen=[];const service=createRecommendationService({db,repository:repo,jobs,settings,provider:()=>({getList:async()=>[{key:'tmdb:movie:2',id:2,type:'movie',title:'Fixture',genre_ids:[],adult:false}],hydrateCards:async()=>[]}),transportFactory:()=>({rank:async request=>{seen.push(request.prompt);return {output_text:JSON.stringify({items:[{key:request.input.candidates[0].key,reasonCode:'discovery',seedKey:null}]})};}})});
 service.requestHome({deviceId:'tv',mutationId:'home'});await service.workOnce();service.requestSimilar({deviceId:'tv',seed:{type:'movie',id:1},mutationId:'similar'});await service.workOnce();assert.deepEqual(seen,[prompts.home,prompts.similar]);assert.equal(service.readSimilar('tv',{type:'movie',id:1}).state,'ready');settings.save({...settings.read().document,prompts:{...prompts,similar:'Changed'}},1);assert.equal(service.readSimilar('tv',{type:'movie',id:1}).state,'empty');await service.testConnection();assert.equal(seen[2],undefined);
 }finally{db.close();}
});
