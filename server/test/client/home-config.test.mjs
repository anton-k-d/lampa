import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHomeConfig } from '../../../src/core/home/config.mjs';

const memory = () => { const data=new Map(); return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)}; };
const snapshot = (id,settings={}) => ({schemaVersion:1,deviceId:id,revisions:{global:1,device:0},settings,metadata:null,unsupported:[]});
const make = (storage,request,options={}) => createHomeConfig({storage,request,origin:'http://lampa.pi:8080',timeout:20,...options});

test('stable identity, selected overlay and offline last-known-good preserve local values', async () => {
  const storage=memory(); storage.setItem('jackett_key','old-local-key');
  let client;
  client=make(storage,async()=>({status:200,etag:'"one"',body:snapshot(client.deviceId(),{jackett_key:'managed-key',parser_use:true})}));
  await client.init();
  assert.equal(client.get('jackett_key'),'managed-key');
  assert.equal(storage.getItem('jackett_key'),'old-local-key');
  const id=client.deviceId(); client.stop();
  const offline=make(storage,async()=>{throw Error('offline');});
  await offline.init();
  assert.equal(offline.deviceId(),id);
  assert.equal(offline.get('jackett_key'),'managed-key');
  assert.equal(offline.status().state,'offline'); offline.stop();
});

test('invalid responses and 304 retain state; removing ownership restores native fallback', async () => {
  const storage=memory(); let response, calls=0;
  const client=make(storage,async()=>{calls++;return response;});
  response={status:200,etag:'"one"',body:snapshot(client.deviceId(),{torrserver_url:'https://torr.example'})};
  await client.init();
  response={status:200,body:snapshot(client.deviceId(),{unknown_key:'bad'})};
  await client.refresh(); assert.equal(client.get('torrserver_url'),'https://torr.example');
  response={status:304}; await client.refresh(); assert.equal(client.has('torrserver_url'),true);
  response={status:200,etag:'"two"',body:snapshot(client.deviceId())};
  await client.refresh(); assert.equal(client.has('torrserver_url'),false);
  assert.equal(calls,4); client.stop();
});

test('timeout always releases startup and requests are single-flight', async () => {
  const storage=memory(); let calls=0;
  const client=make(storage,()=>{calls++;return new Promise(()=>{});});
  const init=client.init(); await Promise.all([init,client.refresh()]);
  assert.equal(calls,1); assert.equal(client.status().state,'offline'); client.stop();
});

test('unchanged snapshots and 304 do not emit configuration changes', async () => {
  let response;
  const client=make(memory(),async()=>response);
  response={status:200,body:snapshot(client.deviceId(),{animation:false})};
  const changes=[]; client.subscribe(keys=>{if(keys.length)changes.push(keys);});
  await client.init();
  response={status:304}; await client.refresh();
  assert.equal(changes.length,1);
  assert.deepEqual(changes[0],['animation']); client.stop();
});

test('late response after a timeout cannot overwrite a newer configuration', async () => {
  let late, calls=0;
  const client=make(memory(),()=>{
    calls++;
    if(calls===1)return new Promise(resolve=>{late=resolve;});
    return Promise.resolve({status:200,body:snapshot(client.deviceId(),{animation:false})});
  });
  await client.init(); await client.refresh();
  late({status:200,body:snapshot(client.deviceId(),{animation:true})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(client.get('animation'),false); client.stop();
});
