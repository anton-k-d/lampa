import { moscowDate } from './service.mjs';
export function createScheduler({db,settings,service,clock=()=>new Date()}) {
 let timer,working=false,active=Promise.resolve();
 async function runDue(now=clock()) {const config=settings.read().document;if(!config.enabled)return;const local=new Date(+new Date(now)+10800000);const beforeSchedule=local.toISOString().slice(11,16)<config.schedule;const date=moscowDate(now),previous=moscowDate(+new Date(now)-86400000);const profiles=db.prepare('SELECT DISTINCT d.profile_id,d.device_id FROM ai_profile_devices d JOIN ai_device_signals s ON s.device_id=d.device_id GROUP BY d.profile_id').all(); for(const row of profiles){if(beforeSchedule&&db.prepare('SELECT 1 FROM ai_job_mutations WHERE profile_id=? AND mutation_id=?').get(row.profile_id,`auto:${previous}`))continue;try{service.requestHome({deviceId:row.device_id,mutationId:`auto:${date}`,now,automatic:true});}catch{}}}
 async function tick(){if(working)return;working=true;try{await runDue();await service.workOnce();}finally{working=false;}}
 return {runDue,start(){if(timer)return;active=tick();timer=setInterval(()=>{if(!working)active=tick();},1000);timer.unref();},async stop(){clearInterval(timer);timer=null;await active;}};
}

export async function shutdownRecommendationServer({server,scheduler,db}) { await Promise.all([new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())),scheduler.stop()]); db.close(); }
