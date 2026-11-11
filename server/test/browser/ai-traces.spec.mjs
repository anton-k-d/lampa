import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let server, dir, base;
test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ai-traces-'));
  server = spawn(process.execPath, ['src/main.mjs'], {cwd: process.cwd(), env: {...process.env, PORT:'0', RUNTIME_DIRECTORY:dir}});
  base = await new Promise((resolve, reject) => { server.stdout.on('data', d => { const m = String(d).match(/Server listening on [^:]+:(\d+)/); if (m) resolve(`http://127.0.0.1:${m[1]}`); }); server.on('exit', c => reject(new Error(`server exited ${c}`))); });
});
test.afterAll(async () => { if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(r => server.once('exit', r)); } await rm(dir, {recursive:true, force:true}); });
const raw = '{\n  "text": "<img src=x onerror=alert(1)>"\n}';
const event = (id, model = 'gpt-4.1-mini') => ({id, model, status:'success', inputTokens:1, outputTokens:2, totalTokens:3, latencyMs:42});
const detail = (id, model) => ({event:event(id, model), parentEventId:null, trace:{requestBody:raw, responseBody:raw, httpStatus:200, transportError:null, capture:'http', truncated:false, redacted:false}});
async function setup(page, handler) {
  await page.route('**/v1/admin/diagnostics/ai**', async route => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith('/summary')) return route.fulfill({json:{days:[]}});
    if (u.pathname.endsWith('/models')) return route.fulfill({json:{models:['gpt-4.1-mini','gpt-4.1']}});
    if (u.pathname.endsWith('/ai')) return route.fulfill({json:{items:[event('one'),event('old')],nextCursor:null}});
    return handler(route, u);
  });
  await page.goto(base + '/admin/');
  await page.locator('#diagnosticsAiRefresh').click();
}
test('raw trace is safe and comparison runs only on explicit click, with stable retry key', async ({page}) => {
  const attempts=[];
  await page.addInitScript(() => { Object.defineProperty(crypto, 'randomUUID', {value:undefined}); });
  await setup(page, async (route,u) => {
    if (u.pathname.endsWith('/replay')) { attempts.push({body:route.request().postData(),key:route.request().headers()['idempotency-key']}); if (attempts.length===1) return route.abort(); return route.fulfill({json:{eventId:'comparison'}}); }
    const d = detail(u.pathname.split('/').pop(), u.pathname.endsWith('/comparison') ? 'gpt-4.1' : undefined); d.event.citationSummary = {verified:1, partial:2, unverified:3}; return route.fulfill({json:d});
  });
  await page.getByRole('button',{name:'Открыть one'}).click();
  await expect(page.locator('#aiTraceRequest')).toHaveText(raw);
  await expect(page.locator('#aiTraceResponse')).toHaveText(raw);
  await expect(page.locator('#aiTraceMeta')).toContainText('Источники: подтверждено 1, частично 2, не подтверждено 3');
  await expect(page.locator('#aiTraceRequest img')).toHaveCount(0);
  await page.locator('#aiTraceModel').selectOption('gpt-4.1');
  expect(attempts).toHaveLength(0);
  await page.getByRole('button',{name:'Платный запуск сравнения'}).click();
  await expect(page.locator('#aiTraceStatus')).toContainText('Не удалось');
  await page.getByRole('button',{name:'Платный запуск сравнения'}).click();
  await expect(page.locator('#aiComparisonResponse')).toHaveText(raw);
  await expect(page.locator('#aiComparisonMeta')).toContainText('gpt-4.1');
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toEqual(attempts[1]);
  expect(JSON.parse(attempts[0].body)).toEqual({model:'gpt-4.1'});
  expect(attempts[0].key).toBeTruthy();
});
test('old events without trace cannot replay', async ({page}) => {
  await setup(page, route => route.fulfill({json:{event:event('old'), trace:null, parentEventId:null}}));
  await page.getByRole('button',{name:'Открыть old'}).click();
  await expect(page.locator('#aiTraceStatus')).toContainText('нет сохранённой трассы');
  await expect(page.locator('#aiTraceReplay')).toBeDisabled();
  await expect(page.locator('#aiTraceMeta')).not.toContainText('Источники:');
  await expect(page.locator('#aiTraceMeta')).toContainText('Результат подборки не записан');
});
test('model success and failed metadata are separate and raw copy stays intact', async ({page}) => {
  await page.addInitScript(() => { window.copied = []; Object.defineProperty(navigator, 'clipboard', {value:{writeText: async text => window.copied.push(text)}}); });
  await setup(page, route => {
    const d = detail('one'); d.event.pipeline = {stage:'metadata', state:'failed', errorCode:'METADATA_TIMEOUT', selection:null};
    return route.fulfill({json:d});
  });
  await page.getByRole('button',{name:'Открыть one'}).click();
  await expect(page.locator('#aiTraceMeta')).toContainText('Модель: success');
  await expect(page.locator('#aiTraceMeta')).toContainText('модель ответила, но TMDB');
  await expect(page.locator('#aiTraceMeta')).toContainText('METADATA_TIMEOUT');
  await expect(page.locator('#aiTraceRequest')).toHaveText(raw);
  await page.locator('#aiTraceCopy').click();
  await expect.poll(() => page.evaluate(() => window.copied)).toEqual([raw]);
});
test('partial pipeline counts are explained and untrusted codes remain text', async ({page}) => {
  await setup(page, route => {
    const d = detail('one'); d.event.pipeline = {stage:'complete', state:'ready', errorCode:'<img src=x onerror=alert(1)>', selection:{requested:10, proposed:10, resolved:9, excluded:2, returned:7, unresolved:1}};
    return route.fulfill({json:d});
  });
  await page.getByRole('button',{name:'Открыть one'}).click();
  const meta = page.locator('#aiTraceMeta');
  await expect(meta).toContainText('запрошено 10');
  await expect(meta).toContainText('показано 7');
  await expect(meta).toContainText('исключено 2');
  await expect(meta).toContainText('не сопоставлено 1');
  await expect(meta.locator('img')).toHaveCount(0);
});
test('switching events ignores stale details and truncated traces cannot replay', async ({page}) => {
  let release; const delayed = new Promise(r => { release = r; });
  await setup(page, async (route,u) => {
    if (u.pathname.endsWith('/one')) { await delayed; return route.fulfill({json:detail('one')}).catch(() => {}); }
    const d = detail('old'); d.trace.truncated = true;
    return route.fulfill({json:d});
  });
  await page.getByRole('button',{name:'Открыть one'}).click();
  await page.getByRole('button',{name:'Открыть old'}).click();
  await expect(page.locator('#aiTraceMeta')).toContainText('old');
  release();
  await expect(page.locator('#aiTraceReplay')).toBeDisabled();
  await expect(page.locator('#aiTraceStatus')).toContainText('обрезана');
  await expect(page.locator('#aiTraceMeta')).not.toContainText('one');
});
test('pending replay blocks duplicate clicks and reports a failed event', async ({page}) => {
  let release, posts = 0; const delayed = new Promise(r => { release = r; });
  await setup(page, async (route,u) => {
    if (u.pathname.endsWith('/replay')) { posts++; await delayed; return route.fulfill({json:{eventId:'failed'}}); }
    const d = detail(u.pathname.split('/').pop());
    if (d.event.id === 'failed') { d.event.status = 'failed'; d.trace.responseBody = 'provider error'; d.trace.httpStatus = 500; }
    return route.fulfill({json:d});
  });
  await page.getByRole('button',{name:'Открыть one'}).click();
  await page.locator('#aiTraceReplay').click();
  await expect(page.locator('#aiTraceReplay')).toBeDisabled();
  expect(posts).toBe(1);
  release();
  await expect(page.locator('#aiComparisonResponse')).toHaveText('provider error');
  await expect(page.locator('#aiTraceStatus')).toContainText('ошибкой');
});
test('running comparison is reported as pending', async ({page}) => {
  await setup(page, async (route,u) => {
    if (u.pathname.endsWith('/replay')) return route.fulfill({json:{eventId:'running'}});
    const d = detail(u.pathname.split('/').pop());
    if (d.event.id === 'running') d.event.status = 'running';
    return route.fulfill({json:d});
  });
  await page.getByRole('button',{name:'Открыть one'}).click();
  await page.locator('#aiTraceReplay').click();
  await expect(page.locator('#aiTraceStatus')).toContainText('ещё выполняется');
});

test('event actions stay compact and details open in view with a return action', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});
  await setup(page, route => route.fulfill({json:detail('one')}));
  const button = page.getByRole('button',{name:'Открыть one',exact:true});
  await expect(button).toHaveText('Подробнее');
  await button.click();
  await expect(page.locator('#aiTracePanel')).toBeInViewport();
  await expect(page.locator('#aiTracePanel')).toBeFocused();
  await page.getByRole('button',{name:'К событию'}).click();
  await expect(button).toBeFocused();
  expect(await page.locator('main').evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(1300);
});

test('snapshot cards, comparison history and explicit reconstruction remain read-only until requested', async ({page}) => {
  const posts=[];
  const snapshot={schemaVersion:1,mode:'generation',state:'ready',capturedAt:'2026-11-11T00:00:00Z',items:[{status:'included',proposal:{title:'<script>Title</script>',year:2020,media_type:'movie'},card:{title:'<script>Title</script>',vote_average:7},posterUrl:'/broken-poster.jpg',reason:'<img> reason',sources:[],citationStatus:'unverified'},{status:'excluded',proposal:{title:'Excluded'},posterUrl:'/good-poster.png',reason:'Already seen',citationStatus:'verified',exclusionCode:'WATCHED'}]};
  await setup(page, (route,u) => {
    if (route.request().method()==='POST') { posts.push(u.pathname); return route.fulfill({json:{eventId:'one',result:{...snapshot,mode:'reconstructed'}}}); }
    if (u.pathname.endsWith('/comparisons')) return route.fulfill({json:{items:[event('child','gpt-4.1')],nextCursor:null}});
    const d=detail(u.pathname.split('/').pop()); if (d.event.id==='one') d.result=snapshot; return route.fulfill({json:d});
  });
  await page.route('**/broken-poster.jpg', route => route.abort());
  await page.route('**/good-poster.png', route => route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aS8AAAAASUVORK5CYII=', 'base64')}));
  await page.getByRole('button',{name:'Открыть one'}).click();
  await expect(page.locator('#aiOriginalCards')).toContainText('<script>Title</script>');
  await expect(page.locator('#aiOriginalCards .ai-result-poster').first().locator('img')).toHaveCount(0);
  await expect(page.locator('#aiOriginalCards .ai-result-poster').first()).toHaveText('Нет постера');
  await expect(page.locator('#aiOriginalCards .ai-result-poster').nth(1).locator('img')).toBeVisible();
  await expect(page.locator('#aiOriginalCards .ai-result-poster').nth(1).locator('span')).toBeHidden();
  await expect(page.locator('#aiOriginalCards')).toContainText('<img> reason');
  await expect(page.locator('#aiOriginalCards script, #aiOriginalCards img[src="x"]')).toHaveCount(0);
  await page.setViewportSize({width:1440,height:900});
  await page.locator('#aiTracePanel').screenshot({path:'/tmp/results-admin-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await page.locator('#aiTracePanel').screenshot({path:'/tmp/results-admin-mobile.png'});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.locator('#aiResultFilter').selectOption('excluded');
  await expect(page.locator('#aiOriginalCards')).toContainText('Already seen');
  await expect(page.locator('#aiOriginalCards')).not.toContainText('<img> reason');
  await page.locator('#aiHistorySelect').selectOption('child');
  await expect(page.locator('#aiComparisonMeta')).toContainText('child');
  expect(posts).toEqual([]);
  await page.locator('#aiComparisonPreview').click();
  await expect.poll(()=>posts.length).toBe(1);
  expect(posts[0]).toContain('/child/preview');
});

test('finishing replay preserves a selected older comparison and refreshes history', async ({page}) => {
  let release, posts=0, finished=false; const gate=new Promise(r => { release=r; });
  await setup(page, async (route,u) => {
    if (u.pathname.endsWith('/comparisons')) return route.fulfill({json:{items:finished ? [event('new'),event('previous')] : [event('previous')],nextCursor:null}});
    if (u.pathname.endsWith('/replay')) { posts++; await gate; finished=true; return route.fulfill({json:{eventId:'new'}}); }
    return route.fulfill({json:detail(u.pathname.split('/').pop())});
  });
  await page.getByRole('button',{name:'Открыть one'}).click();
  await expect(page.locator('#aiHistorySelect option[value="previous"]')).toHaveCount(1);
  await page.locator('#aiTraceReplay').click();
  await page.locator('#aiHistorySelect').selectOption('previous');
  await expect(page.locator('#aiComparisonMeta')).toContainText('previous');
  release();
  await expect(page.locator('#aiTraceStatus')).toContainText('Сравнение завершено');
  await expect(page.locator('#aiHistorySelect option[value="new"]')).toHaveCount(1);
  await expect(page.locator('#aiHistorySelect')).toHaveValue('previous');
  await expect(page.locator('#aiComparisonMeta')).toContainText('previous');
  expect(posts).toBe(1);
});
