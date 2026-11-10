import test from 'node:test';
import assert from 'node:assert/strict';
import { rankCandidates } from '../../src/recommendations/ranking.mjs';
import { createOpenAITransport } from '../../src/recommendations/openai.mjs';
const candidates=[{key:'tmdb:movie:2',title:'Safe',genre_ids:[1],relations:['tmdb:movie:1']}];
const seeds=[{key:'tmdb:movie:1',title:'Seed',genre_ids:[1]}];
test('returns only catalog cards with a verified template reason', async()=>{
 const result=await rankCandidates({candidates,seeds,transport:{rank:async()=>({output_text:JSON.stringify({items:[{key:candidates[0].key,reasonCode:'similar',seedKey:seeds[0].key}]}),usage:{total_tokens:5},_request_id:'req'})}});
 assert.equal(result.items[0].card,candidates[0]); assert.match(result.items[0].reason,/Seed/); assert.equal(result.providerRequestId,'req');
});
test('rejects unknown, duplicate and unsupported reason links',async()=>{
 for(const items of [[{key:'tmdb:movie:999',reasonCode:'discovery',seedKey:null}],[{key:candidates[0].key,reasonCode:'similar',seedKey:null}],[{key:candidates[0].key,reasonCode:'discovery',seedKey:null},{key:candidates[0].key,reasonCode:'discovery',seedKey:null}]]) await assert.rejects(rankCandidates({candidates,seeds,transport:{rank:async()=>({output_text:JSON.stringify({items})})}}));
});
test('SDK transport disables storage and retries and bounds output',async()=>{
 let payload,options; const transport=createOpenAITransport({client:{responses:{create:async(p,o)=>{payload=p; options=o; return {};}}}});
 await transport.rank({model:'gpt-4.1-mini',schema:{type:'object'},input:'data'});
 assert.equal(payload.store,false); assert.equal(payload.max_output_tokens,2500); assert.equal(options.maxRetries,0); assert.equal(payload.text.format.type,'json_schema');
});

test('refusals, incomplete responses and malformed JSON fail closed',async()=>{
 for(const response of [{output:[{content:[{type:'refusal',refusal:'no'}]}]},{status:'incomplete',output_text:'{}'},{output_text:'{'}]) await assert.rejects(rankCandidates({candidates,seeds,transport:{rank:async()=>response}}),{code:'invalid_response'});
});
test('provider errors are classified without leaking sensitive errors',async()=>{
 for(const [status,code] of [[401,'provider_auth'],[403,'provider_auth'],[429,'provider_rate_limit'],[503,'provider_unavailable']]) await assert.rejects(rankCandidates({candidates,seeds,transport:{rank:async()=>{throw Object.assign(new Error('secret prompt and key'),{status});}}}),e=>e.code===code&&!e.message.includes('secret'));
 await assert.rejects(rankCandidates({candidates,seeds,model:'unknown',transport:{}}),{code:'unsupported_model'});
});

test('liked reason requires an actually liked seed',async()=>{
 const transport={rank:async()=>({output_text:JSON.stringify({items:[{key:candidates[0].key,reasonCode:'liked',seedKey:seeds[0].key}]})})};
 await assert.rejects(rankCandidates({candidates,seeds,transport}),{code:'invalid_response'});
});

test('timeouts and caller abort have safe distinct error codes',async()=>{
 await assert.rejects(rankCandidates({candidates,seeds,transport:{rank:async()=>{throw Object.assign(new Error('private'),{name:'APIConnectionTimeoutError'});}}}),{code:'provider_timeout'});
 const controller=new AbortController();controller.abort();await assert.rejects(rankCandidates({candidates,seeds,signal:controller.signal,transport:{rank:async()=>{throw Error('private');}}}),{code:'aborted'});
});

test('sends bounded semantic taste rather than raw profile history',async()=>{
 let input;const taste=Array.from({length:1000},(_,i)=>({key:`tmdb:movie:${i+1}`,signals:[i<50?'liked':'history'],rank:i,lastActivityAt:'2026-01-01T00:00:00Z',privateField:'do not send'}));
 await rankCandidates({candidates,seeds,taste,transport:{rank:async request=>{input=request.input;return {output_text:JSON.stringify({items:[{key:candidates[0].key,reasonCode:'discovery',seedKey:null}]})};}}});
 assert(input.taste.length<=40);assert(input.taste.every(x=>Object.keys(x).sort().join() === 'key,signals'));assert(!JSON.stringify(input.taste).includes('privateField'));assert(!input.taste.some(x=>x.key==='tmdb:movie:1000'));
});

test('preserves Retry-After without exposing provider details',async()=>{
 for(const [header,expected] of [['2',2000],['Thu, 01 Jan 1970 00:00:05 GMT',4000]]) {
  await assert.rejects(rankCandidates({candidates,seeds,now:()=>1000,transport:{rank:async()=>{throw Object.assign(new Error('private'),{status:429,headers:new Headers({'retry-after':header})});}}}),e=>e.retryAfterMs===expected&&!e.message.includes('private'));
 }
});
