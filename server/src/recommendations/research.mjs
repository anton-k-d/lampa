import {readFileSync} from 'node:fs';
const schema=JSON.parse(readFileSync(new URL('../../../schemas/recommendation-research.v1.schema.json',import.meta.url),'utf8'));
const KEY=/^tmdb:(movie|tv):([1-9][0-9]{0,11})$/;
const fail=code=>Object.assign(new Error(code),{code});
export async function prepareResearchInput({records=[],seedKey=null,provider,locale='en-US',signal}){
 const likes=(Array.isArray(records)?records:[]).filter(r=>r?.signals?.includes('liked')&&KEY.test(r.key)).sort((a,b)=>String(b.lastActivityAt||'').localeCompare(String(a.lastActivityAt||''))||(Number.isSafeInteger(a.rank)?a.rank:Number.MAX_SAFE_INTEGER)-(Number.isSafeInteger(b.rank)?b.rank:Number.MAX_SAFE_INTEGER)||a.key.localeCompare(b.key));
 const keys=[...new Set(likes.map(r=>r.key))].slice(0,40);
 if(!keys.length&&!seedKey)throw fail('NO_LIKES');
 if(seedKey&&!KEY.test(seedKey))throw fail('METADATA_UNAVAILABLE');
 let cards;try{cards=await provider.hydrateCards([...new Set([...keys,...(seedKey?[seedKey]:[])])],{locale,signal});}catch(e){if(signal?.aborted)throw signal.reason;throw fail('METADATA_UNAVAILABLE');}
 const map=new Map((Array.isArray(cards)?cards:[]).map(c=>[c.key,c]));
 const compact=key=>{const c=map.get(key),type=KEY.exec(key)?.[1],title=c?.title||c?.name,original=c?.original_title||c?.original_name,date=c?.release_date||c?.first_air_date,year=typeof date==='string'&&/^\d{4}/.test(date)?Number(date.slice(0,4)):null;if(typeof title!=='string'||!title.trim()||typeof original!=='string'||!original.trim()||!year)throw fail('METADATA_UNAVAILABLE');return {title,original_title:original,year,media_type:type};};
 return {likedTitles:keys.map(compact),similarTo:seedKey?compact(seedKey):null};
}
function url(s){try{const u=new URL(s);return (u.protocol==='https:'||u.protocol==='http:')&&s.length<=2048;}catch{return false;}}
export async function recommendTitles({likedTitles,similarTo=null,locale='en-US',model='gpt-4.1-mini',prompt,transport,signal,now=Date.now}){
 if(model!=='gpt-4.1-mini')throw fail('unsupported_model');
 let response;try{response=await transport.recommend({model,input:{liked:likedTitles,similarTo,locale},schema:structuredClone(schema),prompt,signal});}catch(e){const status=e?.status;const error=fail(signal?.aborted?'aborted':e?.name==='APIConnectionTimeoutError'?'provider_timeout':status===401||status===403?'provider_auth':status===429?'provider_rate_limit':status>=500?'provider_unavailable':e?.name==='AbortError'?'aborted':'provider_error');error.trace=e?.trace;if(status===429||status>=500){const v=e?.headers?.get?.('retry-after')??e?.headers?.['retry-after'];if(typeof v==='string'&&v.trim()){const delay=/^\d+(?:\.\d+)?$/.test(v.trim())?Number(v)*1000:Date.parse(v)-Number(now());if(Number.isFinite(delay))error.retryAfterMs=Math.max(0,delay);}}throw error;}
 const invalid=()=>{const e=fail('invalid_response'),u=response?.usage,n=x=>Number.isSafeInteger(x)&&x>=0?x:null;e.trace=response?.trace;e.usage={input_tokens:n(u?.input_tokens),output_tokens:n(u?.output_tokens),total_tokens:n(u?.total_tokens),input_tokens_details:{cached_tokens:n(u?.input_tokens_details?.cached_tokens)}};e.providerRequestId=typeof response?._request_id==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(response._request_id)?response._request_id:null;return e;};
 if(response?.status!=='completed'||!Array.isArray(response.output)||response.output.some(x=>x.status==='failed'||x.status==='incomplete'||x.error||x.content?.some(c=>c.type==='refusal')))throw invalid();
 const sources=new Set();let searched=false;
 for(const item of response.output){if(item.type==='web_search_call'){if(item.status!=='completed')throw invalid();if(item.action?.type==='search'){for(const s of item.action.sources||[])if(typeof s.url==='string'&&url(s.url))sources.add(s.url);searched=true;}}}
 if(searched)for(const item of response.output)if(item.type==='message')for(const content of item.content||[])for(const annotation of content.annotations||[])if(annotation.type==='url_citation'&&typeof annotation.url==='string'&&url(annotation.url))sources.add(annotation.url);
 if(!searched||!sources.size)throw invalid();let parsed;try{parsed=JSON.parse(response.output_text);}catch{throw invalid();}
 if(!parsed||Object.keys(parsed).join()!=='items'||!Array.isArray(parsed.items)||parsed.items.length<1||parsed.items.length>12)throw invalid();
 const seen=new Set();const proposals=parsed.items.map(i=>{if(!i||Object.keys(i).sort().join()!=='media_type,original_title,reason,source_urls,title,year'||!['movie','tv'].includes(i.media_type)||typeof i.title!=='string'||!i.title.trim()||i.title.length>300||typeof i.original_title!=='string'||!i.original_title.trim()||i.original_title.length>300||!Number.isInteger(i.year)||i.year<1870||i.year>2100||typeof i.reason!=='string'||!i.reason.trim()||i.reason.length>500||!Array.isArray(i.source_urls)||!i.source_urls.length||i.source_urls.length>5||i.source_urls.some(s=>!sources.has(s)))throw invalid();const k=`${i.media_type}:${i.original_title.toLowerCase()}:${i.year}`;if(seen.has(k))throw invalid();seen.add(k);return {title:i.title,original_title:i.original_title,year:i.year,media_type:i.media_type,reason:i.reason,sources:i.source_urls};});
 return {proposals,usage:response.usage??null,providerRequestId:response._request_id??null,trace:response.trace};
}
