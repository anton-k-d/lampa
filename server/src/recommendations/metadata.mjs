const KEY=/^tmdb:(movie|tv):([1-9][0-9]{0,11})$/;
export function normalizeCard(raw,type) {
  if (!raw || !Number.isSafeInteger(raw.id) || raw.id<1 || raw.id>999999999999 || !['movie','tv'].includes(type)) return null;
  const str=v=>typeof v==='string'?v.slice(0,2000):'';
  return {key:`tmdb:${type}:${raw.id}`,id:raw.id,type,media_type:type,source:'tmdb',...(type==='tv'?{name:str(raw.name||raw.title),original_name:str(raw.original_name||raw.original_title),first_air_date:str(raw.first_air_date||raw.release_date)}:{}),title:str(raw.title||raw.name),original_title:str(raw.original_title||raw.original_name),overview:str(raw.overview),poster_path:typeof raw.poster_path==='string'?raw.poster_path:null,backdrop_path:typeof raw.backdrop_path==='string'?raw.backdrop_path:null,release_date:str(raw.release_date||raw.first_air_date),genre_ids:Array.isArray(raw.genre_ids)?raw.genre_ids.filter(Number.isSafeInteger).slice(0,30):[],vote_average:Number.isFinite(raw.vote_average)?raw.vote_average:0,adult:raw.adult===true};
}
const clip=value=>typeof value==='string'?value.trim().slice(0,80):'';
const named=(list,max)=>(Array.isArray(list)?list:[]).map(item=>clip(typeof item==='string'?item:item?.name)).filter(Boolean).slice(0,max);
export function researchContext(raw){
 const extra={};
 const genres=named(raw?.genres,8);if(genres.length)extra.genres=genres;
 const countries=named(raw?.production_countries,6);if(countries.length)extra.countries=countries;
 const tagline=typeof raw?.tagline==='string'?raw.tagline.trim().slice(0,200):'';if(tagline)extra.tagline=tagline;
 const director=clip(raw?.credits?.crew?.find(person=>person?.job==='Director')?.name)||clip(raw?.created_by?.[0]?.name);if(director)extra.director=director;
 const cast=named(raw?.credits?.cast,5);if(cast.length)extra.cast=cast;
 return extra;
}
export function createMetadataCatalog({baseUrl,fetchImpl=fetch,now=Date.now,cacheLimit=500}) {
  const base=baseUrl.replace(/\/tmdb-proxy\.js\/?$/,'').replace(/\/+$/,'');
  const cache=new Map(); let active=0; const queue=[];
  function bounded(promise,signal) {
    if(!signal)return promise;
    if(signal.aborted)return Promise.reject(signal.reason);
    return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
  }
  async function acquire(signal) {
    if(signal?.aborted) throw signal.reason;
    if(active<3){active++;return;}
    await new Promise((resolve,reject)=>{const entry={resolve:()=>{signal?.removeEventListener('abort',abort);resolve();},reject}; const abort=()=>{const i=queue.indexOf(entry);if(i>=0)queue.splice(i,1);reject(signal.reason);}; signal?.addEventListener('abort',abort,{once:true});queue.push(entry);});
  }
  const metadataCode=error=>error?.name==='TimeoutError'||error?.name==='AbortError'||controllerTimedOut(error)?'METADATA_TIMEOUT':'METADATA_UNAVAILABLE';
  const controllerTimedOut=error=>error?.code==='METADATA_TIMEOUT';
  function release(){const next=queue.shift();if(next)next.resolve();else active--;}
  async function get(path,params,signal) {
    const url=new URL(base+path); for(const [k,v] of Object.entries(params)) if(v!=null) url.searchParams.set(k,String(v));
    const key=url.toString(); const hit=cache.get(key); if(hit && hit.until>now()) return hit.value;
    try {await acquire(signal);} catch(error){throw Object.assign(new Error('metadata request failed'),{code:metadataCode(error)});} try {const response=await bounded(fetchImpl(key,{signal}),signal);if(!response.ok) throw Error('metadata request failed'); return await bounded(response.json(),signal);} catch(error){throw Object.assign(new Error('metadata request failed'),{code:metadataCode(error)});} finally {release();}
  }
  function save(key,value,ttl=86400000){cache.delete(key);cache.set(key,{value,until:now()+ttl});while(cache.size>Math.max(1,cacheLimit))cache.delete(cache.keys().next().value);}
  async function getList({type,id,category,locale='en-US',page=1,signal}) {
    if(!['movie','tv'].includes(type)||!['recommendations','similar','discover','trending'].includes(category)||!Number.isInteger(page)||page<1||page>500)throw Error('invalid metadata request');
    if(['recommendations','similar'].includes(category)&&(!Number.isSafeInteger(id)||id<1))throw Error('invalid metadata id');
    const path=category==='discover'?`/3/discover/${type}`:category==='trending'?`/3/trending/${type}/week`:`/3/${type}/${id}/${category}`;
    const cacheKey=JSON.stringify([path,locale,page]);const hit=cache.get(cacheKey);if(hit&&hit.until>now())return hit.value;
    const data=await get(path,{language:locale,page},signal);const cards=(Array.isArray(data.results)?data.results:[]).map(x=>normalizeCard(x,type)).filter(Boolean);save(cacheKey,cards);return cards;
  }
  async function hydrateCards(keys,{locale='en-US',signal}={}) {return (await Promise.all(keys.map(async key=>{const m=KEY.exec(key);if(!m)return null;const cacheKey=JSON.stringify([key,locale,'credits']);const hit=cache.get(cacheKey);if(hit&&hit.until>now())return hit.value;const raw=await get(`/3/${m[1]}/${m[2]}`,{language:locale,append_to_response:'credits'},signal);const card=normalizeCard({...raw,genre_ids:raw.genres?.map(x=>x.id)},m[1]);if(card){Object.assign(card,researchContext(raw));save(cacheKey,card);}return card;}))).filter(Boolean);}
  async function resolveTitles(proposals,{locale='ru-RU',signal}={}) {
    if(!Array.isArray(proposals)||proposals.length>12)throw Error('invalid proposals');
    if(signal?.aborted)throw signal.reason;
    const controller=new AbortController();
    const externalAbort=()=>controller.abort(signal.reason);
    signal?.addEventListener('abort',externalAbort,{once:true});
    const timer=setTimeout(()=>controller.abort(Object.assign(new Error('metadata resolution timed out'),{code:'METADATA_TIMEOUT'})),20000);
    const normalize=value=>typeof value==='string'?value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu,' ').trim():'';
    const matches=(raw,p,type)=>{
      if(!raw||raw.adult===true||!Number.isSafeInteger(raw.id)||raw.id<1||raw.id>999999999999||(raw.media_type&&raw.media_type!==type))return false;
      const date=type==='movie'?raw.release_date:raw.first_air_date;
      if(typeof date!=='string'||!/^\d{4}(?:-|$)/.test(date)||Number(date.slice(0,4))!==p.year)return false;
      const wanted=[normalize(p.title),normalize(p.original_title)].filter(Boolean);
      const names=type==='movie'?[raw.title,raw.original_title]:[raw.name,raw.original_name];
      return names.some(name=>wanted.includes(normalize(name))&&normalize(name)!=='');
    };
    try {
      const selections=await Promise.all(proposals.map(async(p,index)=>{
        try {
          if(!p||!['movie','tv'].includes(p.media_type)||!Number.isInteger(p.year)||!normalize(p.title))return {index,status:'not_found'};
          const type=p.media_type;const queries=[p.original_title||p.title];
          if(normalize(p.original_title)&&normalize(p.original_title)!==normalize(p.title))queries.push(p.title);
          for(const query of queries){
            const path=`/3/search/${type}`;const params={query,language:locale,page:1,include_adult:false,[type==='movie'?'year':'first_air_date_year']:p.year};
            const key=JSON.stringify([path,query,p.year,locale]);let data=cache.get(key);
            if(data&&data.until>now())data=data.value;else {data=await get(path,params,controller.signal);save(key,data,21600000);}
            const found=new Map();for(const raw of Array.isArray(data.results)?data.results:[])if(matches(raw,p,type))found.set(raw.id,raw);
            if(found.size>1)return {index,status:'ambiguous'};
            if(found.size===1)return {index,key:`tmdb:${type}:${found.keys().next().value}`};
          }
          return {index,status:'not_found'};
        } catch(error) {if(signal?.aborted)throw signal.reason;return {index,status:'error',errorCode:metadataCode(error)};}
      }));
      const keys=[...new Set(selections.filter(x=>x.key).map(x=>x.key))];
      const details=new Map(await Promise.all(keys.map(async key=>{try {const cards=await hydrateCards([key],{locale,signal:controller.signal});return [key,{card:cards[0]}];}catch(error){if(signal?.aborted)throw signal.reason;return [key,{errorCode:metadataCode(error)}];}})));
      const items=[],unresolved=[];
      for(const selection of selections){const {index,key,status,errorCode}=selection;if(status){unresolved.push({index,status,...(errorCode?{errorCode}:{})});continue;}const detail=details.get(key);const p=proposals[index];if(detail.errorCode){unresolved.push({index,status:'error',errorCode:detail.errorCode});continue;}const card=detail.card;if(!card||card.key!==key||!matches(card,p,p.media_type)){unresolved.push({index,status:'not_found'});continue;}items.push({proposal:p,card});}
      return {items,unresolved};
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',externalAbort);}
  }
  function imageUrl(path){if(typeof path!=='string'||!/^\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/i.test(path))return null;try{const u=new URL(base);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return null;return base+'/image/t/p/w342'+path;}catch{return null;}}
  return {getList,hydrateCards,resolveTitles,imageUrl};
}
