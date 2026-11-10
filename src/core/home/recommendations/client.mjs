import HomeConfig from '../config.mjs';
import {normalizeSignals} from './signals.mjs';
import {createRecommendationSync} from './sync.mjs';
let sync, capability={enabled:false,state:'disabled'}, capabilityFlight, homeFlight;
function request(method,path,body,mutation){
    return new Promise((resolve,reject)=>{
        const id=HomeConfig.status().deviceId;
        if(!id) return reject(Error('device unavailable'));
        const xhr=new XMLHttpRequest(); xhr.open(method,'/v1/devices/'+encodeURIComponent(id)+'/recommendations'+path,true); xhr.timeout=5000;
        if(body) xhr.setRequestHeader('Content-Type','application/json');
        if(mutation) xhr.setRequestHeader('Idempotency-Key',mutation);
        xhr.onload=()=>{try {const data=JSON.parse(xhr.responseText); if(xhr.status<200||xhr.status>=300) throw Error(data.error?.code||'request failed'); resolve(data);} catch(e){reject(e)}};
        xhr.onerror=xhr.ontimeout=()=>reject(Error('unavailable')); xhr.send(body?JSON.stringify(body):null);
    });
}
function mutation(){return 'tv-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)}
function notify(message){if(typeof Lampa!=='undefined' && Lampa.Noty) Lampa.Noty.show(message)}
async function poll(jobId,quiet=true,alive=()=>true){
    for(let i=0;i<60;i++){
        await new Promise(resolve=>setTimeout(resolve,2000));
        if(!alive()) throw Error('cancelled');
        const job=await request('GET','/jobs/'+encodeURIComponent(jobId));
        if(!alive()) throw Error('cancelled');
        if(job.state==='ready') {if(!quiet) notify('ИИ-подборка готова'); return job;}
        if(job.state==='failed' || job.state==='disabled') throw Error(job.errorCode||job.state);
    }
    throw Error('timeout');
}
export function initRecommendations({Favorite,Timeline,Storage,listener,Account}){
    const id=HomeConfig.status().deviceId; if(!id) return;
    sync=createRecommendationSync({storage:window.localStorage,deviceId:id,read:()=>{if(Account.Permit.sync && !Account.Bookmarks.recommendationReady()) throw Error('NOT_READY');return {favorites:Favorite.all(),timeline:Storage.get(Timeline.filename(),{})}},normalize:normalizeSignals,put:body=>request('PUT','/signals',body)});
    function refreshCapability(){
        if(!capabilityFlight) capabilityFlight=request('GET','/capabilities').then(value=>{capability=value;if(value.enabled) sync.flush().catch(()=>{});return value;}).catch(()=>capability).finally(()=>{capabilityFlight=null});
        return capabilityFlight;
    }
    refreshCapability();
    setInterval(()=>{if(!document.hidden) refreshCapability()},30000);
    listener.follow('state:changed',e=>{if(capability.enabled && (e.target==='favorite'||e.target==='timeline')) sync.schedule()});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden) refreshCapability()});
}
export function capabilities(){return capability}
export function capabilitiesReady(){return capabilityFlight || Promise.resolve(capability)}
export function syncStatus(){return sync ? sync.status() : {state:'not_ready',skipped:0}}
export function getHome(){return request('GET','/home')}
export function getSimilar(seed){return request('GET','/similar?type='+encodeURIComponent(seed.type)+'&id='+encodeURIComponent(seed.id))}
export async function refreshHome(){
    if(homeFlight) return homeFlight;
    homeFlight=(async()=>{try {notify('Обновление ИИ-подборки…'); if(!sync) throw Error('history unavailable'); await sync.flush(); const job=await request('POST','/home/refresh',{},mutation()); notify('ИИ-подборка в очереди'); await poll(job.jobId,false); return await getHome();} catch(e){notify('Не удалось обновить ИИ-подборку: '+e.message);throw e} finally {homeFlight=null}})();
    return homeFlight;
}
export async function waitSimilar(seed,jobId,alive=()=>true){
    await poll(jobId,true,alive);
    if(!alive()) throw Error('cancelled');
    return getSimilar(seed);
}
export async function requestSimilar(seed,onState=()=>{},alive=()=>true){
    if(!sync) throw Error('history unavailable'); await sync.flush();
    if(!alive()) throw Error('cancelled');
    onState('loading'); const result=await request('POST','/similar',seed,mutation());
    if(!alive()) throw Error('cancelled');
    if(result.jobId){onState('queued'); return waitSimilar(seed,result.jobId,alive)}
    return result;
}
export function typedSeed(card){
    if(!card || (card.source && card.source!=='tmdb')) return null;
    const type=card.media_type || (card.first_air_date || card.number_of_seasons ? 'tv' : card.release_date ? 'movie' : '');
    const id=String(card.id || '');
    return /^(movie|tv)$/.test(type) && /^[1-9][0-9]{0,11}$/.test(id) ? {type,id:Number(id)} : null;
}
