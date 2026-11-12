import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let server, dir, base;
test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lampa-diagnostics-'));
  server = spawn(process.execPath, ['src/main.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: '0', RUNTIME_DIRECTORY: dir } });
  base = await new Promise((resolve, reject) => { server.stdout.on('data', data => { const m = String(data).match(/Server listening on [^:]+:(\d+)/); if (m) resolve(`http://127.0.0.1:${m[1]}`); }); server.on('exit', code => reject(new Error(`server exited ${code}`))); });
});
test.afterAll(async () => { if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); } await rm(dir, { recursive: true, force: true }); });
test('журналы показывают неизвестные токены, страницы и безопасный текст выгрузки', async ({ page }) => {
  await page.route('**/v1/admin/diagnostics/**', route => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith('/ai/summary')) return route.fulfill({json:{days:[{date:'2026-01-01',attempts:2,success:1,failed:1,inputTokens:null,outputTokens:3,totalTokens:null,cachedTokens:null,cacheHits:0}]}});
    if (u.pathname.endsWith('/ai')) return route.fulfill({json:{items:[{id:'event-1',time:'2026-01-01T00:00:00Z',kind:'home',status:'failed',model:'model',profileId:'profile',deviceId:'tv',inputTokens:null,outputTokens:3,totalTokens:null,latencyMs:50,errorCode:'ERR'}],nextCursor:u.searchParams.has('beforeId') ? null : 'cursor-1'}});
    if (u.pathname.endsWith('/client-logs')) return route.fulfill({json:{items:[{id:'report-1',deviceId:'tv',receivedAt:'2026-01-01T00:00:00Z',entryCount:1,truncated:true,client:{appVersion:'1',platform:'web'}}],nextCursor:null}});
    return route.fulfill({json:{id:'report-1',entries:[{message:'<img src=x onerror=alert(1)>'}]}});
  });
  await page.goto(base + '/admin/');
  await page.getByRole('button',{name:'Обновить журнал ИИ'}).click();
  await expect(page.locator('#diagnosticsSummary')).toContainText('Неизвестно');
  await expect(page.locator('#diagnosticsAiRows')).toContainText('event-1');
  await expect(page.locator('#diagnosticsAiRows')).toContainText('ERR');
  await page.getByRole('button',{name:'Следующая страница журнала ИИ'}).click();
  await expect(page.getByRole('button',{name:'Следующая страница журнала ИИ'})).toBeDisabled();
  await page.getByRole('button',{name:'Обновить выгрузки'}).click();
  await page.getByRole('button',{name:'Открыть report-1'}).click();
  await expect(page.locator('#diagnosticsClientDetail')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#diagnosticsClientDetail img')).toHaveCount(0);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button',{name:'Скачать JSON'}).click();
  const download = await downloadPromise;
  expect(await (await import('node:fs/promises')).readFile(await download.path(), 'utf8')).toContain('<img src=x onerror=alert(1)>');
  await expect(page.getByRole('button',{name:'Скачать JSON'})).toHaveCount(1);
});
test('серверная выгрузка видна в панели', async ({ page }) => {
  const response = await page.request.post(base + '/v1/devices/real-tv/logs', {data:{schemaVersion:1,entries:[{level:'info',message:'real diagnostic'}],client:{appVersion:'1.2',platform:'web'},truncated:false}});
  expect(response.status()).toBe(201);
  const report = await response.json();
  await page.goto(base + '/admin/');
  await page.getByRole('button',{name:'Обновить журнал ИИ'}).click();
  await expect(page.locator('#diagnosticsAiStatus')).toContainText('Событий нет');
  await page.getByRole('button',{name:'Обновить выгрузки'}).click();
  await expect(page.locator('#diagnosticsClientRows')).toContainText('real-tv');
  await page.getByRole('button',{name:`Открыть ${report.id}`}).click();
  await expect(page.locator('#diagnosticsClientDetail')).toContainText('real diagnostic');
});
test('кнопка очищает журнал ИИ', async ({ page }) => {
  page.once('dialog', dialog => dialog.accept());
  await page.goto(base + '/admin/');
  await page.getByRole('button', { name: 'Очистить журнал ИИ' }).click();
  await expect(page.locator('#diagnosticsAiStatus')).toContainText('Журнал очищен');
  await expect(page.locator('#diagnosticsAiRows')).toBeEmpty();
});
