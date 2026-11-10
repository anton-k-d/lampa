import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let server, dir, base;
test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lampa-diagnostics-browser-'));
  server = spawn(process.execPath, ['src/main.mjs'], {cwd:process.cwd(), env:{...process.env,PORT:'0',RUNTIME_DIRECTORY:dir}});
  base = await new Promise((resolve,reject)=>{
    server.stdout.on('data', data=>{const match=String(data).match(/Server listening on [^:]+:(\d+)/); if(match) resolve(`http://127.0.0.1:${match[1]}`);});
    server.on('exit', code=>reject(Error(`server exited ${code}`)));
  });
});
test.afterAll(async()=>{server.kill('SIGTERM'); await new Promise(resolve=>server.once('exit',resolve)); await rm(dir,{recursive:true,force:true});});

test('both native upload buttons send diagnostics to the Pi', async ({page})=>{
  test.setTimeout(30000);
  const uploads=[], external=[];
  await page.route('**/*', async route=>{
    const request=route.request(), url=request.url();
    if (url.startsWith(base+'/v1/devices/') && url.endsWith('/logs') && request.method()==='POST') {
      uploads.push(request.postDataJSON());
      return route.continue();
    }
    if(url.startsWith(base+'/')) return route.continue();
    external.push(url); return route.abort();
  });
  await page.addInitScript(()=>{localStorage.setItem('language','ru'); localStorage.setItem('source','cub');});
  await page.goto(base+'/app/');
  await page.waitForFunction(()=>window.appready && window.Lampa?.HomeConfig?.status().deviceId);
  await page.waitForFunction(()=>Lampa.Activity.active()?.component === 'main');
  await page.evaluate(()=>{console.error('diagnostic fixture', new Error('boom token=client-secret')); Lampa.Controller.toggle('console');});
  await page.locator('.console__button[data-action="send"]').dispatchEvent('hover:enter');
  await expect.poll(()=>uploads.length).toBe(1);
  await expect(page.locator('.extensions__item-code')).not.toBeEmpty();
  const id=await page.locator('.extensions__item-code').textContent();
  const stored=await (await page.request.get(base+'/v1/admin/diagnostics/client-logs/'+encodeURIComponent(id))).json();
  expect(stored.entries.some(entry=>entry.level==='error' && entry.message.includes('diagnostic fixture') && entry.message.includes('boom') && entry.message.includes('Error:'))).toBe(true);
  expect(JSON.stringify(stored)).not.toContain('client-secret');
  await page.evaluate(()=>{Lampa.Console.close(); if(!Lampa.Settings.render(true).isConnected) document.body.appendChild(Lampa.Settings.render(true)); Lampa.Settings.create('more');});
  await page.locator('.settings-param[data-name="export"]').dispatchEvent('hover:enter');
  await expect.poll(()=>uploads.length).toBe(2);
  expect(uploads[0].schemaVersion).toBe(1);
  expect(uploads[0].entries.some(entry=>entry.level==='error' && entry.message.includes('diagnostic fixture'))).toBe(true);
  expect(JSON.stringify(uploads)).not.toContain('client-secret');
  expect(external.some(url=>url.includes('/api/lampa/logs/write'))).toBe(false);
});
