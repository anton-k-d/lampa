import HomeConfig from '../config.mjs';
import {normalizeSignals} from './signals.mjs';
import {createRecommendationSync} from './sync.mjs';
let sync, capability={enabled:false,state:'disabled'}, capabilityFlight, homeFlight;
const fallbackFailures={
    QUOTA_EXCEEDED:{message:'Лимит ИИ-подборок исчерпан',action:'Лимит обновится в 00:00 МСК; при необходимости обратитесь к администратору',retryable:false},
    NOT_CONFIGURED:{message:'Ключ OpenAI не настроен',action:'Обратитесь к администратору',retryable:false},
    METADATA_NOT_CONFIGURED:{message:'Каталог не настроен',action:'Обратитесь к администратору',retryable:false},
    NO_LIKES:{message:'Недостаточно лайков для подборки',action:'Добавьте лайки фильмам или сериалам',retryable:false},
    NEEDS_HISTORY:{message:'История ещё не синхронизирована',action:'Сначала синхронизируйте историю',retryable:false},
    TIMEOUT:{message:'Время ожидания истекло',action:'Проверьте состояние подборки снова',retryable:false},
    UNAVAILABLE:{message:'Сервис недоступен',action:'Проверьте соединение и попробуйте снова',retryable:false}
};
export function failureDetails(value){
    const failure=value && (value.failure || value.lastError || (value.message && value.action ? value : null));
    if(failure && typeof failure.message==='string' && typeof failure.action==='string') return failure;
    const code=value && (value.code || value.errorCode) || 'UNAVAILABLE';
    return Object.assign({code,stage:'',message:'Не удалось получить подборку',action:'Попробуйте ещё раз',retryable:true},fallbackFailures[code] || {});
}
export function selectionText(data){
    const s=data && data.selection, target=data && data.targetCount || 10;
    if(!s || s.returned>=target) return '';
    return s.returned+' из '+target+' · найдено в каталоге: '+s.resolved+' · исключено: '+s.excluded+' · не найдено: '+s.unresolved;
}
function requestError(code,status,failure,jobId){const e=Error(code || 'UNAVAILABLE');e.code=code || 'UNAVAILABLE';e.status=status;e.failure=failure;e.jobId=jobId;return e}
function request(method,path,body,mutation){
    return new Promise((resolve,reject)=>{
        const id=HomeConfig.status().deviceId;
        if(!id) return reject(Error('device unavailable'));
        const xhr=new XMLHttpRequest(); xhr.open(method,'/v1/devices/'+encodeURIComponent(id)+'/recommendations'+path,true); xhr.timeout=5000;
        if(body) xhr.setRequestHeader('Content-Type','application/json');
        if(mutation) xhr.setRequestHeader('Idempotency-Key',mutation);
        xhr.onload=()=>{try {const data=JSON.parse(xhr.responseText); if(xhr.status<200||xhr.status>=300) throw requestError(data.error?.code,xhr.status,data.failure); resolve(data);} catch(e){reject(e)}};
        xhr.onerror=()=>reject(requestError('UNAVAILABLE',xhr.status)); xhr.ontimeout=()=>reject(requestError('TIMEOUT',xhr.status)); xhr.send(body?JSON.stringify(body):null);
    });
}
function mutation(){return 'tv-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)}
function notify(message){if(typeof Lampa!=='undefined' && Lampa.Noty) Lampa.Noty.show(message)}
async function poll(jobId,quiet=true,alive=()=>true){
    for(let i=0;i<60;i++){
        await new Promise(resolve=>setTimeout(resolve,2000));
        if(!alive()) throw Error('cancelled');
        let job; try {job=await request('GET','/jobs/'+encodeURIComponent(jobId));} catch(e){e.jobId=jobId;throw e}
        if(!alive()) throw Error('cancelled');
        if(job.state==='ready') {if(!quiet) notify('ИИ-подборка готова'); return job;}
        if(job.state==='failed' || job.state==='disabled') throw requestError(job.errorCode||job.state,undefined,job.failure,jobId);
    }
    throw requestError('TIMEOUT',undefined,undefined,jobId);
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
    homeFlight=(async()=>{try {notify('Обновление ИИ-подборки…'); if(!sync) throw Error('history unavailable'); await sync.flush(); const job=await request('POST','/home/refresh',{},mutation()); if(!job.jobId){if(job.state==='no_likes') notify('Добавьте лайки фильмам или сериалам для подборки'); else if(job.state==='needs_history') notify('Сначала синхронизируйте историю'); else if(job.state==='not_configured') notify('Администратор должен настроить ключ OpenAI'); else notify('Подборка пока недоступна'); return job;} notify('ИИ-подборка в очереди'); await poll(job.jobId,false); return await getHome();} catch(e){const f=failureDetails(e); notify(f.message+'. '+f.action+(f.code?' · '+f.code:''));throw e} finally {homeFlight=null}})();
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
