import { defaultPrompts } from '../recommendations/settings.mjs';
import { ConfigError } from '../config/errors.mjs';
export async function aiAdminRoute(req,path,{aiSettings,db,recommendationService},body){if(!path.startsWith('/v1/admin/ai/'))return null;
 if(path==='/v1/admin/ai/config'&&req.method==='GET'){const result=aiSettings.read();return {body:{...result,defaultPrompts},etag:`"r-${result.revision}"`};}
 if(path==='/v1/admin/ai/config'&&req.method==='PUT'){const m=/^"r-(0|[1-9]\d*)"$/.exec(req.headers['if-match']??'');if(!m)throw new ConfigError(req.headers['if-match']?'BAD_REQUEST':'PRECONDITION_REQUIRED','If-Match required');const input=await body();if(!input||Object.keys(input).some(k=>!['document','key','removeKey'].includes(k)))throw new ConfigError('BAD_REQUEST','Invalid settings');const result=aiSettings.save(input.document,Number(m[1]),{key:input.key,removeKey:input.removeKey??false});return {body:result,etag:`"r-${result.revision}"`};}
 if(path==='/v1/admin/ai/test'&&req.method==='POST')return {body:await recommendationService.testConnection()};
 if(path==='/v1/admin/ai/status'&&req.method==='GET'){const settings=aiSettings.read();const attempts=db.prepare('SELECT budget_date,count(*) AS attempts FROM ai_attempts GROUP BY budget_date ORDER BY budget_date DESC LIMIT 7').all();const last=db.prepare("SELECT generated_at FROM ai_batches ORDER BY generated_at DESC LIMIT 1").get();const error=db.prepare("SELECT error_code FROM ai_jobs WHERE error_code IS NOT NULL ORDER BY created_at DESC LIMIT 1").get();return {body:{enabled:settings.document.enabled,configured:settings.configured,attempts,lastSuccess:last?.generated_at??null,lastError:error?.error_code??null}};}
 return null;
}
