import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareResearchInput,recommendTitles} from '../../src/recommendations/research.mjs';
import {createOpenAITransport} from '../../src/recommendations/openai.mjs';
import {failureFor} from '../../src/recommendations/failures.mjs';
const card=(key)=>({key,title:'Film '+key,original_title:'Original',release_date:'2020-01-01',overview:'private',poster_path:'private'});
const source='https://reviews.example/film';
const proposal={title:'Result',original_title:'Original Result',year:2021,media_type:'movie',reason:'A good match',source_urls:[source]};
const output=(change={})=>({id:'resp',object:'response',status:'completed',output:[{type:'web_search_call',status:'completed',action:{type:'search',sources:[{type:'url',url:source}]}},{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({items:[proposal]})}]}],...change});
const likes=Array.from({length:3},(_,i)=>({title:`Like ${i}`,original_title:`Original ${i}`,year:2020,media_type:'movie'}));
const research=async(items,urls,annotations=[])=>{const x=output();x.output[0].action.sources=urls.map(url=>({type:'url',url}));x.output[1].content[0].annotations=annotations.map(url=>({type:'url_citation',url}));x.output_text=JSON.stringify({items});return recommendTitles({likedTitles:likes,transport:{recommend:async()=>x}});};
const item=(n,...urls)=>({...proposal,title:`Result ${n}`,original_title:`Original ${n}`,source_urls:urls});
test('keeps four verified recommendations and strips an invented fifth citation',async()=>{
 const urls=['https://a.example/one','https://b.example/two?gclid=provider','https://c.example/three?id=7','https://d.example/four'];
 const result=await research([item(1,urls[0]+'?utm_source=chat'),item(2,'https://b.example/two'),item(3,urls[2]+'&UTM_campaign=x'),item(4,urls[3]+'?fbclid=x&msclkid=x&yclid=x&dclid=x'),item(5,'https://en.wikipedia.org/wiki/Fake')],urls);
 assert.deepEqual(result.proposals.map(p=>p.sources),[...urls.map(url=>[url]),[]]);assert.deepEqual(result.citationSummary,{verified:4,partial:0,unverified:1});
});
test('annotations normalize tracking parameters and preserve provider URL',async()=>{
 const result=await research([item(1,'https://reviews.example/film?utm_source=x')],[],['https://reviews.example/film?gclid=provider']);
 assert.deepEqual(result.proposals[0].sources,['https://reviews.example/film?gclid=provider']);
});
test('unverified citations cannot change document identity or appear in sources',async()=>{
 const original='https://reviews.example/film?id=1&page=2&signature=abc';
 for(const candidate of ['https://reviews.example/other?id=1&page=2&signature=abc','http://reviews.example/film?id=1&page=2&signature=abc','https://www.reviews.example/film?id=1&page=2&signature=abc','https://reviews.example/film/?id=1&page=2&signature=abc','https://reviews.example/film?id=2&page=2&signature=abc','https://reviews.example/film?id=1&page=3&signature=abc','https://reviews.example/film?id=1&page=2&signature=def','https://reviews.example/film?id=1&page=2&signature=abc#other','https://user@reviews.example/film?id=1&page=2&signature=abc','https://@reviews.example/film?id=1&page=2&signature=abc','javascript:alert(1)','not a url']){
  const result=await research([item(1,original,candidate),item(2,original)], [original]);assert.deepEqual(result.proposals.map(p=>[p.citationStatus,p.sources]),[['partial',[original]],['verified',[original]]]);
  const unmatched=await research([item(1,candidate)],[original]);assert.deepEqual(unmatched.proposals[0].sources,[]);assert.equal(unmatched.proposals[0].citationStatus,'unverified');
 }
});
test('malformed proposal remains a hard failure even beside a valid proposal',async()=>{
 await assert.rejects(research([item(1,source),{...item(2,'https://fake.example/'),year:'2021'}],[source]),{code:'invalid_response'});
 await assert.rejects(research([item(1,source),item(2,'https://reviews.example/'+ 'a'.repeat(2049))],[source]),{code:'invalid_response'});
});
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
 assert.match(body.input[0].content,/new titles.*liked.*similarTo/i);assert.match(body.input[0].content,/copy.*URLs.*(?:search|sources).*annotations/i);assert.match(body.input[0].content,/never invent/i);
 assert.deepEqual(result.proposals,[{title:'Result',original_title:'Original Result',year:2021,media_type:'movie',reason:'A good match',sources:[source],citationStatus:'verified'}]);assert.equal(result.providerRequestId,'req_1');assert.deepEqual(body.tools,[{type:'web_search',search_context_size:'medium'}]);assert.equal(body.max_tool_calls,6);assert(body.include.includes('web_search_call.action.sources'));assert(Buffer.byteLength(JSON.stringify(body))<10240);assert(!JSON.stringify(body).includes('history'));assert.match(body.input.at(-1).content,/Liked titles/);assert.equal(body.input.at(-1).content.match(/^- /gm).length,3);
});
test('rejects absent or failed search and unexpected output fields',async()=>{
 const base=output();for(const modify of [o=>{o.output.splice(0,1);},o=>{o.output[0].status='failed';},o=>{const p=JSON.parse(o.output[1].content[0].text);p.items[0].tmdb_id=42;o.output[1].content[0].text=JSON.stringify(p);}]){const x=structuredClone(base);modify(x);await assert.rejects(recommendTitles({likedTitles:likes,transport:{recommend:async()=>({...x,output_text:x.output.at(-1).content[0].text})}}),{code:'invalid_response'});}
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
test('retains proposals with partial, absent, and invented citations and reports their quality',async()=>{
 const result=await research([item(1,source),item(2,source,'https://fake.example/'),item(3),item(4,'https://fake.example/')],[source]);
 assert.deepEqual(result.proposals.map(p=>[p.citationStatus,p.sources]),[['verified',[source]],['partial',[source]],['unverified',[]],['unverified',[]]]);
 assert.deepEqual(result.citationSummary,{verified:1,partial:1,unverified:2});
});
test('completed search without provider URLs retains unverified titles but missing search fails',async()=>{
 const result=await research([item(1,'https://invented.example/')],[]);assert.deepEqual(result.proposals[0].sources,[]);assert.equal(result.proposals[0].citationStatus,'unverified');assert.deepEqual(result.citationSummary,{verified:0,partial:0,unverified:1});
 const x=output();x.output.shift();x.output_text=JSON.stringify({items:[item(1)]});await assert.rejects(recommendTitles({likedTitles:likes,transport:{recommend:async()=>x}}),{code:'invalid_response'});
});

test('requests ten anchored recommendations and accepts a legacy short response',async()=>{
 let body;const transport=createOpenAITransport({apiKey:'secret',fetchImpl:async(_url,init)=>{body=JSON.parse(init.body);return new Response(JSON.stringify(output()),{status:200,headers:{'content-type':'application/json'}});}});
 const seed={title:'Anchor',original_title:'Anchor',year:1999,media_type:'movie',overview:'A live broadcast turns into a thriller.',genres:['Thriller']};
 const result=await recommendTitles({likedTitles:likes,similarTo:seed,transport});
 assert.equal(result.targetCount,10);assert.equal(result.proposals.length,1);
 assert.deepEqual(body.tool_choice,{type:'web_search'});assert.equal(body.text.format.schema.properties.items.minItems,undefined);assert.equal(body.text.format.schema.properties.items.maxItems,10);
 assert.match(body.input.at(-1).content,/Anchor: Anchor \(Anchor, 1999, movie\)/);assert.match(body.input.at(-1).content,/movies like Anchor 1999/);assert.match(body.input.at(-1).content,/live broadcast/);assert.match(body.input.at(-1).content,/Thriller/);
 assert.match(body.input[0].content,/similarTo.*primary.*(?:title.*year|year.*title)/i);assert.match(body.input[0].content,/likes.*secondary/i);assert.match(body.input[0].content,/theme.*tone.*pacing.*narrative.*stakes/i);assert.match(body.input[0].content,/English queries/i);
});

test('classifies invalid model responses while retaining provider diagnostics',async()=>{
 const base=output({_request_id:'req_test',usage:{input_tokens:4,output_tokens:5,total_tokens:9},trace:{requestBody:'saved'}});base.output_text=JSON.stringify({items:[item(1)]});
 const cases=[
  ['SEARCH_REQUIRED',x=>x.output.shift()],
  ['SEARCH_REQUIRED',x=>{x.output[0].status='failed';}],
  ['MODEL_FAILED',x=>{x.status='incomplete';x.incomplete_details={reason:'content_filter'};}],
  ['OUTPUT_LIMIT',x=>{x.status='incomplete';x.incomplete_details={reason:'max_output_tokens'};}],
  ['MODEL_REFUSED',x=>{x.output[1].content=[{type:'refusal',refusal:'no'}];}],
  ['MODEL_FAILED',x=>{x.status='failed';}],
  ['INVALID_JSON',x=>{x.output_text='{';}],
  ['INVALID_ITEMS',x=>{x.output_text=JSON.stringify({items:Array.from({length:11},(_,i)=>item(i))});}],
  ['INVALID_ITEM',x=>{x.output_text=JSON.stringify({items:[item(1),{...item(2),year:'bad'}]});}],
 ];
 for(const [reason,modify] of cases){const x=structuredClone(base);modify(x);await assert.rejects(recommendTitles({likedTitles:likes,transport:{recommend:async()=>x}}),e=>{assert.equal(e.code,'invalid_response');assert.equal(e.validationReason,reason);assert.equal(e.providerRequestId,'req_test');assert.equal(e.usage.total_tokens,9);assert.deepEqual(e.trace,{requestBody:'saved'});if(reason==='INVALID_ITEM')assert.equal(e.itemIndex,1);return true;});}
});
test('anchor keeps the catalog description and likes keep only genres',async()=>{
 const rich=key=>({key,title:'Film '+key,original_title:'Original',release_date:'2020-01-01',overview:'A long overview',tagline:'Tag',genres:['Drama','Sci-Fi'],countries:['US'],director:'Nolan',cast:['A','B'],poster_path:'private'});
 const result=await prepareResearchInput({records:[{key:'tmdb:movie:1',signals:['liked']}],seedKey:'tmdb:movie:9',provider:{hydrateCards:async keys=>keys.map(rich)}});
 assert.deepEqual(result.likedTitles[0].genres,['Drama','Sci-Fi']);assert.equal(result.likedTitles[0].overview,undefined);assert.equal(result.likedTitles[0].director,undefined);
 assert.equal(result.similarTo.overview,'A long overview');assert.equal(result.similarTo.tagline,'Tag');assert.equal(result.similarTo.director,'Nolan');assert.deepEqual(result.similarTo.cast,['A','B']);assert.deepEqual(result.similarTo.countries,['US']);
});
test('drops duplicate and already listed titles instead of failing the batch',async()=>{
 const liked=[{title:'Kept',original_title:'Kept',year:1999,media_type:'movie'}];
 const anchor={title:'Anchor',original_title:'Anchor',year:2001,media_type:'movie'};
 const items=[item(1),item(1),{...proposal,title:'Kept',original_title:'Kept',year:1999},{...proposal,title:'Anchor',original_title:'Anchor',year:2001},item(2)];
 const x=output();x.output_text=JSON.stringify({items});x.output[1].content[0].text=x.output_text;
 const result=await recommendTitles({likedTitles:liked,similarTo:anchor,transport:{recommend:async()=>x}});
 assert.deepEqual(result.proposals.map(p=>p.original_title),['Original 1','Original 2']);
 const empty=output();empty.output_text=JSON.stringify({items:[items[2],items[3]]});empty.output[1].content[0].text=empty.output_text;
 await assert.rejects(recommendTitles({likedTitles:liked,similarTo:anchor,transport:{recommend:async()=>empty}}),e=>e.code==='invalid_response'&&e.validationReason==='INVALID_ITEMS');
});
test('maps an unsupported search model without treating every bad request as unsupported',async()=>{
 await assert.rejects(recommendTitles({likedTitles:likes,transport:{recommend:async()=>{throw Object.assign(new Error('does not support web_search'),{status:400});}}}),{code:'model_unsupported'});
 await assert.rejects(recommendTitles({likedTitles:likes,transport:{recommend:async()=>{throw Object.assign(new Error('missing'),{status:404});}}}),{code:'model_unsupported'});
 await assert.rejects(recommendTitles({likedTitles:likes,transport:{recommend:async()=>{throw Object.assign(new Error('bad schema'),{status:400});}}}),{code:'provider_error'});
 assert.equal(failureFor('model_unsupported').code,'MODEL_UNSUPPORTED');assert.match(failureFor('model_unsupported').action,/модель/i);
});
test('reasoning models request low effort and every model gets a larger output budget',async()=>{
 let payload;const transport=createOpenAITransport({client:{responses:{create:async p=>{payload=p;return {output_text:'{}'};}}}});
 await transport.recommend({model:'gpt-5',schema:{type:'object'},input:{liked:likes,similarTo:{title:'Прайм-тайм',original_title:'Primetime',year:2026,media_type:'movie',overview:'Live television'},locale:'ru-RU',target_count:10}});
 assert.equal(payload.reasoning.effort,'low');assert.equal(payload.max_output_tokens,8000);assert.match(payload.input.at(-1).content,/Primetime/);assert.match(payload.input.at(-1).content,/Live television/);
 await transport.recommend({model:'o3-mini',schema:{type:'object'},input:{liked:likes,locale:'ru-RU',target_count:10}});
 assert.equal(payload.reasoning.effort,'low');assert.equal(payload.max_output_tokens,8000);
 await transport.recommend({model:'gpt-6-luna',schema:{type:'object'},input:{liked:likes,locale:'ru-RU',target_count:10}});
 assert.equal(payload.reasoning.effort,'low');assert.equal(payload.max_output_tokens,8000);
 await transport.rank({model:'gpt-4.1-mini',schema:{type:'object'},input:{}});
 assert.equal(payload.reasoning,undefined);assert.equal(payload.max_output_tokens,8000);
});
