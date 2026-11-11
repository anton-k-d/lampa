import { ConfigError } from '../config/errors.mjs';
export async function diagnosticRoute(req,path,url,diagnostics,body,recommendationService){
 const device=/^\/v1\/devices\/([^/]+)\/logs$/.exec(path);
 if(device&&req.method==='POST')return {status:201,body:diagnostics.addClient(decodeURIComponent(device[1]),await body())};
 if(!path.startsWith('/v1/admin/diagnostics/'))return null;
 const limitText=url.searchParams.get('limit');if(limitText!==null&&!/^(?:[1-9]|[1-9]\d|100)$/.test(limitText))throw new ConfigError('BAD_REQUEST','Invalid limit');
 const params={beforeId:url.searchParams.get('beforeId'),limit:limitText===null?50:Number(limitText)};
 if(req.method==='GET'&&path==='/v1/admin/diagnostics/client-logs')return {body:diagnostics.listClients({...params,deviceId:url.searchParams.get('deviceId')})};
 const detail=/^\/v1\/admin\/diagnostics\/client-logs\/([^/]+)$/.exec(path);
 if(req.method==='GET'&&detail)return {body:diagnostics.getClient(detail[1])};
 if(req.method==='GET'&&path==='/v1/admin/diagnostics/ai')return {body:diagnostics.listAI({...params,kind:url.searchParams.get('kind'),status:url.searchParams.get('status')})};
 if(req.method==='GET'&&path==='/v1/admin/diagnostics/ai/summary')return {body:diagnostics.summary()};
 if(req.method==='GET'&&path==='/v1/admin/diagnostics/ai/models')return {body:{models:['gpt-4.1-mini','gpt-4.1','gpt-4.1-nano']}};
 const ai=/^\/v1\/admin\/diagnostics\/ai\/([^/]+)(\/(?:replay|preview|comparisons))?$/.exec(path);
 if(ai&&req.method==='GET'&&!ai[2])return {body:diagnostics.getAI(ai[1])};
 if(ai&&req.method==='GET'&&ai[2]==='/comparisons')return {body:diagnostics.listComparisons(ai[1],params)};
 if(ai&&req.method==='POST'&&ai[2]==='/preview'&&recommendationService){const input=await body();if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new ConfigError('BAD_REQUEST','Invalid preview request');return {body:await recommendationService.previewAI(ai[1])};}
 if(ai&&req.method==='POST'&&ai[2]==='/replay'&&recommendationService){const input=await body();if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||typeof input.model!=='string')throw new ConfigError('BAD_REQUEST','Invalid replay request');return {body:await recommendationService.replayAI(ai[1],req.headers['idempotency-key'],input.model)};}
 return null;
}
