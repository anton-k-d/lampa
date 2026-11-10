import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenAITransport} from '../../src/recommendations/openai.mjs';
import {rankCandidates} from '../../src/recommendations/ranking.mjs';

const output = JSON.stringify({id:'resp',object:'response',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"items":[{"key":"tmdb:movie:1","reasonCode":"discovery","seedKey":null}]}'}]}]});
const args = {model:'gpt-4.1-mini',schema:{type:'object'},input:{private:'history'},prompt:'custom prompt'};

test('captures actual HTTP bodies and replays the same payload with a new model',async()=>{
 const sent=[];const transport=createOpenAITransport({apiKey:'secret',fetchImpl:async (_url,init)=>{sent.push(init.body);return new Response(output,{status:200,headers:{'content-type':'application/json','x-request-id':'req_trace'}});}});
 const result=await transport.rank(args);
 assert.equal(result._request_id,'req_trace');assert.equal(result.trace.requestBody,sent[0]);assert.equal(result.trace.responseBody,output);assert.equal(result.trace.httpStatus,200);assert.equal(result.trace.capture,'http');assert.equal(result.trace.truncated,false);
 assert.equal(JSON.parse(sent[0]).input[1].content,'custom prompt');
 const replay=await transport.replay(result.trace.requestBody,{model:'another-model'});
 assert.deepEqual(JSON.parse(sent[1]),{...JSON.parse(sent[0]),model:'another-model'});assert.equal(replay.trace.responseBody,output);
});

test('captures malformed and error HTTP responses without retries',async()=>{
 for(const [status,body] of [[200,'not json'],[429,'raw provider error']]){
  let calls=0;const transport=createOpenAITransport({apiKey:'secret',fetchImpl:async()=>{calls++;return new Response(body,{status,headers:{'content-type':'application/json'}});}});
  await assert.rejects(transport.rank(args),e=>e.trace?.responseBody===body&&e.trace.httpStatus===status&&e.trace.capture==='http');assert.equal(calls,1);
 }
});

test('bounds captured data and marks injected SDK captures',async()=>{
 const large='x'.repeat(2*1024*1024+100);const transport=createOpenAITransport({client:{responses:{create:async()=>({output_text:large})}}});
 const result=await transport.rank({...args,prompt:large});assert.equal(result.trace.capture,'sdk');assert.equal(result.trace.truncated,true);assert(Buffer.byteLength(result.trace.requestBody)<=2*1024*1024);assert(Buffer.byteLength(result.trace.responseBody)<=2*1024*1024);
});

test('ranking forwards traces through success and failures',async()=>{
 const trace={requestBody:'{}',responseBody:'raw',httpStatus:200,transportError:null,capture:'sdk',truncated:false};const candidates=[{key:'tmdb:movie:1'}];
 const result=await rankCandidates({candidates,transport:{rank:async()=>({output_text:'{"items":[{"key":"tmdb:movie:1","reasonCode":"discovery","seedKey":null}]}',trace})}});assert.equal(result.trace,trace);
 await assert.rejects(rankCandidates({candidates,transport:{rank:async()=>({output_text:'bad',trace})}}),e=>e.trace===trace);
 await assert.rejects(rankCandidates({candidates,transport:{rank:async()=>{throw Object.assign(new Error('bad'),{trace});}}}),e=>e.trace===trace);
});

test('replay rejects non-object or malformed payloads before sending',async()=>{
 let calls=0;const transport=createOpenAITransport({client:{responses:{create:async()=>{calls++;}}}});
 for(const body of ['bad','null','[]'])await assert.rejects(transport.replay(body,{model:'x'}));assert.equal(calls,0);
});
