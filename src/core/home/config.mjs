const stringFields = ['source','jackett_url','jackett_key','jackett_url_two','jackett_key_two','parser_torrent_type','parser_use_link','torrserver_url','torrserver_url_two','torrserver_use_link','tmdb_lang'];
const booleanFields = ['parser_use','torrserver_auth','torrserver_preload','torrserver_savedb','animation'];
const own = (object,key) => Object.prototype.hasOwnProperty.call(object,key);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value,keys) => object(value) && Object.keys(value).every(key => keys.indexOf(key) !== -1);
function validUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) return false;
    try {
        const url = new URL(value);
        return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && value.indexOf('?') === -1 && value.indexOf('#') === -1;
    } catch (e) { return false; }
}
function validSnapshot(value,id) {
    if (!exact(value,['schemaVersion','deviceId','revisions','settings','metadata','unsupported']) || value.schemaVersion !== 1 || value.deviceId !== id) return false;
    if (!exact(value.revisions,['global','device']) || !['global','device'].every(key => Number.isSafeInteger(value.revisions[key]) && value.revisions[key] >= 0)) return false;
    if (!exact(value.settings,stringFields.concat(booleanFields))) return false;
    for (const key of Object.keys(value.settings)) {
        const setting = value.settings[key];
        if (booleanFields.indexOf(key) !== -1) { if (typeof setting !== 'boolean') return false; }
        else if (typeof setting !== 'string' || setting.length > 16384) return false;
        if (key === 'source' && setting !== 'tmdb') return false;
        if (/^(jackett|torrserver)_url/.test(key) && setting !== '' && !validUrl(setting)) return false;
    }
    if (value.metadata !== null && (!exact(value.metadata,['baseUrl']) || !validUrl(value.metadata.baseUrl))) return false;
    return Array.isArray(value.unsupported) && value.unsupported.length <= 16 && value.unsupported.every(key => ['ui.theme','ui.density','metadata.credentialRef'].indexOf(key) !== -1);
}

/** Independent bounded loader; injected dependencies keep failure/offline tests deterministic. */
export function createHomeConfig(options) {
    const storage = options.storage, timeout = options.timeout || 2500;
    const origin = options.origin;
    let id, current = null, etag = '', pending, timer, state = 'local';
    const listeners = [];
    try { id = storage.getItem('lampa_home_device_id'); } catch (e) {}
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id || '')) {
        id = 'tv-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
        try { storage.setItem('lampa_home_device_id',id); } catch (e) {}
    }
    const cacheKey = 'lampa_home_config_v1:' + origin;
    function notify(changed = []) { listeners.slice().forEach(listener => { try { listener(changed); } catch (e) {} }); }
    function apply(value) {
        const previous = current ? current.settings : {};
        const keys = Object.keys(previous).concat(Object.keys(value.settings));
        const changed = keys.filter((key,index) => keys.indexOf(key) === index && previous[key] !== value.settings[key]);
        if ((current && current.metadata ? current.metadata.baseUrl : '') !== (value.metadata ? value.metadata.baseUrl : '')) changed.push('metadata');
        current = value; notify(changed); return changed;
    }
    function refresh() {
        if (pending) return pending;
        let deadline;
        const expired = new Promise((resolve,reject) => { deadline = setTimeout(() => reject(new Error('timeout')),timeout); });
        const work = Promise.resolve().then(() => options.request('/v1/devices/' + id + '/client-config',etag,timeout));
        pending = Promise.race([work,expired]).then(response => {
            let changed = [];
            const previousRevisions = current && current.revisions;
            if (response.status === 304) {
                if (!current) throw new Error('uncached response');
            } else {
                if (response.status !== 200 || !validSnapshot(response.body,id)) throw new Error('invalid response');
                // Persist first; storage failure must not prevent an online session from working.
                try { storage.setItem(cacheKey,JSON.stringify(response.body)); } catch (e) {}
                etag = response.etag || '';
                changed = apply(response.body);
            }
            state = 'online';
            const revisions = current.revisions;
            const revisionChanged = !previousRevisions || previousRevisions.global !== revisions.global || previousRevisions.device !== revisions.device;
            return {outcome: changed.length || revisionChanged ? 'applied' : 'unchanged', revisions, changed};
        }).catch(() => { state = 'offline'; return {outcome:'error'}; }).then(result => {
            clearTimeout(deadline); pending = null; notify(); return result;
        });
        return pending;
    }
    return {
        init() {
            try { const cached = JSON.parse(storage.getItem(cacheKey)); if (validSnapshot(cached,id)) apply(cached); } catch (e) {}
            return refresh();
        },
        refresh,
        startPolling() { if (!timer) timer = setInterval(() => { if (!options.isHidden || !options.isHidden()) refresh(); },30000); },
        stop() { clearInterval(timer); timer = null; },
        subscribe(listener) { listeners.push(listener); return () => { const index = listeners.indexOf(listener); if (index !== -1) listeners.splice(index,1); }; },
        has(key) { return !!current && own(current.settings,key); },
        get(key) { return current && own(current.settings,key) ? current.settings[key] : undefined; },
        metadata() { return current && current.metadata ? current.metadata.baseUrl : ''; },
        deviceId() { return id; },
        status() { return {state,deviceId:id,origin,revisions:current ? current.revisions : null,unsupported:current ? current.unsupported.slice() : []}; }
    };
}

let instance;
function current() {
    if (!instance && typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol)) {
        let storage;
        try { storage = window.localStorage; } catch (e) { storage = {getItem:()=>null,setItem:()=>{}}; }
        instance = createHomeConfig({storage,origin:window.location.origin,isHidden:()=>document.hidden,request(path,etag,timeout) {
            return new Promise((resolve,reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('GET',path,true); xhr.timeout = timeout;
                if (etag) xhr.setRequestHeader('If-None-Match',etag);
                xhr.onload = () => {
                    if (xhr.responseText.length > 65536) return reject(new Error('response too large'));
                    try { resolve({status:xhr.status,etag:xhr.getResponseHeader('ETag'),body:xhr.status === 200 ? JSON.parse(xhr.responseText) : null}); }
                    catch (e) { reject(new Error('invalid response')); }
                };
                xhr.onerror = xhr.ontimeout = () => reject(new Error('unavailable'));
                xhr.send();
            });
        }});
    }
    return instance;
}

const HomeConfig = {
    init(next) {
        const client = current();
        if (!client) return next();
        client.init().then(() => { client.startPolling(); next(); },next);
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange',() => { if (!document.hidden) client.refresh(); });
    },
    has(key) { const client = current(); return client ? client.has(key) : false; },
    get(key) { const client = current(); return client ? client.get(key) : undefined; },
    metadata() { const client = current(); return client ? client.metadata() : ''; },
    status() { const client = current(); return client ? client.status() : {state:'local',deviceId:'',origin:''}; },
    refresh() { const client = current(); return client ? client.refresh() : Promise.resolve({outcome:'error'}); },
    subscribe(listener) { const client = current(); return client ? client.subscribe(listener) : () => {}; }
};
export default HomeConfig;
