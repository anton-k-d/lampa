const KEY=/^tmdb:(movie|tv):([1-9][0-9]{0,11})$/;
export async function buildCandidates({profile,seed,locale='en-US',provider,signal}) {
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(new Error('metadata deadline')),20000); timeout.unref?.();
  const abort=()=>controller.abort(signal.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const bounded=promise=>new Promise((resolve,reject)=>{const done=()=>reject(controller.signal.reason);if(controller.signal.aborted)return done();controller.signal.addEventListener('abort',done,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>controller.signal.removeEventListener('abort',done));});
  try {
    const records=Array.isArray(profile?.records)?profile.records:[];const explicit=typeof seed==='string'?seed:seed?.key;
    const excluded=new Set(records.filter(r=>r.signals?.some(s=>['started','completed','abandoned'].includes(s))).map(r=>r.key));
    const strong=r=>r.signals?.some(s=>['liked','bookmarked','planned'].includes(s));
    const recent=(a,b)=>(Number.isSafeInteger(a.rank)?a.rank:Number.MAX_SAFE_INTEGER)-(Number.isSafeInteger(b.rank)?b.rank:Number.MAX_SAFE_INTEGER)||(b.lastActivityAt||'').localeCompare(a.lastActivityAt||'')||String(a.key).localeCompare(String(b.key));
    const priority=r=>r.signals.includes('liked')?0:r.signals.includes('bookmarked')?1:2;
    const positives=records.filter(r=>strong(r)&&!r.signals.includes('abandoned')).sort((a,b)=>priority(a)-priority(b)||recent(a,b));
    const history=records.filter(r=>!strong(r)&&!r.signals?.includes('abandoned')&&r.signals?.some(s=>['history','completed'].includes(s))).sort(recent);
    const selected=[];for(const k of [explicit,...positives.map(r=>r.key),...history.map(r=>r.key)])if(typeof k==='string'&&KEY.test(k)&&!selected.includes(k)){selected.push(k);if(selected.length===8)break;}
    selected.forEach(k=>excluded.add(k));let partial=false;
    const tasks=[];for(const k of selected){const m=KEY.exec(k);for(const category of ['recommendations','similar'])tasks.push({type:m[1],id:Number(m[2]),category,seed:k});}
    for(const type of ['movie','tv'])tasks.push({type,category:'discover'});
    const seedPromise=selected.length?bounded(provider.hydrateCards(selected,{locale,signal:controller.signal})).catch(()=>{partial=true;return [];}):Promise.resolve([]);
    const results=await Promise.all(tasks.map(async task=>{try{return {task,cards:await bounded(provider.getList({...task,locale,signal:controller.signal}))};}catch{partial=true;return {task,cards:[]};}}));
    const seedsResult=await seedPromise;
    if(signal?.aborted)throw signal.reason;
    const map=new Map();const maxLength=Math.max(0,...results.map(r=>r.cards.length));
    for(let index=0;index<maxLength;index++)for(const {task,cards} of results){const card=cards[index];if(!card?.key||!KEY.test(card.key)||card.adult||excluded.has(card.key))continue;let existing=map.get(card.key);if(!existing){if(map.size>=120)continue;existing={...card,relations:[]};map.set(card.key,existing);}if(task.seed&&!existing.relations.includes(task.seed))existing.relations.push(task.seed);}
    let seeds=seedsResult;
    seeds=seeds.map(card=>({...card,signals:records.find(r=>r.key===card.key)?.signals||[]}));
    return {candidates:[...map.values()],seeds,partial};
  } finally {clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
}
