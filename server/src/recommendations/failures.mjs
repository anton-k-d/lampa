const entries={
 QUOTA_EXCEEDED:['prepare','Дневной лимит запросов исчерпан.','Лимит сбрасывается в 00:00 МСК; администратор также может изменить лимит в настройках.',false],
 NOT_CONFIGURED:['prepare','Ключ AI не настроен.','Добавьте ключ в настройках.',false],
 NEEDS_HISTORY:['prepare','Нет снимка истории.','Синхронизируйте историю.',false],
 NO_LIKES:['prepare','Нет оценённых понравившихся фильмов.','Отметьте понравившиеся фильмы.',false],
 METADATA_NOT_CONFIGURED:['prepare','Источник данных о фильмах не настроен.','Проверьте настройки прокси.',false],
 SETTINGS_CHANGED:['prepare','Настройки изменились во время запроса.','Запустите запрос снова.',true],
 INTERRUPTED:['prepare','Запрос был прерван.','Запустите запрос снова.',true],
 PROVIDER_AUTH:['research','Сервис AI отклонил ключ.','Проверьте ключ в настройках.',false],
 PROVIDER_RATE_LIMIT:['research','Сервис AI ограничил запросы.','Повторите запрос позже.',true],
 PROVIDER_TIMEOUT:['research','Сервис AI не ответил вовремя.','Повторите запрос позже.',true],
 PROVIDER_UNAVAILABLE:['research','Сервис AI недоступен.','Повторите запрос позже.',true],
 OUTPUT_LIMIT:['research','Ответ AI оказался слишком длинным.','Повторите запрос.',true],
 SEARCH_REQUIRED:['research','AI не выполнил поиск.','Повторите запрос.',true],
 MODEL_REFUSED:['research','AI отказался выполнить запрос.','Измените запрос и попробуйте снова.',true],
 INVALID_JSON:['research','AI вернул ответ в неверном формате.','Повторите запрос.',true],
 INVALID_ITEMS:['research','AI вернул неверный список рекомендаций.','Повторите запрос.',true],
 INVALID_ITEM:['research','AI вернул неверную рекомендацию.','Повторите запрос.',true],
 DUPLICATE_ITEMS:['research','AI вернул повторяющиеся рекомендации.','Повторите запрос.',true],
 MODEL_FAILED:['research','AI не смог подготовить рекомендации.','Повторите запрос позже.',true],
 MODEL_UNSUPPORTED:['research','Выбранная модель не поддерживает поиск в интернете.','Выберите другую модель в настройках и повторите запрос.',true],
 METADATA_TIMEOUT:['metadata','Поиск фильмов занял слишком много времени.','Повторите запрос позже.',true],
 METADATA_UNAVAILABLE:['metadata','Источник данных о фильмах недоступен.','Проверьте прокси и повторите запрос позже.',true],
 NO_MATCHES:['metadata','Не удалось найти предложенные фильмы в каталоге.','Повторите запрос.',true],
 ALL_EXCLUDED:['filter','Все найденные фильмы уже есть в вашей истории или оценках.','Повторите запрос.',true],
 GENERATION_FAILED:['research','Не удалось подготовить рекомендации.','Повторите запрос позже.',true]
};
export function normalizeFailureCode(error){const raw=error?.validationReason??error?.code??'';const aliases={provider_authentication:'PROVIDER_AUTH',provider_auth:'PROVIDER_AUTH',provider_rate_limit:'PROVIDER_RATE_LIMIT',provider_timeout:'PROVIDER_TIMEOUT',provider_unavailable:'PROVIDER_UNAVAILABLE',invalid_response:'MODEL_FAILED',provider_error:'PROVIDER_UNAVAILABLE',aborted:'PROVIDER_TIMEOUT',NO_RECOMMENDATIONS:'NO_MATCHES'};const code=aliases[raw]??String(raw).toUpperCase();return Object.hasOwn(entries,code)?code:'GENERATION_FAILED';}
export function failureFor(code){const normalized=normalizeFailureCode({code});const [stage,message,action,retryable]=entries[normalized];return {code:normalized,stage,message,action,retryable};}
