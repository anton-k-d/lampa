import { createHash } from 'node:crypto';
export const digestRecords = records => createHash('sha256').update(JSON.stringify(records)).digest('hex');
export function aggregateRecords(snapshots) {
  const byKey=new Map();
  for (const records of snapshots) for (const record of records) {
    let current=byKey.get(record.key);
    if (!current) { current={key:record.key,signals:new Set(),rank:null,lastActivityAt:null}; byKey.set(record.key,current); }
    for (const signal of record.signals) current.signals.add(signal);
    if (record.rank!==null) current.rank=current.rank===null ? record.rank : Math.min(current.rank,record.rank);
    if (record.lastActivityAt && (!current.lastActivityAt || record.lastActivityAt>current.lastActivityAt)) current.lastActivityAt=record.lastActivityAt;
  }
  return [...byKey.values()].map(r=>({...r,signals:[...r.signals].sort()})).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
}
