import { $, api, json, appendModelOptions } from './admin-common.js';
let aiRevision = 0;
let aiPromptsAvailable = false, aiDefaultPrompts = {};
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
$('aiResetQuota').addEventListener('click',async()=>{
  if(!confirm('Сбросить сегодняшние счётчики запросов? Готовые подборки и журнал останутся.')) return;
  try { const result=await api('/v1/admin/ai/quota/reset',{method:'POST'}); $('aiStatus').textContent=`Лимит на сегодня сброшен. Снято запросов: ${result.jobs}, попыток: ${result.attempts}.`; }
  catch(e){ $('aiStatus').textContent=e.message; }
});
