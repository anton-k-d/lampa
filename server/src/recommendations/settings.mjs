import { ConfigError } from '../config/errors.mjs';

export const defaultPrompts = Object.freeze({home:'Ищи в интернете рекомендации для главной страницы, опираясь на явно понравившиеся произведения и предлагая новые открытия.',similar:'Якорь — выбранное произведение (similarTo), оно важнее лайков. Ищи в интернете фильмы и сериалы, похожие именно на него по атмосфере, теме, темпу и сюжету. Лайки учитывай только как вторичный вкус. В reason обязательно назови similarTo и объясни конкретное сходство. Не подменяй якорь первым лайком и не повторяй названия.'});
export const validModelId=model=>typeof model==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(model);
export const defaultAISettings = Object.freeze({schemaVersion:1,enabled:false,model:'gpt-4.1-mini',locale:'ru-RU',timezone:'Europe/Moscow',schedule:'04:00',limits:{profileAttempts:8,serverAttempts:32,manualHome:2,similar:5}});
const fail = (code,message) => { throw new ConfigError(code,message); };
function validate(d) {
 const keys=['schemaVersion','enabled','model','locale','timezone','schedule','limits','prompts'];
 return d && typeof d==='object' && !Array.isArray(d) && Object.keys(d).every(k=>keys.includes(k)) && keys.filter(k=>k!=='prompts').every(k=>Object.hasOwn(d,k)) && (!Object.hasOwn(d,'prompts') || (d.prompts && typeof d.prompts==='object' && !Array.isArray(d.prompts) && Object.keys(d.prompts).sort().join(',')==='home,similar' && Object.values(d.prompts).every(p=>typeof p==='string' && p.length<=4000 && p.trim().length>0))) && d.schemaVersion===1 && typeof d.enabled==='boolean' && validModelId(d.model) && typeof d.locale==='string' && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(d.locale) && d.timezone==='Europe/Moscow' && /^([01]\d|2[0-3]):[0-5]\d$/.test(d.schedule) && d.limits && Object.keys(d.limits).sort().join(',')==='manualHome,profileAttempts,serverAttempts,similar' && Object.values(d.limits).every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1000);
}
export function createAISettings(db, runtimeStore) {
 const get=()=>db.prepare('SELECT revision,document_json FROM ai_settings WHERE id=1').get();
 function internal() { const row=get(); if(!row) return {revision:0,document:{...structuredClone(defaultAISettings),prompts:{...defaultPrompts}},ref:null}; const parsed=JSON.parse(row.document_json); const {openaiCredentialRef,...document}=parsed; return {revision:row.revision,document:{...document,prompts:document.prompts??{...defaultPrompts}},ref:openaiCredentialRef??null}; }
 function read() { const {revision,document,ref}=internal(); return {revision,document,configured:!!(ref && runtimeStore.readSecret(ref))}; }
 function save(document,expectedRevision,{key,removeKey=false}={}) {
  if(!validate(document) || (key!==undefined && (typeof key!=='string'||!key.length)) || typeof removeKey!=='boolean' || (key && removeKey)) fail('INVALID_CONFIG','Invalid AI settings');
  document={...document,prompts:document.prompts?{home:document.prompts.home.trim(),similar:document.prompts.similar.trim()}:{...defaultPrompts}};
  const current=internal(); if(current.revision!==expectedRevision) fail('REVISION_CONFLICT','AI settings changed');
  const ref=removeKey?null:key?runtimeStore.addSecret(key):current.ref;
  db.exec('BEGIN IMMEDIATE'); try { const latest=internal(); if(latest.revision!==expectedRevision) fail('REVISION_CONFLICT','AI settings changed'); const revision=expectedRevision+1; db.prepare('INSERT INTO ai_settings(id,revision,document_json) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,document_json=excluded.document_json').run(revision,JSON.stringify({...document,openaiCredentialRef:ref})); db.exec('COMMIT'); return read(); } catch(e){db.exec('ROLLBACK');throw e;}
 }
 return {read,save,internal,credential:()=>{const {ref}=internal();return ref?runtimeStore.readSecret(ref):null;}};
}
