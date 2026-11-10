import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
let server, dir, base;
test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "lampa-browser-"));
  server = spawn(process.execPath, ["src/main.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: "0", RUNTIME_DIRECTORY: dir },
  });
  base = await new Promise((resolve, reject) => {
    server.stdout.on("data", (data) => {
      const match = String(data).match(/Server listening on [^:]+:(\d+)/);
      if (match) resolve(`http://127.0.0.1:${match[1]}`);
    });
    server.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
});
test.afterAll(async () => {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
  await rm(dir, { recursive: true, force: true });
});
test("сохраняет подключения без раскрытия ключа", async ({ page }) => {
  await page.goto(base + "/admin/");
  await page.getByLabel("TMDB Proxy URL").fill("https://tmdb.example.test");
  await page.getByLabel("Jackett URL").fill("https://jackett.example.test");
  await page.getByLabel("TorrServer URL").fill("https://torr.example.test");
  await page.locator("#jackettKey").fill("synthetic-secret");
  await page.locator("#jackettEnabled").selectOption("true");
  await page.locator("#torrEnabled").selectOption("true");
  await page.getByRole("button", { name: "Проверить" }).click();
  await expect(page.locator("#status")).toContainText("Проверка пройдена");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator("#status")).toContainText("Сохранено");
  await page.reload();
  await expect(page.getByLabel("Jackett URL")).toHaveValue(
    "https://jackett.example.test",
  );
  await expect(page.getByLabel("TMDB Proxy URL")).toHaveValue(
    "https://tmdb.example.test",
  );
  await expect(page.getByLabel("TorrServer URL")).toHaveValue(
    "https://torr.example.test",
  );
  await page.locator("#export").click();
  expect(await page.locator("#transfer").inputValue()).not.toContain(
    "synthetic-secret",
  );
  await expect(page.locator("#jackettKey")).toHaveValue("");
  await expect(page.locator("body")).not.toContainText("synthetic-secret");
});
test("конфликт сохраняет ввод, история откатывает версию", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  const p = await a.newPage(),
    q = await b.newPage();
  await p.goto(base + "/admin/");
  await q.goto(base + "/admin/");
  await expect(p.locator("#status")).toContainText("Открыта");
  await expect(q.locator("#status")).toContainText("Открыта");
  await p.locator("#theme").selectOption("dark");
  await p.locator(".primary").click();
  await expect(p.locator("#status")).toContainText("Сохранено");
  await q.locator("#theme").selectOption("light");
  await q.locator(".primary").click();
  await expect(q.locator("#status")).toContainText("другом окне");
  await expect(q.locator("#theme")).toHaveValue("light");
  await p.locator("#revisions li").last().getByRole("button").click();
  await expect(p.locator("#status")).toContainText("восстановлена");
  await expect(p.locator("#theme")).not.toHaveValue("dark");
  await a.close();
  await b.close();
});
test("устройство наследует общие настройки, адрес проверяется, перенос блокирует заполнители", async ({
  page,
}) => {
  await page.goto(base + "/admin/");
  await expect(page.locator("#status")).toContainText("Открыта");
  await page.locator("#tmdb").fill("bad url");
  await page.locator("#validate").click();
  await expect(page.locator("#tmdb-error")).toContainText("корректный");
  await page.locator("#load").click();
  await expect(page.locator("#status")).toContainText("Открыта");
  await page.locator("#export").click();
  await expect(page.locator("#transfer")).toHaveValue(
    /UNRESOLVED_CREDENTIAL_REF/,
  );
  await page.locator("#import").click();
  await expect(page.locator("#status")).toContainText("заблокирован");
  await page.locator("#scope").selectOption("device");
  await page.locator("#device").fill("tv");
  await page.locator("#load").click();
  await expect(page.locator("#status")).toContainText("Открыта");
  await page.locator("#theme").selectOption("light");
  await page.locator(".primary").click();
  await expect(page.locator("#status")).toContainText("Сохранено");
  await page.locator("#theme").selectOption("");
  await page.locator(".primary").click();
  await expect(page.locator("#status")).toContainText("Сохранено");
  const effective = await (
    await page.request.get(base + "/v1/devices/tv/config")
  ).json();
  const global = await (
    await page.request.get(base + "/v1/admin/config/global")
  ).json();
  expect(effective.values.ui.theme).toBe(
    global.document.values.ui?.theme || "system",
  );
});
test("HTTP origin разрешается отдельно и сохранение работает без randomUUID", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(crypto, "randomUUID", { value: undefined });
  });
  await page.goto(base + "/admin/");
  await expect(page.locator("#status")).toContainText("Открыта");
  await page.locator("#origin").fill("http://192.168.1.7:8090");
  await page.locator("#allow").click();
  await expect(page.locator("#originStatus")).toContainText("разрешён");
  await page.locator("#theme").selectOption("dark");
  await page.locator(".primary").click();
  await expect(page.locator("#status")).toContainText("Сохранено");
});
test("смена области не сохраняет старую форму в новое устройство", async ({
  page,
}) => {
  await page.goto(base + "/admin/");
  await expect(page.locator("#status")).toContainText("Открыта");
  await page.locator("#scope").selectOption("device");
  await page.locator("#device").fill("other");
  await page.locator(".primary").click();
  await expect(page.locator("#status")).toContainText("Сначала откройте");
});
test("повтор после потери ответа сохраняет тот же запрос", async ({
  browser,
}) => {
  const { createServer, request } = await import("node:http");
  let dropped = false,
    secretPosts = 0;
  const attempts = [];
  const proxy = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      if (req.method === "POST" && req.url === "/v1/admin/secrets")
        secretPosts++;
      const target = new URL(base);
      const upstream = request(
        {
          hostname: target.hostname,
          port: target.port,
          path: req.url,
          method: req.method,
          headers: req.headers,
        },
        (answer) => {
          if (req.method === "PUT" && req.url === "/v1/admin/config/global") {
            attempts.push({
              key: req.headers["idempotency-key"],
              match: req.headers["if-match"],
              body: body.toString(),
            });
            if (!dropped) {
              dropped = true;
              res.writeHead(answer.statusCode, {
                "content-type": "application/json",
                "content-length": "10000",
              });
              res.write("{");
              answer.resume();
              answer.on("end", () => res.destroy());
              return;
            }
          }
          res.writeHead(answer.statusCode, answer.headers);
          answer.pipe(res);
        },
      );
      upstream.on("error", () => res.destroy());
      upstream.end(body);
    });
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${proxy.address().port}/admin/`);
    await expect(page.locator("#status")).toContainText("Открыта");
    await page.locator("#jackettKey").fill("retry-synthetic-secret");
    await page.locator(".primary").click();
    await expect(page.locator("#status")).toContainText("fetch");
    await page.locator(".primary").click();
    await expect(page.locator("#status")).toContainText("Сохранено");
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(attempts[1]);
    expect(secretPosts).toBe(1);
    expect(
      JSON.parse(attempts[0].body).values.parser.endpoint.credentialRef,
    ).toMatch(/^secret:/);
    expect(attempts[0].body).not.toContain("retry-synthetic-secret");
  } finally {
    await context.close();
    await new Promise((resolve) => proxy.close(resolve));
  }
});
test("HTML в адресе не исполняется и отклоняется сервером", async ({
  page,
}) => {
  const attack = "https://example.test/<svg/onload=alert(1)>";
  await page.goto(base + "/admin/");
  await expect(page.locator("#status")).toContainText("Открыта");
  await page.locator("#tmdb").fill(attack);
  await page.locator(".primary").click();
  await expect(page.locator("#status")).toContainText("Проверьте настройки");
  await expect(page.locator("svg")).toHaveCount(0);
});
if (process.env.ADMIN_SCREENSHOT_PATH)
  test("снимок панели", async ({ browser }) => {
    const context = await browser.newContext({
      locale: "ru-RU",
      timezoneId: "Europe/Moscow",
      viewport: { width: 1280, height: 1000 },
    });
    const page = await context.newPage();
    await page.goto(base + "/admin/");
    await expect(page.locator("#status")).toContainText("Открыта");
    await page.screenshot({
      path: process.env.ADMIN_SCREENSHOT_PATH,
      fullPage: true,
    });
    await context.close();
  });
test("сохранение доступно без функций защищённого контекста", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.structuredClone = undefined;
    Object.defineProperty(crypto, "randomUUID", { value: undefined });
  });
  await page.goto(base + "/admin/");
  await expect(page.locator("#status")).toContainText("Открыта");
  await page.locator("#theme").selectOption("dark");
  await page.locator("#validate").click();
  await expect(page.locator("#status")).toContainText("Проверка пройдена");
  await page.locator(".primary").click();
  await expect(page.locator("#status")).toContainText("Сохранено");
  await page.locator("#export").click();
  await expect(page.locator("#transfer")).toHaveValue(/schemaVersion/);
});
test("редактирование адреса сохраняет отключённые подключения", async ({
  page,
}) => {
  const current = await (
    await page.request.get(base + "/v1/admin/config/global")
  ).json();
  current.document.values.parser = {
    enabled: false,
    endpoint: { url: "https://old-jackett.example.test", mode: "gateway" },
  };
  current.document.values.torrServer = {
    enabled: false,
    primary: { url: "https://old-torr.example.test", mode: "gateway" },
  };
  const seeded = await page.request.put(base + "/v1/admin/config/global", {
    data: current.document,
    headers: {
      "If-Match": `"r-${current.revision}"`,
      "Idempotency-Key": "disabled-seed",
    },
  });
  expect(seeded.ok()).toBeTruthy();
  await page.goto(base + "/admin/");
  await expect(page.locator("#status")).toContainText("Открыта");
  await page.locator("#jackett").fill("https://new-jackett.example.test");
  await page.locator("#torr").fill("https://new-torr.example.test");
  await page.locator(".primary").click();
  await expect(page.locator("#status")).toContainText("Сохранено");
  const saved = await (
    await page.request.get(base + "/v1/admin/config/global")
  ).json();
  expect(saved.document.values.parser.enabled).toBe(false);
  expect(saved.document.values.parser).not.toHaveProperty("kind");
  expect(saved.document.values.torrServer.enabled).toBe(false);
});
test("история безопасно показывает текст причины из сервера", async ({
  page,
}) => {
  let current = await (
    await page.request.get(base + "/v1/admin/config/global")
  ).json();
  const reason = "<img src=x onerror=alert(1)>";
  if (!current.revision) {
    const seed = await page.request.put(base + "/v1/admin/config/global", {
      data: current.document,
      headers: { "If-Match": '"r-0"', "Idempotency-Key": "reason-seed" },
    });
    current = await seed.json();
  }
  const response = await page.request.post(base + "/v1/admin/config/rollback", {
    data: { scopeKey: "global", targetRevision: current.revision, reason },
    headers: {
      "If-Match": `"r-${current.revision}"`,
      "Idempotency-Key": "html-reason",
    },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto(base + "/admin/");
  await expect(page.locator("#revisions")).toContainText(reason);
  await expect(page.locator("#revisions img")).toHaveCount(0);
});
test("адрес устройства не копирует общее включение службы", async ({
  page,
}) => {
  await page.goto(base + "/admin/");
  await expect(page.locator("#status")).toContainText("Открыта");
  await page.locator("#scope").selectOption("device");
  await page.locator("#device").fill("inherit-enabled");
  await page.locator("#load").click();
  await expect(page.locator("#status")).toContainText("Открыта");
  await page.locator("#jackett").fill("https://device-jackett.example.test");
  await page.locator("#torr").fill("https://device-torr.example.test");
  await page.locator(".primary").click();
  await expect(page.locator("#status")).toContainText("Сохранено");
  const saved = await (
    await page.request.get(base + "/v1/admin/devices/inherit-enabled/config")
  ).json();
  expect(saved.document.values.parser).not.toHaveProperty("enabled");
  expect(saved.document.values.torrServer).not.toHaveProperty("enabled");
});
test("службы можно отключить при удалении адресов и снова включить", async ({
  page,
}) => {
  await page.goto(base + "/admin/");
  await expect(page.locator("#status")).toContainText("Открыта");
  for (const [url, enabled, value] of [
    ["#jackett", "#jackettEnabled", "https://jackett-reset.example.test"],
    ["#torr", "#torrEnabled", "https://torr-reset.example.test"],
  ]) {
    await page.locator(url).fill(value);
    await page.locator(enabled).selectOption("true");
  }
  await page.locator(".primary").click();
  await expect(page.locator("#status")).toContainText("Сохранено");
  for (const id of ["#jackett", "#torr"]) await page.locator(id).fill("");
  await page.locator("#validate").click();
  await expect(page.locator("#status")).toContainText("укажите адрес");
  for (const id of ["#jackettEnabled", "#torrEnabled"])
    await page.locator(id).selectOption("false");
  await page.locator(".primary").click();
  await expect(page.locator("#status")).toContainText("Сохранено");
  let result = await (
    await page.request.get(base + "/v1/admin/config/global")
  ).json();
  expect(result.document.values.parser.enabled).toBe(false);
  expect(result.document.values.parser.endpoint).toBeUndefined();
  expect(result.document.values.torrServer.enabled).toBe(false);
  expect(result.document.values.torrServer.primary).toBeUndefined();
  for (const [url, enabled, value] of [
    ["#jackett", "#jackettEnabled", "https://jackett-again.example.test"],
    ["#torr", "#torrEnabled", "https://torr-again.example.test"],
  ]) {
    await page.locator(url).fill(value);
    await page.locator(enabled).selectOption("true");
  }
  await page.locator(".primary").click();
  await expect(page.locator("#status")).toContainText("Сохранено");
  result = await (
    await page.request.get(base + "/v1/admin/config/global")
  ).json();
  expect(result.document.values.parser.enabled).toBe(true);
  expect(result.document.values.torrServer.enabled).toBe(true);
});

test("origin без схемы показывает пример HTTP", async ({ page }) => {
  await page.goto(base + "/admin/");
  await page.locator("#origin").fill("192.168.88.216:8090");
  await page.locator("#allow").click();
  await expect(page.locator("#originStatus")).toContainText("http://");
  await expect(page.locator("#originStatus")).not.toContainText("192.168.88.216");
});

test("несколько ошибок показаны вместе", async ({ page }) => {
  await page.goto(base + "/admin/");
  await expect(page.locator("#status")).toContainText("Открыта");
  await page.locator("#jackett").fill("http://192.168.1.27:9117");
  await page.locator("#torr").fill("");
  await page.locator("#torrEnabled").selectOption("true");
  page.once("dialog", d => d.accept());
  await page.locator("#validate").click();
  await expect(page.locator("#status")).toContainText("укажите адрес");
});

test("ошибка унаследованного адреса не помечает пустое поле устройства", async ({ page }) => {
  await page.goto(base + "/admin/");
  await expect(page.locator("#status")).toContainText("Открыта");
  await page.locator("#scope").selectOption("device");
  await page.locator("#device").fill("inherited-diagnostic");
  await page.locator("#load").click();
  await expect(page.locator("#status")).toContainText("Открыта");
  await page.route("**/v1/admin/config/validate", route => route.fulfill({json:{valid:false,issues:[{path:"/parser/endpoint/url",code:"url_policy",message:"Endpoint URL violates policy"}]}}));
  await page.locator("#validate").click();
  await expect(page.locator("#status")).toContainText("действующих настройках");
  await expect(page.locator("#jackett-error")).toHaveText("");
});

test("HTTP origins подтверждаются одним диалогом", async ({ page }) => {
  await page.goto(base + "/admin/");
  await expect(page.locator("#status")).toContainText("Открыта");
  await page.locator("#jackett").fill("http://5.35.103.226:49117/api");
  await page.locator("#torr").fill("http://5.35.103.226:49117/other");
  await page.locator("#tmdb").fill("http://public.example:8123/path");
  let count = 0;
  page.on("dialog", async d => {
    count++;

    expect(d.message()).toContain("http://5.35.103.226:49117");
    expect(d.message()).toContain("http://public.example:8123");
    expect(d.message().match(/http:\/\/5\.35\.103\.226:49117/g)).toHaveLength(1);
  await d.accept();
  });
  await page.locator("#validate").click();
  await expect(page.locator("#status")).toContainText("Проверка пройдена");
  await page.locator(".primary").click();
  await expect(page.locator("#status")).toContainText("Сохранено");
  expect(count).toBe(1);
  await page.reload();
  await expect(page.locator("#jackett")).toHaveValue("http://5.35.103.226:49117/api");
});
test("отмена и небезопасный URL не создают записей", async ({ page }) => {
  await page.goto(base + "/admin/");
  await expect(page.locator("#status")).toContainText("Открыта");
  const get = async path => (await page.request.get(base + path)).json();
  const paths = ["/v1/admin/config/global", "/v1/admin/lan-origins", "/v1/admin/secrets/status"];
  const before = await Promise.all(paths.map(get));
  await page.locator("#jackett").fill("http://cancel.example:9117/api");
  await page.locator("#jackettKey").fill("synthetic-secret");
  page.once("dialog", d => d.dismiss());
  await page.locator(".primary").click();
  await expect(page.locator("#status")).toContainText("отмен");
  await page.locator("#tmdb").fill("https://example.test/?token=synthetic-secret#fragment");
  await page.locator(".primary").click();
  await expect(page.locator("#status")).toContainText("адрес");
  await page.locator("#tmdb").fill("http://169.254.169.254/latest");
  await page.locator(".primary").click();
  await expect(page.locator("#status")).toContainText("недопустим");
  await page.locator("#tmdb").fill("http://127.0.0.1:1234");
  await page.locator(".primary").click();
  await expect(page.locator("#status")).toContainText("недопустим");
  expect(await Promise.all(paths.map(get))).toEqual(before);
});
test("ручное разрешение принимает публичный адрес с завершающей косой чертой", async ({ page }) => {
  await page.goto(base + "/admin/");
  await page.locator("#origin").fill("http://5.35.103.226:49118/");
  await page.locator("#allow").click();
  await expect(page.locator("#allowedOrigins")).toContainText("http://5.35.103.226:49118");
});
