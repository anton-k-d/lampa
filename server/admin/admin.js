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
function appendModelOptions(select, models) {
  if (!Array.isArray(models)) return;
  for (const model of models) {
    if (typeof model !== 'string' || !model) continue;
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    select.appendChild(option);
  }
}
function syncModelCustom() {
  const custom = $('aiModel').value === '__custom__';
  $('aiModelCustomLabel').hidden = !custom;
}
function chosenModel() {
  return $('aiModel').value === '__custom__' ? $('aiModelCustom').value.trim() : $('aiModel').value.trim();
}
function fillSettingsModels(models, selected) {
  const select = $('aiModel');
  select.replaceChildren();
  appendModelOptions(select, models);
  if (selected && ![...select.options].some(option => option.value === selected)) {
    const option = document.createElement('option');
    option.value = selected;
    option.textContent = selected;
    select.insertBefore(option, select.firstChild);
  }
  const custom = document.createElement('option');
  custom.value = '__custom__';
  custom.textContent = 'Другая…';
  select.appendChild(custom);
  select.value = selected && [...select.options].some(option => option.value === selected) ? selected : (select.options[0]?.value || '__custom__');
  $('aiModelCustom').value = '';
  syncModelCustom();
}
async function loadAI() {
  try { const [result, models] = await Promise.all([api('/v1/admin/ai/config'), api('/v1/admin/ai/models').catch(() => null)]); aiRevision=result.revision;
    const d=result.document; $('aiEnabled').checked=d.enabled; fillSettingsModels(models?.models, d.model);
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
  const model = chosenModel();
  if (!model) { $('aiStatus').textContent = 'Укажите идентификатор модели.'; return; }
  const document={schemaVersion:1,enabled:$('aiEnabled').checked,model,locale:$('aiLocale').value,timezone:'Europe/Moscow',schedule:$('aiSchedule').value,limits:{profileAttempts:Number($('aiProfileLimit').value),serverAttempts:Number($('aiServerLimit').value),manualHome:Number($('aiHomeLimit').value),similar:Number($('aiSimilarLimit').value)}};
  if (aiPromptsAvailable) {
    document.prompts = {home:$('aiHomePrompt').value, similar:$('aiSimilarPrompt').value};
    if (!document.prompts.home.trim() || !document.prompts.similar.trim()) { $('aiStatus').textContent='Промпты не могут быть пустыми.'; return; }
  }
  const payload={document,removeKey:$('aiRemoveKey').checked}; if($('aiKey').value)payload.key=$('aiKey').value;
  try {await api('/v1/admin/ai/config',json('PUT',payload,{'If-Match':`"r-${aiRevision}"`})); await loadAI(); $('aiStatus').textContent='Настройки ИИ сохранены.';}
  catch(e){$('aiStatus').textContent=e.code==='REVISION_CONFLICT'?'Настройки изменены в другом окне; ваши изменения остались в форме.':e.message;}
});
loadAI();
$('aiModel').addEventListener('change', syncModelCustom);

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
    const listPromise = api(`${diagnosticsBase}/ai?${params}`);
    const summaryPromise = cursor ? null : api(`${diagnosticsBase}/ai/summary`);
    const list = await listPromise;
    $('diagnosticsAiRows').replaceChildren();
    if (summaryPromise) {
      const summary = await summaryPromise;
      $('diagnosticsSummary').replaceChildren();
      for (const day of summary.days) diagnosticRow($('diagnosticsSummary'), [day.date, day.attempts, day.success, day.failed, diagnosticTokens(day)]);
    }
    for (const item of list.items) {
      const row = diagnosticRow($('diagnosticsAiRows'), [diagnosticTime(item.time), `${diagnosticValue(item.profileId)} / ${diagnosticValue(item.deviceId)}`, `${diagnosticValue(item.kind)} / ${diagnosticValue(item.model)}`, diagnosticValue(item.status), diagnosticTokens(item), item.latencyMs == null ? 'Неизвестно' : `${item.latencyMs} мс`, `Событие: ${diagnosticValue(item.id)}; задача: ${diagnosticValue(item.jobId)}; запрос: ${diagnosticValue(item.providerRequestId)}; ошибка: ${diagnosticValue(item.errorCode)}`]);
      const cell = document.createElement('td'), button = document.createElement('button');
      button.type = 'button'; button.textContent = "Подробнее"; button.setAttribute("aria-label", `Открыть ${item.id}`); button.addEventListener('click', () => { aiTraceTrigger = button; openAiTrace(item.id); }); cell.appendChild(button); row.appendChild(cell);
    }
    diagnosticAiCursor = list.nextCursor; $('diagnosticsAiNext').disabled = !diagnosticAiCursor;
    $('diagnosticsAiStatus').textContent = list.items.length ? 'Журнал загружен.' : 'Событий нет.';
  } catch (e) { $('diagnosticsAiStatus').textContent = `Не удалось загрузить журнал ИИ. ${e.message || 'Попробуйте обновить.'}`; }
}
let aiTraceTrigger = null;
$("aiTraceBack").addEventListener("click", () => { $("aiTracePanel").hidden = true; ++aiTraceSelection; ++aiComparisonSelection; aiTraceTrigger?.focus(); });
let aiTraceSelection = 0, aiTraceDetail = null, aiTracePending = null, aiTraceBusy = false, aiComparisonBody = null, aiCopySequence = 0;
let aiComparisonDetail = null, aiComparisonSelection = 0, aiHistoryCursor = null, aiView = 'raw';
const snapshotStateLabels = {ready:'готово', pending:'обработка', failed:'ошибка'};
const mediaTypeLabels = {movie:'Фильм', tv:'Сериал'};
const statusLabels = {included:'Включено', excluded:'Исключено', resolved:'Найдено в TMDB', unresolved:'Не найдено'};
const exclusionLabels = {WATCHED:'Просмотрено', LIKED:'В лайках', SEED:'Исходное название', DUPLICATE:'Дубликат', ADULT:'Для взрослых', NOT_FOUND:'Не найдено', AMBIGUOUS:'Неоднозначное совпадение', METADATA_ERROR:'Ошибка TMDB'};
function resultSnapshot(detail) { return detail?.result || detail?.preview || null; }
function setResultView(view) {
  aiView = view;
  for (const [name, active] of [['aiViewCards',view === 'cards'],['aiViewRaw',view === 'raw']]) { $(name).classList.toggle('is-active', active); $(name).setAttribute('aria-selected', String(active)); }
  for (const name of ['aiOriginalCards','aiComparisonCards']) $(name).hidden = view !== 'cards';
  for (const name of ['aiOriginalRaw','aiComparisonRaw']) $(name).hidden = view !== 'raw';
  $('aiResultFilter').disabled = view !== 'cards';
  $('aiOriginalPreview').hidden = view !== 'cards' || !aiTraceDetail || !!resultSnapshot(aiTraceDetail);
  $('aiComparisonPreview').hidden = view !== 'cards' || !aiComparisonDetail || !!resultSnapshot(aiComparisonDetail);
}
function resultElement(tag, className, value) {
  const node = document.createElement(tag); if (className) node.className = className; if (value != null) node.textContent = String(value); return node;
}
function renderResult(target, detail) {
  const root = $(target), snapshot = resultSnapshot(detail); root.replaceChildren();
  if (!detail) { root.appendChild(resultElement('p','ai-result-empty','Выберите сравнение.')); return; }
  if (!snapshot) { root.appendChild(resultElement('p','ai-result-empty','Исторические карточки недоступны. Можно явно восстановить текущие данные TMDB из RAW.')); return; }
  const label = snapshot.mode === 'reconstructed' ? 'Восстановлено: текущие данные TMDB, не исторический результат.' : snapshot.mode === 'comparison' ? 'Сравнение: найдены в TMDB, не опубликованы в Lampa.' : 'Исторический результат генерации.';
  const context = snapshot.context || {}, counts = snapshot.selection || {};
  root.appendChild(resultElement('p','ai-result-details ai-result-summary',`${label} Состояние: ${snapshotStateLabels[snapshot.state] || 'неизвестно'}; время: ${diagnosticTime(snapshot.capturedAt)}; источник: ${diagnosticValue(context.kind)}${context.anchor?.title ? '; название: ' + context.anchor.title : ''}${snapshot.errorCode ? '; ошибка: ' + snapshot.errorCode : ''}${Number.isInteger(counts.proposed) ? '; предложено: ' + counts.proposed : ''}${Number.isInteger(counts.resolved) ? '; найдено: ' + counts.resolved : ''}${Number.isInteger(counts.excluded) ? '; исключено: ' + counts.excluded : ''}${Number.isInteger(counts.unresolved) ? '; не найдено: ' + counts.unresolved : ''}`));
  const filter = $('aiResultFilter').value;
  const items = (Array.isArray(snapshot.items) ? snapshot.items : []).filter(item => filter === 'all' || (filter === 'included' ? item.status === 'included' || item.status === 'resolved' : item.status === filter));
  if (!items.length) root.appendChild(resultElement('p','ai-result-empty','Нет результатов для выбранного фильтра.'));
  for (const item of items) {
    const card = item.card || {}, proposal = item.proposal || {}, article = resultElement('article','ai-result-card');
    const poster = resultElement('div','ai-result-poster'), placeholder = resultElement('span',null,'Нет постера'); poster.appendChild(placeholder);
    if (typeof item.posterUrl === 'string') { try { const url = new URL(item.posterUrl, location.href); if (['http:','https:'].includes(url.protocol)) { const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy'; img.addEventListener('load', () => { placeholder.hidden = true; }); img.addEventListener('error', () => { img.remove(); placeholder.hidden = false; }); img.src = url.href; poster.appendChild(img); } } catch {} }
    const body = resultElement('div','ai-result-body');
    body.appendChild(resultElement('h5',null,card.title || card.name || proposal.title || proposal.original_title || 'Без названия'));
    const year = proposal.year || (card.release_date || card.first_air_date || '').slice(0,4), type = mediaTypeLabels[proposal.media_type || card.media_type] || '';
    body.appendChild(resultElement('p','ai-result-details',[year,type,card.vote_average != null ? `Рейтинг: ${card.vote_average}` : null].filter(Boolean).join(' · ')));
    body.appendChild(resultElement('p','ai-result-status',`${statusLabels[item.status] || 'Неизвестно'}${exclusionLabels[item.exclusionCode] ? ': ' + exclusionLabels[item.exclusionCode] : ''}`));
    body.appendChild(resultElement('p','ai-result-reason',`Почему в подборке (объяснение модели): ${item.reason || 'Не указано'}`));
    if (card.overview) body.appendChild(resultElement('p','ai-result-details',card.overview));
    if (item.citationStatus !== 'verified') body.appendChild(resultElement('p','ai-result-details',item.citationStatus === 'partial' ? 'Источники подтверждены частично.' : 'Источники не подтверждены.'));
    article.append(poster,body); root.appendChild(article);
  }
}
function renderResults() { renderResult('aiOriginalCards',aiTraceDetail); renderResult('aiComparisonCards',aiComparisonDetail); setResultView(aiView); }
function setComparison(detail) {
  aiComparisonDetail = detail; aiComparisonBody = detail?.trace?.responseBody ?? null; ++aiCopySequence;
  $('aiComparisonMeta').textContent = detail ? traceMeta(detail) : '';
  $('aiComparisonResponse').textContent = detail ? detail.trace?.responseBody ?? 'Ответ отсутствует.' : '';
  renderResults(); updateTraceControls();
}
async function loadComparisonHistory(source, selection, cursor = null) {
  try {
    const params = new URLSearchParams({limit:'50'}); if (cursor) params.set('beforeId',cursor);
    const list = await api(`${diagnosticsBase}/ai/${encodeURIComponent(source)}/comparisons?${params}`);
    if (selection !== aiTraceSelection) return;
    const selected = $('aiHistorySelect').value, selectedOption = $('aiHistorySelect').selectedOptions[0]?.cloneNode(true);
    if (!cursor) $('aiHistorySelect').replaceChildren(new Option('Выберите сравнение',''));
    for (const event of list.items || []) { const option = document.createElement('option'); option.value = event.id; option.textContent = `${diagnosticTime(event.time)} · ${diagnosticValue(event.model)} · ${diagnosticValue(event.status)}`; $('aiHistorySelect').appendChild(option); }
    if (selected && !$('aiHistorySelect').querySelector(`option[value="${CSS.escape(selected)}"]`) && selectedOption) $('aiHistorySelect').appendChild(selectedOption);
    if (selected) $('aiHistorySelect').value = selected;
    aiHistoryCursor = list.nextCursor; $('aiHistoryMore').hidden = !aiHistoryCursor;
  } catch { if (selection === aiTraceSelection) $('aiHistoryMore').hidden = true; }
}
$('aiViewCards').addEventListener('click',()=>setResultView('cards'));
$('aiViewRaw').addEventListener('click',()=>setResultView('raw'));
$('aiResultFilter').addEventListener('change',renderResults);
$('aiHistoryMore').addEventListener('click',()=>loadComparisonHistory(aiTraceDetail.event.id,aiTraceSelection,aiHistoryCursor));
$('aiHistorySelect').addEventListener('change',async () => {
  const selection = aiTraceSelection, comparison = ++aiComparisonSelection, id = $('aiHistorySelect').value; setComparison(null);
  if (!id) return;
  try { const detail = await api(`${diagnosticsBase}/ai/${encodeURIComponent(id)}`); if (selection === aiTraceSelection && comparison === aiComparisonSelection) setComparison(detail); }
  catch { if (selection === aiTraceSelection && comparison === aiComparisonSelection) $('aiComparisonMeta').textContent = 'Не удалось загрузить сравнение.'; }
});
for (const [button, comparison] of [['aiOriginalPreview',false],['aiComparisonPreview',true]]) $(button).addEventListener('click',async () => {
  const detail = comparison ? aiComparisonDetail : aiTraceDetail, selection = aiTraceSelection, comparisonSelection = aiComparisonSelection;
  if (!detail || $(button).disabled) return; $(button).disabled = true;
  try {
    const data = await api(`${diagnosticsBase}/ai/${encodeURIComponent(detail.event.id)}/preview`,json('POST',{}));
    if (selection !== aiTraceSelection || (comparison && comparisonSelection !== aiComparisonSelection)) return;
    detail.preview = data.result; renderResults();
  } catch (e) { if (selection === aiTraceSelection && (!comparison || comparisonSelection === aiComparisonSelection)) $(comparison ? 'aiComparisonCards' : 'aiOriginalCards').appendChild(resultElement('p','ai-result-empty',`Не удалось восстановить карточки: ${e.message}`)); }
  finally { $(button).disabled = false; }
});
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
  return `Событие: ${diagnosticValue(e.id)}; родитель: ${diagnosticValue(detail.parentEventId)}; модель: ${diagnosticValue(e.model)}; Модель: ${diagnosticValue(e.status)}; ${pipelineMeta(e)}; токены вход / выход / всего / кэш: ${diagnosticTokens(e)}; длительность: ${e.latencyMs == null ? 'Неизвестно' : e.latencyMs + ' мс'}; HTTP: ${diagnosticValue(t?.httpStatus)}; захват: ${diagnosticValue(t?.capture)}; обрезано: ${t?.truncated ? 'Да' : 'Нет'}; очищено: ${t?.redacted ? 'Да' : 'Нет'}; ошибка транспорта: ${diagnosticValue(t?.transportError)}${e.citationSummary ? `; Источники: подтверждено ${e.citationSummary.verified}, частично ${e.citationSummary.partial}, не подтверждено ${e.citationSummary.unverified}` : ''}`;
}
function pipelineMeta(event) {
  const p = event.pipeline;
  if (!p || typeof p !== 'object') return 'Результат подборки не записан';
  const stages = {prepare:'подготовка', research:'поиск модели', metadata:'проверка TMDB', filter:'фильтрация', complete:'завершение'};
  const states = {running:'выполняется', failed:'ошибка', ready:'готово'};
  const code = typeof p.errorCode === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(p.errorCode) ? p.errorCode : 'Неизвестно';
  let result = `Подборка: ${states[p.state] || 'неизвестно'}, этап: ${stages[p.stage] || 'неизвестно'}`;
  if (p.errorCode) result += `, код: ${code}`;
  if (event.status === 'success' && p.state === 'failed' && p.stage === 'metadata') result += '; модель ответила, но TMDB не удалось проверить результаты';
  const s = p.selection;
  if (s && ['requested','proposed','resolved','excluded','returned','unresolved'].every(k => Number.isInteger(s[k]) && s[k] >= 0 && s[k] <= 1000)) {
    result += `; запрошено ${s.requested}, предложено ${s.proposed}, сопоставлено с TMDB ${s.resolved}, исключено ${s.excluded}, не сопоставлено ${s.unresolved}, показано ${s.returned}`;
    if (s.returned < s.requested) result += ' (часть названий могла не пройти проверку или локальные исключения)';
  }
  return result;
}
function updateTraceControls() {
  const usable = aiTraceDetail?.trace && !aiTraceDetail.trace.truncated && !aiTraceDetail.trace.redacted;
  $('aiTraceCopy').disabled = typeof aiTraceDetail?.trace?.responseBody !== 'string';
  $('aiComparisonCopy').disabled = typeof aiComparisonBody !== 'string';
  $('aiTraceReplay').disabled = aiTraceBusy || !usable || !$('aiTraceModel').value;
  $('aiTraceModel').disabled = aiTraceBusy || !$('aiTraceModel').options.length;
}
async function openAiTrace(id) {
  $('aiTracePanel').hidden = false;
  $('aiTracePanel').scrollIntoView({block:'start'});
  $('aiTracePanel').focus({preventScroll:true});
  const selection = ++aiTraceSelection;
  aiTraceDetail = null; aiTracePending = null; aiTraceBusy = false; aiComparisonBody = null; aiComparisonDetail = null; ++aiComparisonSelection; ++aiCopySequence;
  $('aiHistorySelect').replaceChildren(new Option('Выберите сравнение','')); $('aiHistoryMore').hidden = true; setResultView('raw'); renderResults();
  $('aiTraceCopyStatus').textContent = '';
  $('aiTraceStatus').textContent = 'Загрузка события…';
  for (const name of ['aiTraceMeta','aiTraceRequest','aiTraceResponse','aiComparisonMeta','aiComparisonResponse']) $(name).textContent = '';
  $('aiTraceModel').replaceChildren(); updateTraceControls();
  const detailPromise = api(`${diagnosticsBase}/ai/${encodeURIComponent(id)}`);
  const modelsPromise = api(`${diagnosticsBase}/ai/models`).catch(() => null);
  try {
    const detail = await detailPromise;
    if (selection !== aiTraceSelection) return;
    aiTraceDetail = detail;
    setResultView(resultSnapshot(detail) ? 'cards' : 'raw'); renderResults();
    loadComparisonHistory(id, selection);
    $('aiTraceMeta').textContent = traceMeta(detail);
    if (detail.trace) {
      $('aiTraceRequest').textContent = detail.trace.requestBody ?? '';
      $('aiTraceResponse').textContent = detail.trace.responseBody ?? 'Ответ отсутствует.';
      $('aiTraceStatus').textContent = detail.trace.truncated || detail.trace.redacted ? 'Трасса обрезана или очищена; сравнение недоступно.' : 'Трасса загружена.';
    } else $('aiTraceStatus').textContent = 'Для этого события нет сохранённой трассы.';
    updateTraceControls();
    const models = await modelsPromise;
    if (selection !== aiTraceSelection) return;
    appendModelOptions($('aiTraceModel'), models?.models);
    if (!models || !$('aiTraceModel').options.length) $('aiTraceStatus').textContent += ' Не удалось загрузить модели для сравнения.';
    updateTraceControls();
  } catch {
    if (selection !== aiTraceSelection) return;
    $('aiTraceStatus').textContent = 'Не удалось открыть событие.'; updateTraceControls();
  }
}
async function copyTraceResponse(comparison) {
  const body = comparison ? aiComparisonBody : aiTraceDetail?.trace?.responseBody;
  if (typeof body !== 'string') return;
  const selection = aiTraceSelection, sequence = ++aiCopySequence;
  const current = () => selection === aiTraceSelection && sequence === aiCopySequence;
  $('aiTraceCopyStatus').textContent = '';
  let copied = false;
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(body); copied = true; } catch { /* Try the HTTP-compatible fallback. */ }
  }
  if (!current()) return;
  if (!copied) {
    const active = document.activeElement, selectionObject = window.getSelection();
    const ranges = selectionObject ? Array.from({length: selectionObject.rangeCount}, (_, i) => selectionObject.getRangeAt(i).cloneRange()) : [];
    const field = document.createElement('textarea');
    field.value = body; field.dataset.copyTemporary = ''; field.style.position = 'fixed'; field.style.left = '-9999px';
    let wroteClipboard = false;
    const onCopy = event => {
      if (!event.clipboardData) return;
      try { event.clipboardData.setData('text/plain', body); event.preventDefault(); wroteClipboard = true; } catch { /* Report failure if clipboard data cannot be set. */ }
    };
    document.body.appendChild(field);
    document.addEventListener('copy', onCopy);
    try { field.focus(); field.select(); copied = document.execCommand('copy') && wroteClipboard; } catch { copied = false; }
    finally {
      document.removeEventListener('copy', onCopy);
      field.remove();
      if (active && typeof active.focus === 'function') active.focus();
      if (selectionObject) { selectionObject.removeAllRanges(); for (const range of ranges) selectionObject.addRange(range); }
    }
  }
  if (current()) $('aiTraceCopyStatus').textContent = copied ? 'Ответ скопирован.' : 'Не удалось скопировать ответ.';
}
$('aiTraceCopy').addEventListener('click', () => copyTraceResponse(false));
$('aiComparisonCopy').addEventListener('click', () => copyTraceResponse(true));
$('aiTraceModel').addEventListener('change', () => { aiTracePending = null; updateTraceControls(); });
$('aiTraceReplay').addEventListener('click', async () => {
  if (aiTraceBusy || $('aiTraceReplay').disabled) return;
  const selection = aiTraceSelection, comparisonSelection = ++aiComparisonSelection, source = aiTraceDetail.event.id, model = $('aiTraceModel').value;
  aiTracePending ||= {source, model, key: traceUuid()};
  const mutation = aiTracePending; aiTraceBusy = true; aiComparisonBody = null; ++aiCopySequence;
  $('aiComparisonMeta').textContent = ''; $('aiComparisonResponse').textContent = ''; $('aiTraceCopyStatus').textContent = ''; updateTraceControls();
  $('aiTraceStatus').textContent = 'Сравнение выполняется…';
  try {
    const result = await api(`${diagnosticsBase}/ai/${encodeURIComponent(source)}/replay`, json('POST', {model}, {'Idempotency-Key': mutation.key}));
    const detail = await api(`${diagnosticsBase}/ai/${encodeURIComponent(result.eventId)}`);
    if (selection !== aiTraceSelection) return;
    if (comparisonSelection === aiComparisonSelection) setComparison(detail);
    loadComparisonHistory(source, selection);
    const status = detail.event?.status;
    if (status === 'success') { $('aiTraceStatus').textContent = 'Сравнение завершено.'; aiTracePending = null; }
    else if (status === 'running') $('aiTraceStatus').textContent = 'Сравнение ещё выполняется. Повторите запрос, чтобы проверить результат.';
    else { $('aiTraceStatus').textContent = `Сравнение завершилось с ошибкой: ${diagnosticValue(detail.event?.errorCode)}.`; aiTracePending = null; }
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
      const cell = document.createElement('td'), button = document.createElement('button'); button.type = 'button'; button.textContent = "Подробнее"; button.setAttribute("aria-label", `Открыть ${item.id}`);
      button.addEventListener('click', () => loadDiagnosticDetail(item.id)); cell.appendChild(button); row.appendChild(cell);
    }
    diagnosticClientCursor = list.nextCursor; $('diagnosticsClientNext').disabled = !diagnosticClientCursor;
    $('diagnosticsClientStatus').textContent = list.items.length ? 'Выгрузки загружены.' : 'Выгрузок нет.';
  } catch { $('diagnosticsClientStatus').textContent = 'Не удалось загрузить выгрузки. Попробуйте обновить.'; }
}
let diagnosticDetailId = null;
async function loadDiagnosticDetail(id) {
  $('diagnosticsDetailStatus').setAttribute('tabindex', '-1');
  $('diagnosticsDetailStatus').scrollIntoView({block:'center'});
  $('diagnosticsDetailStatus').focus({preventScroll:true});
  $('diagnosticsDetailStatus').textContent = 'Загрузка выгрузки…'; $('diagnosticsClientDetail').textContent = ''; $('diagnosticsDownload').disabled = true;
  try { const detail = await api(`${diagnosticsBase}/client-logs/${encodeURIComponent(id)}`); $('diagnosticsClientDetail').textContent = JSON.stringify(detail, null, 2); $('diagnosticsDetailStatus').textContent = `Выгрузка ${id}`; diagnosticDetailId = id; $('diagnosticsDownload').disabled = false; }
  catch { $('diagnosticsDetailStatus').textContent = 'Не удалось открыть выгрузку.'; }
}
$('diagnosticsAiRefresh').addEventListener('click', () => loadDiagnosticAi());
$('diagnosticsAiNext').addEventListener('click', () => loadDiagnosticAi(diagnosticAiCursor));
$('diagnosticsAiClear').addEventListener('click', async () => {
  if (!confirm('Очистить журнал ИИ? События, трассы и сравнения будут удалены. Квоты и настройки сохранятся.')) return;
  try {
    await api(`${diagnosticsBase}/ai`, {method: 'DELETE'});
    $('aiTracePanel').hidden = true;
    await loadDiagnosticAi();
    $('diagnosticsAiStatus').textContent = 'Журнал очищен.';
  } catch (e) {
    $('diagnosticsAiStatus').textContent = `Не удалось очистить журнал. ${e.message || 'Попробуйте ещё раз.'}`;
  }
});
$('diagnosticsClientRefresh').addEventListener('click', () => loadDiagnosticClients());
$('diagnosticsClientNext').addEventListener('click', () => loadDiagnosticClients(diagnosticClientCursor));

$('diagnosticsDownload').addEventListener('click', () => {
  const blob = new Blob([$('diagnosticsClientDetail').textContent], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `diagnostics-${String(diagnosticDetailId).replace(/[^A-Za-z0-9_-]/g, '_')}.json`;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
});

const journal = $('aiJournal');
document.querySelector('nav').after(journal);
journal.after($('aiSettings'));

loadDiagnosticAi();
loadDiagnosticClients();
