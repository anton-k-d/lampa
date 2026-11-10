import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRecommendationSync} from '../../../src/core/home/recommendations/sync.mjs';
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)}};
test('offline snapshot retries with same sequence; deletion replaces it with a new sequence',async()=>{
 const store=storage(), sent=[]; let records=[{key:'tmdb:movie:1'}], offline=true;
 const sync=createRecommendationSync({storage:store,deviceId:'tv-a',read:()=>({records}),normalize:async x=>({records:x.records,digest:JSON.stringify(x.records)}),put:async body=>{sent.push(body);if(offline)throw Error('offline');return {acceptedSeq:body.seq}}});
 await assert.rejects(sync.flush()); offline=false; await sync.flush(); assert.equal(sent[0].seq,sent[1].seq); assert.deepEqual(sent[1].records,records);
 records=[]; await sync.flush(); assert.equal(sent[2].seq,sent[1].seq+1); assert.deepEqual(sent[2].records,[]);
});
test('oversized snapshot never replaces the last accepted snapshot',async()=>{
 const sent=[]; let large=false;
 const sync=createRecommendationSync({storage:storage(),deviceId:'tv-a',read:()=>({}),normalize:async()=>({records:large?Array(1001).fill({key:'x'}):[],digest:large?'large':'empty'}),put:async body=>{sent.push(body);return {acceptedSeq:body.seq}}});
 await sync.flush(); large=true; await assert.rejects(sync.flush(),/SNAPSHOT_TOO_LARGE/); assert.equal(sent.length,1);
});
test('timeline timestamp changes alone do not create a new snapshot',async()=>{
 const sent=[]; let at='2026-01-01T00:00:00.000Z';
 const sync=createRecommendationSync({storage:storage(),deviceId:'tv-a',read:()=>({}),normalize:async()=>({records:[{key:'tmdb:movie:1',signals:['started'],rank:null,lastActivityAt:at}],digest:at}),put:async body=>{sent.push(body);return {acceptedSeq:body.seq}}});
 await sync.flush(); at='2026-01-01T00:00:10.000Z'; await sync.flush(); assert.equal(sent.length,1);
});
test('unready favorite source cannot publish an empty snapshot',async()=>{
 const sent=[];let ready=false;
 const sync=createRecommendationSync({storage:storage(),deviceId:'tv-a',read:()=>{if(!ready)throw Error('NOT_READY');return {records:[]}},normalize:async x=>({records:x.records,digest:'empty'}),put:async body=>{sent.push(body);return {acceptedSeq:body.seq}}});
 await assert.rejects(sync.flush(),/NOT_READY/);assert.equal(sent.length,0);ready=true;await sync.flush();assert.equal(sent.length,1);
});
