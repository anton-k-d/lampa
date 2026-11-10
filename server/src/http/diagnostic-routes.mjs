import { ConfigError } from '../config/errors.mjs';
export async function diagnosticRoute(req,path,url,diagnostics,body){
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
 return null;
}
