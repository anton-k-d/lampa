import { $, api, diagnosticValue, diagnosticTime, diagnosticRow } from './admin-common.js';
const diagnosticsBase = '/v1/admin/diagnostics';
let diagnosticClientCursor = null;
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
$('diagnosticsClientRefresh').addEventListener('click', () => loadDiagnosticClients());
$('diagnosticsClientNext').addEventListener('click', () => loadDiagnosticClients(diagnosticClientCursor));

$('diagnosticsDownload').addEventListener('click', () => {
  const blob = new Blob([$('diagnosticsClientDetail').textContent], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `diagnostics-${String(diagnosticDetailId).replace(/[^A-Za-z0-9_-]/g, '_')}.json`;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
});
loadDiagnosticClients();
