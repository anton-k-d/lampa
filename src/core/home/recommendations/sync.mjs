export function createRecommendationSync({storage,deviceId,read,normalize,put,delay=10000}) {
    const key='lampa_ai_snapshot_v1:'+deviceId;
    let state={seq:0,digest:null,outbox:null}, timer, pending, detail={state:"not_ready",skipped:0};
    try { const saved=JSON.parse(storage.getItem(key)); if(saved && Number.isSafeInteger(saved.seq)) state=saved; } catch(e) {}
    function save(){ storage.setItem(key,JSON.stringify(state)); }
    function semantic(records){return JSON.stringify(records.map(record=>{const copy={...record};delete copy.lastActivityAt;return copy}));}
    async function run(){
        const normalized=await normalize(read());
        const records=normalized.records;
        detail={state:"syncing",skipped:normalized.skipped || 0};
        if(!Array.isArray(records) || records.length>1000) throw Error('SNAPSHOT_TOO_LARGE');
        const body={schemaVersion:1,seq:state.seq+1,digest:normalized.digest,records};
        if(new TextEncoder().encode(JSON.stringify(body)).length>192*1024) throw Error('SNAPSHOT_TOO_LARGE');
        // Finish an earlier operation first: the server may already have accepted it.
        if(state.outbox){
            const response=await put(state.outbox);
            if(response.acceptedSeq!==state.outbox.seq) throw Error('snapshot not accepted');
            state.seq=state.outbox.seq; state.digest=state.outbox.digest; state.semantic=semantic(state.outbox.records); state.outbox=null; save();
        }
        if(state.digest===normalized.digest || state.semantic===semantic(records)) {detail.state="ready"; return;}
        body.seq=state.seq+1; state.outbox=body; save();
        const response=await put(body);
        if(response.acceptedSeq!==body.seq) throw Error('snapshot not accepted');
        state.seq=body.seq; state.digest=body.digest; state.semantic=semantic(body.records); state.outbox=null; save(); detail.state="ready";
    }
    function flush(){ if(!pending) pending=run().then(v=>{pending=null;return v},e=>{pending=null;detail.state=e.message || "error";throw e}); return pending; }
    return {flush,status(){return detail},schedule(){clearTimeout(timer);timer=setTimeout(()=>flush().catch(()=>{}),delay)},stop(){clearTimeout(timer)}};
}
