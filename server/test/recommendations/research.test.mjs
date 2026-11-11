import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareResearchInput,recommendTitles} from '../../src/recommendations/research.mjs';
import {createOpenAITransport} from '../../src/recommendations/openai.mjs';
const card=(key)=>({key,title:'Film '+key,original_title:'Original',release_date:'2020-01-01',overview:'private',poster_path:'private'});
const source='https://reviews.example/film';
const proposal={title:'Result',original_title:'Original Result',year:2021,media_type:'movie',reason:'A good match',source_urls:[source]};
const output=(change={})=>({id:'resp',object:'response',status:'completed',output:[{type:'web_search_call',status:'completed',action:{type:'search',sources:[{type:'url',url:source}]}},{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({items:[proposal]})}]}],...change});
const likes=Array.from({length:3},(_,i)=>({title:`Like ${i}`,original_title:`Original ${i}`,year:2020,media_type:'movie'}));
test('only liked records are hydrated, ordered by recency and compacted',async()=>{
 let keys;const result=await prepareResearchInput({records:[{key:'tmdb:movie:1',signals:['liked'],lastActivityAt:'2020'},{key:'tmdb:tv:2',signals:['history']},{key:'tmdb:movie:3',signals:['liked'],lastActivityAt:'2022'}],provider:{hydrateCards:async k=>(keys=k,k.map(card))}});
 assert.deepEqual(keys,['tmdb:movie:3','tmdb:movie:1']);assert.deepEqual(result.likedTitles[0],{title:'Film tmdb:movie:3',original_title:'Original',year:2020,media_type:'movie'});assert.equal(result.similarTo,null);
});
test('no likes fails before hydration, seed permits empty likes, missing metadata fails',async()=>{
 await assert.rejects(prepareResearchInput({records:[],provider:{}}),{code:'NO_LIKES'});
 const provider={hydrateCards:async keys=>keys.map(card)};assert.equal((await prepareResearchInput({records:[],seedKey:'tmdb:tv:2',provider})).similarTo.media_type,'tv');
 await assert.rejects(prepareResearchInput({records:[{key:'tmdb:movie:1',signals:['liked']}],provider:{hydrateCards:async()=>[]}}),{code:'METADATA_UNAVAILABLE'});
});
test('real SDK request uses only web search and verifies citations',async()=>{
 let body;const transport=createOpenAITransport({apiKey:'secret',fetchImpl:async(_url,init)=>{body=JSON.parse(init.body);return new Response(JSON.stringify(output()),{status:200,headers:{'content-type':'application/json','x-request-id':'req_1'}});}});
 const result=await recommendTitles({likedTitles:likes,locale:'en-US',transport});
 assert.deepEqual(result.proposals,[{title:'Result',original_title:'Original Result',year:2021,media_type:'movie',reason:'A good match',sources:[source]}]);assert.equal(result.providerRequestId,'req_1');assert.deepEqual(body.tools,[{type:'web_search',search_context_size:'low'}]);assert.equal(body.max_tool_calls,3);assert(body.include.includes('web_search_call.action.sources'));assert(Buffer.byteLength(JSON.stringify(body))<10240);assert(!JSON.stringify(body).includes('history'));assert.equal(JSON.parse(body.input.at(-1).content).liked.length,3);
});
test('rejects fabricated citations, absent or failed search, and unexpected output fields',async()=>{
 const base=output();for(const modify of [o=>{o.output[1].content[0].text=o.output[1].content[0].text.replace(source,'https://fake.example/');},o=>{o.output.splice(0,1);},o=>{o.output[0].status='failed';},o=>{const p=JSON.parse(o.output[1].content[0].text);p.items[0].tmdb_id=42;o.output[1].content[0].text=JSON.stringify(p);}]){const x=structuredClone(base);modify(x);await assert.rejects(recommendTitles({likedTitles:likes,transport:{recommend:async()=>({...x,output_text:x.output.at(-1).content[0].text})}}),{code:'invalid_response'});}
});

test('accepts provider citation annotations only alongside a completed web search',async()=>{
 const x=output();delete x.output[0].action.sources;x.output[1].content[0].annotations=[{type:'url_citation',url:source}];
 const transport={recommend:async()=>({...x,output_text:x.output.at(-1).content[0].text})};
 assert.equal((await recommendTitles({likedTitles:likes,transport})).proposals[0].sources[0],source);
 x.output.shift();await assert.rejects(recommendTitles({likedTitles:likes,transport}),{code:'invalid_response'});
});

test('open page and find actions cannot substitute for a search',async()=>{
 for(const type of ['open_page','find',undefined]){
  const x=output();x.output[0].action={type,sources:[{type:'url',url:source}]};x.output[1].content[0].annotations=[{type:'url_citation',url:source}];
  await assert.rejects(recommendTitles({likedTitles:likes,transport:{recommend:async()=>({...x,output_text:x.output[1].content[0].text})}}),{code:'invalid_response'});
 }
});
