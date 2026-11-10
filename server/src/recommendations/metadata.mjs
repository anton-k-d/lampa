const KEY=/^tmdb:(movie|tv):([1-9][0-9]{0,11})$/;
export function normalizeCard(raw,type) {
  if (!raw || !Number.isSafeInteger(raw.id) || raw.id<1 || raw.id>999999999999 || !['movie','tv'].includes(type)) return null;
  const str=v=>typeof v==='string'?v.slice(0,2000):'';
  return {key:`tmdb:${type}:${raw.id}`,id:raw.id,type,media_type:type,source:'tmdb',...(type==='tv'?{name:str(raw.name||raw.title),original_name:str(raw.original_name||raw.original_title),first_air_date:str(raw.first_air_date||raw.release_date)}:{}),title:str(raw.title||raw.name),original_title:str(raw.original_title||raw.original_name),overview:str(raw.overview),poster_path:typeof raw.poster_path==='string'?raw.poster_path:null,backdrop_path:typeof raw.backdrop_path==='string'?raw.backdrop_path:null,release_date:str(raw.release_date||raw.first_air_date),genre_ids:Array.isArray(raw.genre_ids)?raw.genre_ids.filter(Number.isSafeInteger).slice(0,30):[],vote_average:Number.isFinite(raw.vote_average)?raw.vote_average:0,adult:raw.adult===true};
}
export function createMetadataCatalog({baseUrl,fetchImpl=fetch,now=Date.now,cacheLimit=500}) {
  const base=baseUrl.replace(/\/tmdb-proxy\.js\/?$/,'').replace(/\/+$/,'');
  const cache=new Map(); let active=0; const queue=[];
  async function acquire(signal) {
    if(signal?.aborted) throw signal.reason;
    if(active<3){active++;return;}
    await new Promise((resolve,reject)=>{const entry={resolve:()=>{signal?.removeEventListener('abort',abort);resolve();},reject}; const abort=()=>{const i=queue.indexOf(entry);if(i>=0)queue.splice(i,1);reject(signal.reason);}; signal?.addEventListener('abort',abort,{once:true});queue.push(entry);});
  }
  function release(){const next=queue.shift();if(next)next.resolve();else active--;}
  async function get(path,params,signal) {
    const url=new URL(base+path); for(const [k,v] of Object.entries(params)) if(v!=null) url.searchParams.set(k,String(v));
    const key=url.toString(); const hit=cache.get(key); if(hit && hit.until>now()) return hit.value;
    await acquire(signal); try {const response=await fetchImpl(key,{signal});if(!response.ok) throw Error('metadata request failed'); return await response.json();} finally {release();}
  }
  function save(key,value){cache.delete(key);cache.set(key,{value,until:now()+86400000});while(cache.size>Math.max(1,cacheLimit))cache.delete(cache.keys().next().value);}
  async function getList({type,id,category,locale='en-US',page=1,signal}) {
    if(!['movie','tv'].includes(type)||!['recommendations','similar','discover','trending'].includes(category)||!Number.isInteger(page)||page<1||page>500)throw Error('invalid metadata request');
    if(['recommendations','similar'].includes(category)&&(!Number.isSafeInteger(id)||id<1))throw Error('invalid metadata id');
    const path=category==='discover'?`/3/discover/${type}`:category==='trending'?`/3/trending/${type}/week`:`/3/${type}/${id}/${category}`;
    const cacheKey=JSON.stringify([path,locale,page]);const hit=cache.get(cacheKey);if(hit&&hit.until>now())return hit.value;
    const data=await get(path,{language:locale,page},signal);const cards=(Array.isArray(data.results)?data.results:[]).map(x=>normalizeCard(x,type)).filter(Boolean);save(cacheKey,cards);return cards;
  }
  async function hydrateCards(keys,{locale='en-US',signal}={}) {return (await Promise.all(keys.map(async key=>{const m=KEY.exec(key);if(!m)return null;const cacheKey=JSON.stringify([key,locale]);const hit=cache.get(cacheKey);if(hit&&hit.until>now())return hit.value;const raw=await get(`/3/${m[1]}/${m[2]}`,{language:locale},signal);const card=normalizeCard({...raw,genre_ids:raw.genres?.map(x=>x.id)},m[1]);if(card)save(cacheKey,card);return card;}))).filter(Boolean);}
  return {getList,hydrateCards};
}
