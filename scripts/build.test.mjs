import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, chmodSync, copyFileSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const runner = resolve('scripts/build.mjs');
const checker = resolve('scripts/check-build.mjs');
function invoke(script, cwd, ...args) { return spawnSync(process.execPath, [script, ...args], {cwd, encoding: 'utf8'}); }
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'lampa-build-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  const output = join(root, 'build/github/lampa');
  for (const [name, data] of Object.entries({'index.html':'<link href="css/app.css?v=1"><script src="vendor/a.js"></script>', 'app.min.js':'bundle', 'css/app.css':'css', 'lang/en.js':'language', 'vendor/a.js':'vendor'})) {
    const file = join(output, name); mkdirSync(join(file, '..'), {recursive:true}); writeFileSync(file, data);
  }
  return {root, output};
}
test('unknown targets are rejected by runner and checker', t => {
  const {root} = fixture(t);
  assert.notEqual(invoke(runner, root, 'unknown').status, 0);
  assert.notEqual(invoke(checker, root, 'unknown').status, 0);
});
test('checker accepts a complete output tree', t => {
  const {root} = fixture(t);
  utimesSync(join(root, 'build/github/lampa/index.html'), new Date(0), new Date(0));
  assert.equal(invoke(checker, root, 'web', '--since', String(Date.now() - 10000)).status, 0);
});
test('checker rejects a missing icon referenced by a web manifest', t => {
  const {root, output} = fixture(t);
  writeFileSync(join(output, 'index.html'), '<link rel="manifest" href="icons/site.webmanifest">');
  mkdirSync(join(output, 'icons')); writeFileSync(join(output, 'icons/site.webmanifest'), JSON.stringify({icons:[{src:'missing.png'}]}));
  assert.notEqual(invoke(checker, root, 'web').status, 0);
});
test('checker rejects missing and empty bundles', t => {
  const {root, output} = fixture(t); const bundle = join(output, 'app.min.js');
  rmSync(bundle); assert.notEqual(invoke(checker, root, 'web').status, 0);
  writeFileSync(bundle, ''); assert.notEqual(invoke(checker, root, 'web').status, 0);
});
test('checker rejects missing referenced assets and stale output', t => {
  const {root, output} = fixture(t);
  rmSync(join(output, 'vendor/a.js')); assert.notEqual(invoke(checker, root, 'web').status, 0);
  writeFileSync(join(output, 'vendor/a.js'), 'vendor');
  assert.notEqual(invoke(checker, root, 'web', '--since', String(Date.now() + 10000)).status, 0);
});
test('runner rejects invalid epoch and propagates gulp failures', t => {
  const {root} = fixture(t); const gulp = join(root, 'node_modules/.bin/gulp');
  mkdirSync(join(gulp, '..'), {recursive:true}); writeFileSync(gulp, '#!/bin/sh\nexit 23\n'); chmodSync(gulp, 0o755);
  const invalid = spawnSync(process.execPath, [runner, 'web'], {cwd:root, env:{...process.env, SOURCE_DATE_EPOCH:'invalid'}, encoding:'utf8'});
  assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /SOURCE_DATE_EPOCH/);
  const failed = invoke(runner, root, 'web'); assert.notEqual(failed.status, 0);
});

test('runner reports a real Rollup resolution error', t => {
  const {root} = fixture(t);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/app.js'), "import './missing-module.js';\n");
  copyFileSync(resolve('gulpfile.js'), join(root, 'gulpfile.js'));
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  const result = invoke(runner, root, 'web');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /missing-module/);
});

test('runner fails when the checker is killed by a signal', t => {
  const {root} = fixture(t);
  const gulp = join(root, 'node_modules/.bin/gulp');
  mkdirSync(join(gulp, '..'), {recursive:true}); writeFileSync(gulp, '#!/bin/sh\nexit 0\n'); chmodSync(gulp, 0o755);
  mkdirSync(join(root, 'scripts')); writeFileSync(join(root, 'scripts/check-build.mjs'), "process.kill(process.pid, 'SIGTERM');\n");
  assert.notEqual(invoke(runner, root, 'web').status, 0);
});

test('checker validates metadata assets and browser configuration tiles', t => {
  const {root, output} = fixture(t);
  writeFileSync(join(output, 'index.html'), '<meta property="og:image" content="og.png"><meta content="icons/browserconfig.xml" name="msapplication-config">');
  mkdirSync(join(output, 'icons'));
  writeFileSync(join(output, 'icons/browserconfig.xml'), '<browserconfig><tile><square150x150logo src="icons/mstile.png"/></tile></browserconfig>');
  assert.notEqual(invoke(checker, root, 'web').status, 0);
  writeFileSync(join(output, 'og.png'), 'image');
  assert.notEqual(invoke(checker, root, 'web').status, 0);
  writeFileSync(join(output, 'icons/mstile.png'), 'tile');
  assert.equal(invoke(checker, root, 'web').status, 0);
  rmSync(join(output, 'icons/browserconfig.xml'));
  assert.notEqual(invoke(checker, root, 'web').status, 0);
});

test('finite preparation stages generated styles and languages without modifying public inputs', t => {
  const {root} = fixture(t);
  copyFileSync(resolve('gulpfile.js'), join(root, 'gulpfile.js'));
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  for (const [name, content] of Object.entries({
    'src/app.js': 'console.log("fixture");',
    'src/sass/app.scss': '$color: red; .fixture { color: $color; }',
    'src/lang/en.js': 'new language',
    'public/css/app.css': 'original css',
    'public/lang/en.js': 'original language'
  })) {
    const file = join(root, name); mkdirSync(join(file, '..'), {recursive:true}); writeFileSync(file, content);
  }
  const result = spawnSync(join(root, 'node_modules/.bin/gulp'), ['prepare'], {cwd:root, env:{...process.env, LAMPA_BUILD:'1'}, encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(root, 'public/css/app.css'), 'utf8'), 'original css');
  assert.equal(readFileSync(join(root, 'public/lang/en.js'), 'utf8'), 'original language');
  assert.match(readFileSync(join(root, 'dest/staging/css/app.css'), 'utf8'), /red/);
  assert.equal(readFileSync(join(root, 'dest/staging/lang/en.js'), 'utf8'), 'new language');
});
