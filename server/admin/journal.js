import { $, api, json, appendModelOptions, diagnosticValue, diagnosticTime, diagnosticTokens, diagnosticRow } from './admin-common.js';
const diagnosticsBase = '/v1/admin/diagnostics';
let diagnosticAiCursor = null;
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
loadDiagnosticAi();
