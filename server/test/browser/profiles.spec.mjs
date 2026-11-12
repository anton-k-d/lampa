import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let server, dir, base;
test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lampa-profiles-'));
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

test('профиль создаётся, телевизор привязывается, а выбор опроса сохраняется', async ({ page }) => {
  await page.route('**/v1/admin/ai/catalog/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/search')) {
      return route.fulfill({ json: { cards: [{ key: 'tmdb:movie:8', title: 'Поиск', year: 2021, media_type: 'movie', posterUrl: 'https://images.test/s.jpg' }] } });
    }
    const type = url.searchParams.get('type') === 'tv' ? 'tv' : 'movie';
    return route.fulfill({ json: { cards: [{ key: `tmdb:${type}:5`, title: type === 'tv' ? 'Сериал' : 'Фильм', year: 2023, media_type: type, posterUrl: 'https://images.test/v.jpg' }] } });
  });
  expect((await page.request.put(base + '/v1/admin/ai/devices/tv-kid/profile', { data: { profileId: 'home' } })).ok()).toBeTruthy();
  await page.goto(base + '/admin/profiles.html');
  await expect(page.locator('#deviceRows')).toContainText('tv-kid');
  await page.locator('#profileName').fill('Дети');
  await page.getByRole('button', { name: 'Создать профиль' }).click();
  await expect(page.locator('#status')).toContainText('создан');
  await expect(page.locator('#profileRows')).toContainText('Дети');
  await page.getByLabel('Профиль для tv-kid').selectOption({ label: 'Дети' });
  await expect(page.locator('#status')).toContainText('tv-kid');
  await expect(page.getByRole('checkbox', { name: /Фильм/ })).toBeVisible();
  await page.getByRole('checkbox', { name: /Фильм/ }).check();
  await page.locator('#surveyQuery').fill('Король');
  await page.getByRole('button', { name: 'Найти' }).click();
  await expect(page.locator('#surveyGrid')).toContainText('Поиск');
  await page.getByRole('button', { name: 'Сохранить выбор' }).click();
  await expect(page.locator('#surveyStatus')).toContainText('сохранён');
  const picks = await (await page.request.get(base + '/v1/admin/ai/profiles/deti/picks')).json();
  expect(picks.picks.map(pick => pick.key)).toEqual(['tmdb:movie:5']);
  const devices = await (await page.request.get(base + '/v1/admin/ai/devices')).json();
  expect(devices.devices.find(device => device.deviceId === 'tv-kid').profileId).toBe('deti');
  await page.getByRole('button', { name: 'Сгенерировать подборку' }).click();
  await expect(page.locator('#surveyStatus')).toContainText('ИИ-подборки выключены');
});

test('без каталога опрос объясняет, что нужен TMDB Proxy', async ({ page }) => {
  await page.route('**/v1/admin/ai/catalog/**', route => route.fulfill({
    status: 422,
    json: { code: 'METADATA_NOT_CONFIGURED', message: 'Metadata request failed' },
  }));
  await page.goto(base + '/admin/profiles.html');
  await expect(page.locator('#surveyHint')).toContainText('TMDB Proxy');
  await expect(page.locator('#surveyGrid')).toBeEmpty();
});
