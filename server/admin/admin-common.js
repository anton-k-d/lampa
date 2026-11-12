export const $ = (id) => document.getElementById(id);

export function message(text) {
  const status = $("status");
  if (status) status.textContent = text;
}

export async function api(path, options = {}) {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.message || "Ошибка сервера");
    error.code = result.code;
    throw error;
  }
  return result;
}

export const json = (method, body, headers = {}) => ({
  method,
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

export function appendModelOptions(select, models) {
  if (!Array.isArray(models)) return;
  for (const model of models) {
    if (typeof model !== "string" || !model) continue;
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    select.appendChild(option);
  }
}

export const diagnosticValue = (value) =>
  value === null || value === undefined || value === "" ? "Неизвестно" : String(value);
export const diagnosticTime = (value) =>
  !value || Number.isNaN(Date.parse(value))
    ? diagnosticValue(value)
    : new Intl.DateTimeFormat("ru-RU", {
        timeZone: "Europe/Moscow",
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(value));
export const diagnosticTokens = (row) =>
  [row.inputTokens, row.outputTokens, row.totalTokens, row.cachedTokens]
    .map(diagnosticValue)
    .join(" / ");
export function diagnosticRow(target, values) {
  const row = document.createElement("tr");
  for (const value of values) {
    const cell = document.createElement("td");
    cell.textContent = value;
    row.appendChild(cell);
  }
  target.appendChild(row);
  return row;
}
