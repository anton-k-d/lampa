"use strict";
const $ = (id) => document.getElementById(id);
let snapshot,
  revision = 0,
  pending,
  imported,
  loadedScope;
const scopeKey = () =>
  $("scope").value === "global"
    ? "global"
    : `device:${$("device").value.trim()}`;
const configPath = () =>
  scopeKey() === "global"
    ? "/v1/admin/config/global"
    : `/v1/admin/devices/${encodeURIComponent($("device").value.trim())}/config`;
const message = (text) => {
  $("status").textContent = text;
};
async function api(path, options = {}) {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.message || "Ошибка сервера");
    error.code = result.code;
    throw error;
  }
  return result;
}
const json = (method, body, headers = {}) => ({
  method,
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});
function show(doc) {
  const v = doc.values || {};
  $("tmdb").value = v.metadata?.endpoint?.url || "";
  $("locale").value = v.metadata?.locale || "";
  $("jackett").value = v.parser?.endpoint?.url || "";
  $("torr").value = v.torrServer?.primary?.url || "";
  $("jackettEnabled").value =
    v.parser?.enabled === undefined ? "" : String(v.parser.enabled);
  $("torrEnabled").value =
    v.torrServer?.enabled === undefined ? "" : String(v.torrServer.enabled);
  for (const key of ["theme", "density", "animations"])
    $(key).value = v.ui?.[key] === undefined ? "" : String(v.ui[key]);
  for (const key of ["jackettKey", "metadataKey"]) $(key).value = "";
  $("jackettKeyStatus").textContent = v.parser?.endpoint?.credentialRef
    ? "Ключ сохранён."
    : "Ключ не задан.";
  $("metadataKeyStatus").textContent = v.metadata?.endpoint?.credentialRef
    ? "Ключ сохранён."
    : "Ключ не задан.";
  $("removeJackett").checked = $("removeMetadata").checked = false;
}
async function load() {
  if (
    $("scope").value === "device" &&
    !/^[A-Za-z0-9_-]{1,128}$/.test($("device").value.trim())
  ) {
    message("Укажите корректный ID устройства.");
    return;
  }
  try {
    const result = await api(configPath());
    snapshot = result.document;
    revision = result.revision;
    loadedScope = scopeKey();
    pending = imported = undefined;
    show(snapshot);
    message(`Открыта версия ${revision}.`);
    await history();
  } catch (e) {
    message(e.message);
  }
}
const cloneDocument = (value) => JSON.parse(JSON.stringify(value));
function clean(obj, key) {
  if (obj[key] && !Object.keys(obj[key]).length) delete obj[key];
}
function endpoint(values, group, field, url, type) {
  const previous = values[group]?.[field];
  if ((previous?.url || "") === url) return;
  if (!url) {
    if (values[group]) {
      delete values[group][field];
      clean(values, group);
    }
    return;
  }
  values[group] ||= {};
  values[group][field] = {
    ...previous,
    url,
    mode: previous?.mode || "gateway",
  };
  if (type === "metadata") values[group].providerId ||= "tmdb";
}
function documentFromForm() {
  if (scopeKey() !== loadedScope)
    throw new Error("Сначала откройте выбранную область настроек.");
  const doc = cloneDocument(imported || snapshot);
  const v = doc.values;
  endpoint(v, "metadata", "endpoint", $("tmdb").value.trim(), "metadata");
  endpoint(v, "parser", "endpoint", $("jackett").value.trim(), "parser");
  endpoint(v, "torrServer", "primary", $("torr").value.trim(), "torr");
  for (const [id, group] of [
    ["jackettEnabled", "parser"],
    ["torrEnabled", "torrServer"],
  ]) {
    const value = $(id).value;
    if (value) {
      v[group] ||= {};
      v[group].enabled = value === "true";
    } else if (v[group]) {
      delete v[group].enabled;
      clean(v, group);
    }
  }
  if ($("locale").value.trim()) {
    v.metadata ||= {};
    v.metadata.locale = $("locale").value.trim();
  } else if (v.metadata) {
    delete v.metadata.locale;
    clean(v, "metadata");
  }
  v.ui ||= {};
  for (const key of ["theme", "density", "animations"]) {
    const val = $(key).value;
    if (!val) delete v.ui[key];
    else v.ui[key] = key === "animations" ? val === "true" : val;
  }
  clean(v, "ui");
  if ($("removeJackett").checked && v.parser?.endpoint)
    delete v.parser.endpoint.credentialRef;
  if ($("removeMetadata").checked && v.metadata?.endpoint)
    delete v.metadata.endpoint.credentialRef;
  return doc;
}
function validUrls() {
  let valid = true;
  for (const id of ["tmdb", "jackett", "torr"]) {
    const value = $(id).value.trim();
    let ok = true;
    if (value) {
      try {
        const u = new URL(value);
        ok =
          ["http:", "https:"].includes(u.protocol) &&
          !u.username &&
          !u.password && !u.search && !u.hash && !value.includes("?") && !value.includes("#");
      } catch {
        ok = false;
      }
    }
    $(id + "-error").textContent = ok
      ? ""
      : "Введите корректный HTTP или HTTPS URL без имени пользователя, пароля, параметров запроса и фрагмента.";
    $(id).setAttribute("aria-invalid", String(!ok));
    valid &&= ok;
  }
  return valid;
}
async function approveOrigins(doc) {
  const values = doc.values;
  const urls = [values.metadata?.endpoint?.url, values.parser?.endpoint?.url,
    values.torrServer?.primary?.url, values.torrServer?.backup?.url,
    ...(values.sources || []).map(source => source.endpoint?.url),
    ...(values.plugins || []).map(plugin => plugin.url)].filter(Boolean);
  const origins = new Set();
  for (const value of urls) {
    let url;
    try { url = new URL(value); } catch { throw new Error("Проверьте адреса подключений."); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        url.search || url.hash || value.includes("?") || value.includes("#"))
      throw new Error("Проверьте адреса: уберите имя пользователя, пароль, параметры запроса и фрагмент.");
    if (url.protocol === "http:") {
      const host = url.hostname;
      const parts = host.split(".");
      const ipv4 = parts.length === 4 && parts.every(part => /^\d+$/.test(part));
      if ((ipv4 && (+parts[0] === 0 || +parts[0] >= 224 || (+parts[0] === 169 && +parts[1] === 254))) ||
          host === "metadata.google.internal" || host.includes(":") ||
          host.length > 253 || !parts.every(part => part.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part)))
        throw new Error("Проверьте адреса подключений: этот HTTP-адрес недопустим.");
      origins.add(url.origin);
    }
  }
  if (!origins.size) return;
  const allowed = new Set((await api("/v1/admin/lan-origins")).origins);
  const missing = [...origins].filter(origin => !allowed.has(origin));
  if (!missing.length) return;
  if (missing.some(origin => {
    const host = new URL(origin).hostname;
    return host === "localhost" || host.endsWith(".localhost") || /^127\.\d+\.\d+\.\d+$/.test(host);
  }))
    throw new Error("Проверьте адреса подключений: loopback HTTP-адрес недопустим без разрешения режима разработки.");
  if (!confirm("Разрешить HTTP для следующих адресов? Данные HTTP передаются без шифрования.\n\n" + missing.join("\n")))
    throw new Error("Разрешение HTTP отменено.");
  for (const origin of missing) {
    const result = await api("/v1/admin/lan-origins", json("POST", { origin }));
    showOrigins(result.origins);
  }
}
async function preview(doc) {
  const result = await api(
    "/v1/admin/config/validate",
    json("POST", { scopeKey: scopeKey(), document: doc }),
  );
  if (!result.valid)
    throw new Error(
      "Проверьте настройки: " + result.issues.map((issue) => {
        if (issue.message === "Enabled integration requires an endpoint")
          return "Для включённой службы укажите адрес или выберите выключение / наследование.";
        if (issue.code !== "url_policy") return issue.message;
        const labels = {
          "/metadata/endpoint/url": "TMDB Proxy URL",
          "/parser/endpoint/url": "Jackett URL",
          "/torrServer/primary/url": "TorrServer URL",
          "/torrServer/backup/url": "Резервный TorrServer URL",
        };
        const label = labels[issue.path] || "URL подключения";
        const inputIds = {"/metadata/endpoint/url":"tmdb", "/parser/endpoint/url":"jackett", "/torrServer/primary/url":"torr"};
        const value = issue.path.split("/").slice(1).reduce((current, key) => current?.[key], doc.values);
        const detail = "проверьте URL в действующих настройках: для HTTP подтвердите разрешение origin; уберите имя пользователя, пароль, параметры запроса и фрагмент.";
        const id = inputIds[issue.path];
        if (id && value) {
          $(id + "-error").textContent = detail;
          $(id).setAttribute("aria-invalid", "true");
        }
        return `${label}: ${detail}`;
      }).join("; "),
    );
}
async function validate() {
  if (!snapshot || !validUrls()) {
    message("Проверьте адреса.");
    return;
  }
  try {
    const doc = documentFromForm();
    await approveOrigins(doc);
    await preview(doc);
    message("Проверка пройдена.");
  } catch (e) {
    message(e.message);
  }
}
function mutationId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
function mutationHeaders(key, rev) {
  return { "If-Match": `"r-${rev}"`, "Idempotency-Key": key };
}
$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  message("Сохранение…");
  if (!snapshot || !validUrls()) {
    message("Проверьте адреса.");
    return;
  }
  try {
    const doc = documentFromForm();
    if (
      ($("jackettKey").value && !doc.values.parser?.endpoint) ||
      ($("metadataKey").value && !doc.values.metadata?.endpoint)
    )
      throw new Error("Для ключа укажите адрес соответствующей службы.");
    await approveOrigins(doc);
    await preview(doc);
    const signature = JSON.stringify([
      doc,
      $("jackettKey").value,
      $("metadataKey").value,
      revision,
      scopeKey(),
    ]);
    if (!pending || pending.signature !== signature) {
      const body = cloneDocument(doc);
      for (const [input, group] of [
        ["jackettKey", "parser"],
        ["metadataKey", "metadata"],
      ])
        if ($(input).value) {
          const secret = await api(
            "/v1/admin/secrets",
            json("POST", { value: $(input).value }),
          );
          body.values[group].endpoint.credentialRef = secret.ref;
        }
      pending = { signature, body, key: mutationId(), revision };
    }
    const result = await api(
      configPath(),
      json("PUT", pending.body, mutationHeaders(pending.key, pending.revision)),
    );
    snapshot = result.document;
    revision = result.revision;
    pending = imported = undefined;
    show(snapshot);
    message(
      "Сохранено. WEB/MSX-клиенты получат подключения с Pi; для немедленного применения откройте настройки Lampa Home на телевизоре.",
    );
    await history();
  } catch (e) {
    message(
      e.code === "REVISION_CONFLICT"
        ? "Настройки изменены в другом окне. Ваши изменения сохранены в форме; откройте текущую версию перед повторным сохранением."
        : e.message,
    );
  }
});
async function history() {
  try {
    if (scopeKey() !== loadedScope)
      throw new Error("Сначала откройте выбранную область настроек.");
    const { revisions } = await api(
      "/v1/admin/config/revisions?scopeKey=" + encodeURIComponent(scopeKey()),
    );
    $("revisions").replaceChildren();
    for (const item of revisions) {
      const li = document.createElement("li");
      const text = document.createElement("span");
      text.textContent = `Версия ${item.revision} · ${new Date(item.createdAt).toLocaleString("ru-RU")}${item.reason ? ` · ${item.reason}` : ""} `;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Восстановить";
      button.addEventListener("click", async () => {
        try {
          if (scopeKey() !== loadedScope)
            throw new Error("Сначала откройте выбранную область настроек.");
          const result = await api(
            "/v1/admin/config/rollback",
            json(
              "POST",
              { scopeKey: scopeKey(), targetRevision: item.revision },
              mutationHeaders(mutationId(), revision),
            ),
          );
          snapshot = result.document;
          revision = result.revision;
          pending = imported = undefined;
          show(snapshot);
          message("Версия восстановлена.");
          await history();
        } catch (e) {
          message(e.message);
        }
      });
      li.append(text, button);
      $("revisions").append(li);
    }
  } catch (e) {
    message(e.message);
  }
}
$("scope").addEventListener("change", () => {
  $("device").disabled = $("scope").value === "global";
});
$("load").addEventListener("click", load);
$("history").addEventListener("click", history);
$("validate").addEventListener("click", validate);
function showOrigins(origins) {
  $("allowedOrigins").replaceChildren();
  for (const origin of origins) {
    const item = document.createElement("li");
    item.textContent = origin;
    $("allowedOrigins").append(item);
  }
}
async function loadOrigins() {
  try { showOrigins((await api("/v1/admin/lan-origins")).origins); }
  catch { $("originStatus").textContent = "Не удалось загрузить разрешённые HTTP origin."; }
}
$("allow").addEventListener("click", async () => {
  let origin;
  try {
    const value = $("origin").value.trim();
    const url = new URL(value);
    if (url.protocol !== "http:" || url.username || url.password || url.search || url.hash || value.includes("?") || value.includes("#")) throw new Error();
    origin = url.origin;
  } catch {
    $("originStatus").textContent = "Укажите корректный HTTP URL, например http://192.168.1.10:8090, без учётных данных, параметров и фрагмента.";
    return;
  }
  try {
    const result = await api(
      "/v1/admin/lan-origins",
      json("POST", { origin }),
    );
    showOrigins(result.origins);
    $("originStatus").textContent = "HTTP разрешён отдельно от настроек.";
  } catch (e) {
    $("originStatus").textContent = e.message;
  }
});
function portable(value) {
  if (Array.isArray(value)) return value.map(portable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        k === "credentialRef" ? "UNRESOLVED_CREDENTIAL_REF" : portable(v),
      ]),
    );
  return value;
}
function unresolved(value) {
  if (Array.isArray(value)) return value.some(unresolved);
  if (value && typeof value === "object")
    return Object.entries(value).some(
      ([k, v]) =>
        (k === "credentialRef" &&
          (typeof v !== "string" || !/^secret:[A-Za-z0-9_-]+$/.test(v))) ||
        unresolved(v),
    );
  return false;
}
$("export").addEventListener("click", () => {
  try {
    if (snapshot)
      $("transfer").value = JSON.stringify(
        portable(documentFromForm()),
        null,
        2,
      );
  } catch (e) {
    message(e.message);
  }
});
$("import").addEventListener("click", async () => {
  try {
    const doc = JSON.parse($("transfer").value);
    if (unresolved(doc))
      throw new Error(
        "Импорт заблокирован: замените все незаполненные ссылки на ключи этого сервера.",
      );
    if (
      doc.scope !== $("scope").value ||
      (doc.scope === "device" && doc.deviceId !== $("device").value.trim())
    )
      throw new Error(
        "Область импортируемых настроек не совпадает с выбранной.",
      );
    await preview(doc);
    imported = doc;
    show(doc);
    message(
      "Предпросмотр импорта готов. Проверьте поля и нажмите «Сохранить».",
    );
  } catch (e) {
    message(e.message);
  }
});
load();
loadOrigins();

let aiRevision = 0;
let aiPromptsAvailable = false, aiDefaultPrompts = {};
async function loadAI() {
  try { const result = await api('/v1/admin/ai/config'); aiRevision=result.revision;
    const d=result.document; $('aiEnabled').checked=d.enabled; $('aiModel').value=d.model;
    $('aiLocale').value=d.locale; $('aiSchedule').value=d.schedule;
    $('aiProfileLimit').value=d.limits.profileAttempts; $('aiServerLimit').value=d.limits.serverAttempts;
    $('aiHomeLimit').value=d.limits.manualHome; $('aiSimilarLimit').value=d.limits.similar;
    $('aiKey').value=''; $('aiRemoveKey').checked=false;
    aiPromptsAvailable = typeof d.prompts?.home === 'string' && typeof d.prompts?.similar === 'string';
    aiDefaultPrompts = result.defaultPrompts || {};
    for (const [kind, field, reset] of [['home', 'aiHomePrompt', 'aiResetHomePrompt'], ['similar', 'aiSimilarPrompt', 'aiResetSimilarPrompt']]) {
      $(field).disabled = !aiPromptsAvailable;
      $(field).value = aiPromptsAvailable ? d.prompts[kind] : '';
      $(reset).disabled = !aiPromptsAvailable || typeof aiDefaultPrompts[kind] !== 'string';
    }
    $('aiKeyStatus').textContent=result.configured?'Ключ сохранён. Пустое поле сохранит его.':'Ключ не задан.';
  } catch { $('aiStatus').textContent='Не удалось загрузить настройки ИИ.'; }
}
$('aiForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const document={schemaVersion:1,enabled:$('aiEnabled').checked,model:$('aiModel').value,locale:$('aiLocale').value,timezone:'Europe/Moscow',schedule:$('aiSchedule').value,limits:{profileAttempts:Number($('aiProfileLimit').value),serverAttempts:Number($('aiServerLimit').value),manualHome:Number($('aiHomeLimit').value),similar:Number($('aiSimilarLimit').value)}};
  if (aiPromptsAvailable) {
    document.prompts = {home:$('aiHomePrompt').value, similar:$('aiSimilarPrompt').value};
    if (!document.prompts.home.trim() || !document.prompts.similar.trim()) { $('aiStatus').textContent='Промпты не могут быть пустыми.'; return; }
  }
  const payload={document,removeKey:$('aiRemoveKey').checked}; if($('aiKey').value)payload.key=$('aiKey').value;
  try {await api('/v1/admin/ai/config',json('PUT',payload,{'If-Match':`"r-${aiRevision}"`})); await loadAI(); $('aiStatus').textContent='Настройки ИИ сохранены.';}
  catch(e){$('aiStatus').textContent=e.code==='REVISION_CONFLICT'?'Настройки изменены в другом окне; ваши изменения остались в форме.':e.message;}
});
loadAI();

for (const [kind, field, reset] of [['home', 'aiHomePrompt', 'aiResetHomePrompt'], ['similar', 'aiSimilarPrompt', 'aiResetSimilarPrompt']]) {
  $(reset).addEventListener('click', () => {
    $(field).value = aiDefaultPrompts[kind];
    $('aiStatus').textContent = 'Промпт по умолчанию восстановлен; сохраните настройки, чтобы применить.';
  });
}

$('aiTest').addEventListener('click',async()=>{ try { $('aiStatus').textContent='Проверка…'; const result=await api('/v1/admin/ai/test',{method:'POST'}); $('aiStatus').textContent=result.state==='ready'?'Модель доступна.':'Проверка не удалась.'; } catch(e){$('aiStatus').textContent=e.message;} });

const diagnosticsBase = '/v1/admin/diagnostics';
const diagnosticValue = value => value === null || value === undefined || value === '' ? 'Неизвестно' : String(value);
const diagnosticTime = value => !value || Number.isNaN(Date.parse(value)) ? diagnosticValue(value) : new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
const diagnosticTokens = row => [row.inputTokens, row.outputTokens, row.totalTokens, row.cachedTokens].map(diagnosticValue).join(' / ');
function diagnosticRow(target, values) {
  const row = document.createElement('tr');
  for (const value of values) { const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell); }
  target.appendChild(row); return row;
}
let diagnosticAiCursor = null, diagnosticClientCursor = null;
async function loadDiagnosticAi(cursor = null) {
  $('diagnosticsAiStatus').textContent = 'Загрузка…'; $('diagnosticsAiNext').disabled = true;
  try {
    const params = new URLSearchParams({limit: '50'}); if (cursor) params.set('beforeId', cursor);
    const [list, summary] = await Promise.all([api(`${diagnosticsBase}/ai?${params}`), api(`${diagnosticsBase}/ai/summary`)]);
    $('diagnosticsSummary').replaceChildren(); $('diagnosticsAiRows').replaceChildren();
    for (const day of summary.days) diagnosticRow($('diagnosticsSummary'), [day.date, day.attempts, day.success, day.failed, diagnosticTokens(day)]);
    for (const item of list.items) {
      const row = diagnosticRow($('diagnosticsAiRows'), [diagnosticTime(item.time), `${diagnosticValue(item.profileId)} / ${diagnosticValue(item.deviceId)}`, `${diagnosticValue(item.kind)} / ${diagnosticValue(item.model)}`, diagnosticValue(item.status), diagnosticTokens(item), item.latencyMs == null ? 'Неизвестно' : `${item.latencyMs} мс`, `Событие: ${diagnosticValue(item.id)}; задача: ${diagnosticValue(item.jobId)}; запрос: ${diagnosticValue(item.providerRequestId)}; ошибка: ${diagnosticValue(item.errorCode)}`]);
      const cell = document.createElement('td'), button = document.createElement('button');
      button.type = 'button'; button.textContent = `Открыть ${item.id}`; button.addEventListener('click', () => openAiTrace(item.id)); cell.appendChild(button); row.appendChild(cell);
    }
    diagnosticAiCursor = list.nextCursor; $('diagnosticsAiNext').disabled = !diagnosticAiCursor;
    $('diagnosticsAiStatus').textContent = list.items.length ? 'Журнал загружен.' : 'Событий нет.';
  } catch { $('diagnosticsAiStatus').textContent = 'Не удалось загрузить журнал ИИ. Попробуйте обновить.'; }
}
let aiTraceSelection = 0, aiTraceDetail = null, aiTracePending = null, aiTraceBusy = false;
function traceUuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const h = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function traceMeta(detail) {
  const e = detail.event || {}, t = detail.trace;
  return `Событие: ${diagnosticValue(e.id)}; родитель: ${diagnosticValue(detail.parentEventId)}; модель: ${diagnosticValue(e.model)}; результат: ${diagnosticValue(e.status)}; токены вход / выход / всего / кэш: ${diagnosticTokens(e)}; длительность: ${e.latencyMs == null ? 'Неизвестно' : e.latencyMs + ' мс'}; HTTP: ${diagnosticValue(t?.httpStatus)}; захват: ${diagnosticValue(t?.capture)}; обрезано: ${t?.truncated ? 'Да' : 'Нет'}; очищено: ${t?.redacted ? 'Да' : 'Нет'}; ошибка транспорта: ${diagnosticValue(t?.transportError)}`;
}
function updateTraceControls() {
  const usable = aiTraceDetail?.trace && !aiTraceDetail.trace.truncated && !aiTraceDetail.trace.redacted;
  $('aiTraceReplay').disabled = aiTraceBusy || !usable || !$('aiTraceModel').value;
  $('aiTraceModel').disabled = aiTraceBusy || !$('aiTraceModel').options.length;
}
async function openAiTrace(id) {
  const selection = ++aiTraceSelection;
  aiTraceDetail = null; aiTracePending = null; aiTraceBusy = false;
  $('aiTraceStatus').textContent = 'Загрузка события…';
  for (const name of ['aiTraceMeta','aiTraceRequest','aiTraceResponse','aiComparisonMeta','aiComparisonResponse']) $(name).textContent = '';
  $('aiTraceModel').replaceChildren(); updateTraceControls();
  const detailPromise = api(`${diagnosticsBase}/ai/${encodeURIComponent(id)}`);
  const modelsPromise = api(`${diagnosticsBase}/ai/models`).catch(() => null);
  try {
    const detail = await detailPromise;
    if (selection !== aiTraceSelection) return;
    aiTraceDetail = detail;
    $('aiTraceMeta').textContent = traceMeta(detail);
    if (detail.trace) {
      $('aiTraceRequest').textContent = detail.trace.requestBody ?? '';
      $('aiTraceResponse').textContent = detail.trace.responseBody ?? 'Ответ отсутствует.';
      $('aiTraceStatus').textContent = detail.trace.truncated || detail.trace.redacted ? 'Трасса обрезана или очищена; сравнение недоступно.' : 'Трасса загружена.';
    } else $('aiTraceStatus').textContent = 'Для этого события нет сохранённой трассы.';
    const models = await modelsPromise;
    if (selection !== aiTraceSelection) return;
    if (Array.isArray(models?.models)) for (const model of models.models) {
      const option = document.createElement('option'); option.value = model; option.textContent = model; $('aiTraceModel').appendChild(option);
    }
    if (!models || !$('aiTraceModel').options.length) $('aiTraceStatus').textContent += ' Не удалось загрузить модели для сравнения.';
    updateTraceControls();
  } catch {
    if (selection !== aiTraceSelection) return;
    $('aiTraceStatus').textContent = 'Не удалось открыть событие.'; updateTraceControls();
  }
}
$('aiTraceModel').addEventListener('change', () => { aiTracePending = null; updateTraceControls(); });
$('aiTraceReplay').addEventListener('click', async () => {
  if (aiTraceBusy || $('aiTraceReplay').disabled) return;
  const selection = aiTraceSelection, source = aiTraceDetail.event.id, model = $('aiTraceModel').value;
  aiTracePending ||= {source, model, key: traceUuid()};
  const mutation = aiTracePending; aiTraceBusy = true; updateTraceControls();
  $('aiTraceStatus').textContent = 'Сравнение выполняется…';
  try {
    const result = await api(`${diagnosticsBase}/ai/${encodeURIComponent(source)}/replay`, json('POST', {model}, {'Idempotency-Key': mutation.key}));
    const detail = await api(`${diagnosticsBase}/ai/${encodeURIComponent(result.eventId)}`);
    if (selection !== aiTraceSelection) return;
    $('aiComparisonMeta').textContent = traceMeta(detail);
    $('aiComparisonResponse').textContent = detail.trace?.responseBody ?? 'Ответ отсутствует.';
    const status = detail.event?.status;
    if (status === 'success') { $('aiTraceStatus').textContent = 'Сравнение завершено.'; aiTracePending = null; }
    else if (status === 'running') $('aiTraceStatus').textContent = 'Сравнение ещё выполняется. Повторите запрос, чтобы проверить результат.';
    else $('aiTraceStatus').textContent = `Сравнение завершилось с ошибкой: ${diagnosticValue(detail.event?.errorCode)}.`;
  } catch (e) {
    if (selection !== aiTraceSelection) return;
    $('aiTraceStatus').textContent = `Не удалось выполнить или загрузить сравнение: ${e.message}. Повтор использует тот же запрос.`;
  } finally { if (selection === aiTraceSelection) { aiTraceBusy = false; updateTraceControls(); } }
});
async function loadDiagnosticClients(cursor = null) {
  $('diagnosticsClientStatus').textContent = 'Загрузка…'; $('diagnosticsClientNext').disabled = true;
  try {
    const params = new URLSearchParams({limit: '50'}); if (cursor) params.set('beforeId', cursor);
    const list = await api(`${diagnosticsBase}/client-logs?${params}`); $('diagnosticsClientRows').replaceChildren();
    for (const item of list.items) {
      const row = diagnosticRow($('diagnosticsClientRows'), [`${diagnosticValue(item.deviceId)} / ${diagnosticValue(item.id)}`, diagnosticTime(item.receivedAt), `${diagnosticValue(item.client?.appVersion)} / ${diagnosticValue(item.client?.platform)}`, diagnosticValue(item.entryCount), item.truncated ? 'Да' : 'Нет']);
      const cell = document.createElement('td'), button = document.createElement('button'); button.type = 'button'; button.textContent = `Открыть ${item.id}`;
      button.addEventListener('click', () => loadDiagnosticDetail(item.id)); cell.appendChild(button); row.appendChild(cell);
    }
    diagnosticClientCursor = list.nextCursor; $('diagnosticsClientNext').disabled = !diagnosticClientCursor;
    $('diagnosticsClientStatus').textContent = list.items.length ? 'Выгрузки загружены.' : 'Выгрузок нет.';
  } catch { $('diagnosticsClientStatus').textContent = 'Не удалось загрузить выгрузки. Попробуйте обновить.'; }
}
let diagnosticDetailId = null;
async function loadDiagnosticDetail(id) {
  $('diagnosticsDetailStatus').textContent = 'Загрузка выгрузки…'; $('diagnosticsClientDetail').textContent = ''; $('diagnosticsDownload').disabled = true;
  try { const detail = await api(`${diagnosticsBase}/client-logs/${encodeURIComponent(id)}`); $('diagnosticsClientDetail').textContent = JSON.stringify(detail, null, 2); $('diagnosticsDetailStatus').textContent = `Выгрузка ${id}`; diagnosticDetailId = id; $('diagnosticsDownload').disabled = false; }
  catch { $('diagnosticsDetailStatus').textContent = 'Не удалось открыть выгрузку.'; }
}
$('diagnosticsAiRefresh').addEventListener('click', () => loadDiagnosticAi());
$('diagnosticsAiNext').addEventListener('click', () => loadDiagnosticAi(diagnosticAiCursor));
$('diagnosticsClientRefresh').addEventListener('click', () => loadDiagnosticClients());
$('diagnosticsClientNext').addEventListener('click', () => loadDiagnosticClients(diagnosticClientCursor));

$('diagnosticsDownload').addEventListener('click', () => {
  const blob = new Blob([$('diagnosticsClientDetail').textContent], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `diagnostics-${String(diagnosticDetailId).replace(/[^A-Za-z0-9_-]/g, '_')}.json`;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
});
