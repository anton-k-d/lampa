import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const target = process.argv[2];
const outputs = {web: 'build/github/lampa', webos: 'build/webos'};
if (!Object.hasOwn(outputs, target) || process.argv.length !== 3) {
  console.error('Usage: node scripts/build.mjs <web|webos>'); process.exit(1);
}
const epoch = process.env.SOURCE_DATE_EPOCH;
if (epoch !== undefined && (!/^\d+$/.test(epoch) || !Number.isSafeInteger(Number(epoch)) || !Number.isFinite(new Date(Number(epoch) * 1000).getTime()))) {
  console.error('Invalid SOURCE_DATE_EPOCH: expected a valid non-negative integer timestamp in seconds'); process.exit(1);
}
rmSync(outputs[target], {recursive:true, force:true});
const since = Date.now() - 2000; // Allow filesystem timestamp resolution.
const result = spawnSync(resolve('node_modules/.bin/gulp'), [target === 'web' ? 'build_github' : 'build_webos'], {stdio:'inherit', env:{...process.env, LAMPA_BUILD:'1'}});
if (result.error) { console.error(result.error.message); process.exit(1); }
if (result.status !== 0) process.exit(result.status || 1);
const check = spawnSync(process.execPath, [resolve('scripts/check-build.mjs'), target, '--since', String(since)], {stdio:'inherit'});
if (check.error) console.error(check.error.message);
if (check.signal) console.error(`Build checker terminated by ${check.signal}`);
process.exit(check.status === 0 ? 0 : (check.status || 1));
