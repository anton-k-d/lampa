import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let server, dir, base;
test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lampa-prompts-'));
  server = spawn(process.execPath, ['src/main.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: '0', RUNTIME_DIRECTORY: dir } });
  base = await new Promise((resolve, reject) => {
    server.stdout.on('data', data => { const match = String(data).match(/Server listening on [^:]+:(\d+)/); if (match) resolve(`http://127.0.0.1:${match[1]}`); });
    server.on('exit', code => reject(new Error(`server exited ${code}`)));
  });
});
test.afterAll(async () => {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(dir, { recursive: true, force: true });
});
test('промпты сохраняются и сбрасываются только после сохранения', async ({ page }) => {
  const get = async () => (await page.request.get(base + '/v1/admin/ai/config')).json();
  const initial = await get();
  let paidRequests = 0;
  page.on('request', request => { if (request.url().includes('/v1/admin/ai/test') || request.url().includes('/v1/ai/')) paidRequests++; });
  await page.goto(base + '/admin/');
  const home = page.getByLabel('Промпт для главной');
  const similar = page.getByLabel('Промпт для похожих подборок');
  await expect(home).toHaveValue(initial.document.prompts?.home || /.+/);
  await expect(similar).toHaveValue(initial.document.prompts?.similar || /.+/);
  const attack = '<img src=x onerror="window.promptAttack=1">';
  await home.fill(attack);
  await similar.fill('Новый промпт похожих');
  await page.getByRole('button', { name: 'Сохранить настройки ИИ' }).click();
  await expect(page.locator('#aiStatus')).toContainText('сохранены');
  await page.reload();
  await expect(home).toHaveValue(attack);
  await expect(similar).toHaveValue('Новый промпт похожих');
  expect(await page.evaluate(() => window.promptAttack)).toBeUndefined();
  await page.getByRole('button', { name: 'Восстановить промпт главной' }).click();
  await page.getByRole('button', { name: 'Восстановить промпт похожих подборок' }).click();
  await expect(home).toHaveValue(initial.defaultPrompts.home);
  await expect(similar).toHaveValue(initial.defaultPrompts.similar);
  await expect(page.locator('#aiStatus')).toContainText('сохраните');
  expect((await get()).document.prompts).toEqual({ home: attack, similar: 'Новый промпт похожих' });
  await page.getByRole('button', { name: 'Сохранить настройки ИИ' }).click();
  await expect(page.locator('#aiStatus')).toContainText('сохранены');
  expect((await get()).document.prompts).toEqual(initial.defaultPrompts);
  expect(paidRequests).toBe(0);
});
test('старый ответ без промптов не отправляет их и отключает сброс', async ({ page }) => {
  await page.route('**/v1/admin/ai/config', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    delete body.document.prompts;
    delete body.defaultPrompts;
    await route.fulfill({ response, json: body });
  });
  await page.goto(base + '/admin/');
  await expect(page.locator('#aiKeyStatus')).not.toBeEmpty();
  await expect(page.getByRole('button', { name: 'Восстановить промпт главной' })).toBeDisabled();
  const request = page.waitForRequest(r => r.url().endsWith('/v1/admin/ai/config') && r.method() === 'PUT');
  await page.getByRole('button', { name: 'Сохранить настройки ИИ' }).click();
  expect((await request).postDataJSON().document).not.toHaveProperty('prompts');
});
test('справка описывает поиск и сигналы для главной', async ({ page }) => {
  await page.goto(base + '/admin/');
  const form = page.locator('#aiForm');
  await expect(form).toContainText('лайки');
  await expect(form).toContainText('web_search');
  await expect(form).toContainText('TMDB');
  await expect(form).not.toContainText('пул кандидатов');
});
