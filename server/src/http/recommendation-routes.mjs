import { ConfigError } from '../config/errors.mjs';
const validId=/^[A-Za-z0-9_-]{1,128}$/;
const validMutation=/^[A-Za-z0-9._:-]{1,128}$/;
export async function recommendationRoute(req,path,url,{recommendationRepository,recommendationService,aiSettings},body){
 const match=/^\/v1\/devices\/([^/]+)\/recommendations\/(.*)$/.exec(path);if(!match)return null; const deviceId=decodeURIComponent(match[1]), action=match[2];if(!validId.test(deviceId))throw new ConfigError('BAD_REQUEST','Invalid device');
 if(action==='capabilities'&&req.method==='GET'){const a=aiSettings.read();return {body:{enabled:a.document.enabled,state:a.document.enabled?(a.configured?'ready':'not_configured'):'disabled'}};}
 if(action==='signals'&&req.method==='PUT'){const input=await body();if(!input || input.schemaVersion!==1 || Object.keys(input).some(k=>!['schemaVersion','seq','digest','records'].includes(k)))throw new ConfigError('BAD_REQUEST','Invalid snapshot');try{return {body:recommendationRepository.replaceSnapshot({deviceId,seq:input.seq,digest:input.digest,records:input.records})};}catch(e){const codes={INVALID_SIGNALS:'BAD_REQUEST',SNAPSHOT_TOO_LARGE:'TOO_LARGE',SEQUENCE_CONFLICT:'IDEMPOTENCY_MISMATCH',STALE_SEQUENCE:'IDEMPOTENCY_MISMATCH'};throw new ConfigError(codes[e.code]??'BAD_REQUEST','Invalid snapshot');}}
 if(action==='home'&&req.method==='GET')return {body:recommendationService.readHome(deviceId)};
 if(action==='similar'&&req.method==='GET')return {body:recommendationService.readSimilar(deviceId,{type:url.searchParams.get('type'),id:url.searchParams.get('id')})};
 if(action==='home/refresh'&&req.method==='POST' || action==='similar'&&req.method==='POST'){const mutationId=req.headers['idempotency-key'];if(typeof mutationId!=='string'||(!validMutation.test(mutationId)||mutationId.startsWith('auto:')))throw new ConfigError('BAD_REQUEST','Idempotency-Key required'); const result=action==='similar'?recommendationService.requestSimilar({deviceId,seed:await body(),mutationId}):recommendationService.requestHome({deviceId,mutationId});return {status:result.jobId?202:200,body:result};}
 const job=/^jobs\/([A-Za-z0-9-]+)$/.exec(action);if(job&&req.method==='GET')return {body:recommendationService.job(deviceId,job[1])};return null;
}
