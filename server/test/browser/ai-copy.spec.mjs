import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let server, dir, base;
test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ai-copy-'));
  server = spawn(process.execPath, ['src/main.mjs'], {cwd: process.cwd(), env: {...process.env, PORT:'0', RUNTIME_DIRECTORY:dir}});
  base = await new Promise((resolve, reject) => { server.stdout.on('data', d => { const m = String(d).match(/Server listening on [^:]+:(\d+)/); if (m) resolve(`http://127.0.0.1:${m[1]}`); }); server.on('exit', c => reject(new Error(`server exited ${c}`))); });
});
test.afterAll(async () => { if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(r => server.once('exit', r)); } await rm(dir, {recursive:true, force:true}); });
const raw = '{\r\n  "текст": "ё 🐈",\r  "n": 1\n}', comparison = 'Сравнение\n  без изменений';
const event = id => ({id, model:'gpt-4.1', status:'success'});
const detail = (id, responseBody) => ({event:event(id), parentEventId:null, trace:{requestBody:'request', responseBody, httpStatus:200, truncated:false, redacted:false}});
async function setup(page) {
  const posts = [];
  await page.route('**/v1/admin/diagnostics/ai**', async route => {
    const u = new URL(route.request().url());
    if (route.request().method() === 'POST') { posts.push(u.pathname); return route.fulfill({json:{eventId:'comparison'}}); }
    if (u.pathname.endsWith('/summary')) return route.fulfill({json:{days:[]}});
    if (u.pathname.endsWith('/models')) return route.fulfill({json:{models:['gpt-4.1']}});
    if (u.pathname.endsWith('/ai')) return route.fulfill({json:{items:[event('one'),event('empty')],nextCursor:null}});
    const id = u.pathname.split('/').pop();
    return route.fulfill({json:detail(id, id === 'empty' ? null : id === 'comparison' ? comparison : raw)});
  });
  await page.goto(base + '/admin/'); await page.locator('#diagnosticsAiRefresh').click(); return posts;
}
test('copies exact original and comparison response without paid requests on copy', async ({page}) => {
  await page.addInitScript(() => { window.copied = []; Object.defineProperty(navigator, 'clipboard', {value:{writeText: async text => window.copied.push(text)}}); });
  const posts = await setup(page);
  await expect(page.locator('#aiTraceCopy')).toBeDisabled();
  await page.getByRole('button',{name:'Открыть one'}).click();
  await page.getByRole('button',{name:'Копировать ответ',exact:true}).click();
  await expect(page.locator('#aiTraceCopyStatus')).toContainText('скопирован');
  expect(await page.evaluate(() => window.copied)).toEqual([raw]); expect(posts).toHaveLength(0);
  await page.getByRole('button',{name:'Платный запуск сравнения'}).click();
  await page.getByRole('button',{name:'Копировать ответ сравнения'}).click();
  expect(await page.evaluate(() => window.copied)).toEqual([raw, comparison]); expect(posts).toHaveLength(1);
  await page.getByRole('button',{name:'Открыть empty'}).click();
  await expect(page.getByRole('button',{name:'Копировать ответ',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Копировать ответ сравнения'})).toBeDisabled();
});
test('falls back after clipboard rejection and reports failure honestly', async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {value:{writeText: async () => { throw Error('denied'); }}});
    document.execCommand = () => { const data = window.noClipboardData ? null : new DataTransfer(); const event = new ClipboardEvent('copy', {clipboardData:data, bubbles:true, cancelable:true}); document.dispatchEvent(event); window.fallbackText = data?.getData('text/plain'); return window.fallbackWorks; }; window.fallbackWorks = true;
  });
  await setup(page); await page.getByRole('button',{name:'Открыть one'}).click();
  const button = page.getByRole('button',{name:'Копировать ответ',exact:true}); await button.click();
  await expect(page.locator('#aiTraceCopyStatus')).toContainText('скопирован');
  expect(await page.evaluate(() => window.fallbackText)).toBe(raw); await expect(button).toBeFocused();
  await expect(page.locator('textarea[data-copy-temporary]')).toHaveCount(0);
  await page.evaluate(() => { window.fallbackWorks = false; }); await button.click();
  await expect(page.locator('#aiTraceCopyStatus')).toContainText('Не удалось');
  await page.evaluate(() => { window.fallbackWorks = true; window.noClipboardData = true; }); await button.click();
  await expect(page.locator('#aiTraceCopyStatus')).toContainText('Не удалось');
});
test('ignores copy completion after changing selected event', async ({page}) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', {value:{writeText: () => new Promise(resolve => { window.finishCopy = resolve; })}}); });
  await setup(page); await page.getByRole('button',{name:'Открыть one'}).click();
  await page.getByRole('button',{name:'Копировать ответ',exact:true}).click();
  await page.getByRole('button',{name:'Открыть empty'}).click(); await page.evaluate(() => window.finishCopy());
  await expect(page.locator('#aiTraceCopyStatus')).toBeEmpty();
});
