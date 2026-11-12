import { $, api, json } from "./admin-common.js";

let profiles = [];
let devices = [];
let surveyId = "home";
let revision = 0;
let picks = new Map();
let tab = "trending";

const note = (text) => {
  $("status").textContent = text;
};
const surveyNote = (text) => {
  $("surveyStatus").textContent = text;
};
function moscow(value) {
  if (!value || Number.isNaN(Date.parse(value))) return "Ещё нет";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
function option(value, label, selected) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  node.selected = selected;
  return node;
}
function button(label, onClick) {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = label;
  node.addEventListener("click", onClick);
  return node;
}
function cell(text) {
  const node = document.createElement("td");
  node.textContent = text;
  return node;
}

function renderProfiles() {
  const body = $("profileRows");
  body.replaceChildren();
  for (const profile of profiles) {
    const row = document.createElement("tr");
    row.append(
      cell(profile.name),
      cell(String(profile.devices)),
      cell(String(profile.picks)),
      cell(moscow(profile.lastBatchAt)),
    );
    const actions = document.createElement("td");
    const group = document.createElement("div");
    group.className = "profile-actions";
    const name = document.createElement("input");
    name.value = profile.name;
    name.maxLength = 80;
    name.setAttribute("aria-label", `Новое имя для ${profile.name}`);
    group.append(
      name,
      button("Переименовать", async () => {
        try {
          await api(
            `/v1/admin/ai/profiles/${encodeURIComponent(profile.id)}`,
            json("PUT", { name: name.value }),
          );
          note(`Профиль «${name.value.trim()}» переименован.`);
          await refresh();
        } catch (error) {
          note(error.message);
        }
      }),
    );
    if (profile.id !== "home") {
      group.append(
        button("Удалить", async () => {
          if (
            !confirm(
              `Удалить профиль «${profile.name}»? Телевизоры вернутся в «Общий», а подборка профиля будет удалена.`,
            )
          )
            return;
          try {
            await api(`/v1/admin/ai/profiles/${encodeURIComponent(profile.id)}`, {
              method: "DELETE",
            });
            if (surveyId === profile.id) surveyId = "home";
            note(`Профиль «${profile.name}» удалён.`);
            await refresh();
          } catch (error) {
            note(error.message);
          }
        }),
      );
    }
    actions.append(group);
    row.append(actions);
    body.append(row);
  }
}

function renderDevices() {
  const body = $("deviceRows");
  body.replaceChildren();
  $("devicesEmpty").hidden = devices.length > 0;
  for (const device of devices) {
    const row = document.createElement("tr");
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Профиль для ${device.deviceId}`);
    for (const profile of profiles) select.append(option(profile.id, profile.name, profile.id === device.profileId));
    select.addEventListener("change", async () => {
      try {
        await api(
          `/v1/admin/ai/devices/${encodeURIComponent(device.deviceId)}/profile`,
          json("PUT", { profileId: select.value }),
        );
        note(`Телевизор ${device.deviceId} привязан к выбранному профилю.`);
        await refresh();
      } catch (error) {
        note(error.message);
      }
    });
    const profileCell = document.createElement("td");
    profileCell.append(select);
    row.append(cell(device.deviceId), cell(moscow(device.updatedAt)), cell(String(device.records)), profileCell);
    body.append(row);
  }
}

function renderSurveyChoices() {
  const select = $("surveyProfile");
  const current = profiles.some((profile) => profile.id === surveyId) ? surveyId : profiles[0]?.id || "";
  surveyId = current;
  select.replaceChildren(...profiles.map((profile) => option(profile.id, profile.name, profile.id === surveyId)));
}

function renderSelected() {
  const names = [...picks.values()].map((pick) => pick.title).filter(Boolean);
  $("surveySelected").textContent = names.length ? `Выбрано: ${names.join(", ")}` : "Пока ничего не выбрано.";
}

function renderGrid(cards) {
  const root = $("surveyGrid");
  root.replaceChildren();
  if (!cards.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "Ничего не найдено.";
    root.append(empty);
    return;
  }
  for (const card of cards) {
    const article = document.createElement("article");
    article.className = "profile-card";
    if (picks.has(card.key)) article.classList.add("is-picked");
    if (card.posterUrl) {
      const image = document.createElement("img");
      image.alt = "";
      image.src = card.posterUrl;
      article.append(image);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "profile-poster";
      placeholder.textContent = "Нет постера";
      article.append(placeholder);
    }
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = picks.has(card.key);
    const selectable = Number.isInteger(card.year) && card.title && card.key && card.media_type;
    box.disabled = !selectable;
    box.addEventListener("change", () => {
      if (box.checked) {
        picks.set(card.key, {
          key: card.key,
          title: card.title,
          year: card.year,
          media_type: card.media_type,
        });
      } else picks.delete(card.key);
      article.classList.toggle("is-picked", box.checked);
      renderSelected();
    });
    const title = document.createElement("span");
    title.textContent = `${card.title || "Без названия"}${card.year ? ` (${card.year})` : " · без года"}`;
    label.append(box, title);
    article.append(label);
    root.append(article);
  }
}

function setTab(next) {
  tab = next;
  for (const [id, name] of [
    ["surveyTrending", "trending"],
    ["surveyMovies", "movie"],
    ["surveyShows", "tv"],
  ]) {
    const node = $(id);
    const active = name === next;
    node.classList.toggle("is-active", active);
    node.setAttribute("aria-selected", String(active));
  }
}

async function showCatalog(cards) {
  $("surveyHint").hidden = true;
  renderGrid(cards);
}

async function catalog(path) {
  try {
    return await api(path);
  } catch (error) {
    if (error.code === "METADATA_NOT_CONFIGURED") {
      $("surveyGrid").replaceChildren();
      $("surveyHint").hidden = false;
      $("surveyHint").textContent =
        "Каталог не настроен. Укажите адрес TMDB Proxy на странице «Настройки».";
      return null;
    }
    throw error;
  }
}

async function browse(next = tab) {
  setTab(next);
  surveyNote("");
  try {
    if (next === "trending") {
      const [movies, shows] = await Promise.all([
        catalog("/v1/admin/ai/catalog/browse?type=movie&category=trending"),
        catalog("/v1/admin/ai/catalog/browse?type=tv&category=trending"),
      ]);
      if (!movies || !shows) return;
      await showCatalog([...movies.cards, ...shows.cards].slice(0, 20));
      return;
    }
    const result = await catalog(
      `/v1/admin/ai/catalog/browse?type=${next}&category=discover`,
    );
    if (result) await showCatalog(result.cards);
  } catch (error) {
    surveyNote(error.message);
  }
}

async function loadPicks() {
  if (!surveyId) return;
  const data = await api(`/v1/admin/ai/profiles/${encodeURIComponent(surveyId)}/picks`);
  revision = data.revision;
  picks = new Map(data.picks.map((pick) => [pick.key, pick]));
  renderSelected();
}

async function refresh() {
  profiles = (await api("/v1/admin/ai/profiles")).profiles;
  devices = (await api("/v1/admin/ai/devices")).devices;
  renderProfiles();
  renderDevices();
  renderSurveyChoices();
  await loadPicks();
}

async function watchJob(jobId) {
  const device = devices.find((item) => item.profileId === surveyId);
  if (!device) {
    surveyNote("Подборка в очереди. Статус появится после синхронизации телевизора.");
    return;
  }
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const job = await api(
      `/v1/devices/${encodeURIComponent(device.deviceId)}/recommendations/jobs/${encodeURIComponent(jobId)}`,
    );
    if (job.state === "ready") {
      surveyNote("Подборка готова.");
      await refresh();
      return;
    }
    if (job.state === "failed" || job.state === "disabled") {
      surveyNote(job.failure?.message || "Не удалось собрать подборку.");
      return;
    }
    surveyNote("Подборка собирается…");
  }
  surveyNote("Подборка ещё собирается. Проверьте результат позже.");
}

$("profileCreate").addEventListener("click", async () => {
  const name = $("profileName").value.trim();
  if (!name) {
    note("Укажите имя профиля.");
    return;
  }
  try {
    const created = await api("/v1/admin/ai/profiles", json("POST", { name }));
    $("profileName").value = "";
    surveyId = created.id;
    note(`Профиль «${created.name}» создан.`);
    await refresh();
    await browse(tab);
  } catch (error) {
    note(error.message);
  }
});

$("surveyProfile").addEventListener("change", async () => {
  surveyId = $("surveyProfile").value;
  try {
    await loadPicks();
    await browse(tab);
  } catch (error) {
    surveyNote(error.message);
  }
});
$("surveyTrending").addEventListener("click", () => browse("trending"));
$("surveyMovies").addEventListener("click", () => browse("movie"));
$("surveyShows").addEventListener("click", () => browse("tv"));
$("surveySearch").addEventListener("click", async () => {
  const query = $("surveyQuery").value.trim();
  if (!query) {
    surveyNote("Введите название для поиска.");
    return;
  }
  try {
    const result = await catalog(
      `/v1/admin/ai/catalog/search?query=${encodeURIComponent(query)}`,
    );
    if (result) await showCatalog(result.cards);
  } catch (error) {
    surveyNote(error.message);
  }
});
$("surveySave").addEventListener("click", async () => {
  try {
    const saved = await api(
      `/v1/admin/ai/profiles/${encodeURIComponent(surveyId)}/picks`,
      json("PUT", { picks: [...picks.values()] }, { "If-Match": `"r-${revision}"` }),
    );
    revision = saved.revision;
    picks = new Map(saved.picks.map((pick) => [pick.key, pick]));
    renderSelected();
    surveyNote("Выбор сохранён.");
    profiles = (await api("/v1/admin/ai/profiles")).profiles;
    renderProfiles();
  } catch (error) {
    surveyNote(
      error.code === "REVISION_CONFLICT"
        ? "Выбор изменён в другом окне. Откройте профиль ещё раз."
        : error.message,
    );
  }
});
$("surveyRefresh").addEventListener("click", async () => {
  const key = crypto.randomUUID();
  surveyNote("Запуск подборки…");
  try {
    const result = await api(
      `/v1/admin/ai/profiles/${encodeURIComponent(surveyId)}/refresh`,
      { method: "POST", headers: { "Idempotency-Key": key } },
    );
    const messages = {
      disabled: "ИИ-подборки выключены. Включите их на странице «ИИ».",
      needs_history: "Телевизор этого профиля ещё не синхронизировал историю.",
      not_configured: "Сначала сохраните ключ OpenAI на странице «ИИ».",
      no_likes: "Сохраните хотя бы один фильм в опросе.",
    };
    if (messages[result.state]) {
      surveyNote(messages[result.state]);
      return;
    }
    if (result.jobId) {
      surveyNote("Подборка в очереди…");
      await watchJob(result.jobId);
      return;
    }
    surveyNote("Подборка не запущена.");
  } catch (error) {
    surveyNote(
      error.code === "QUOTA_EXCEEDED"
        ? "Дневной лимит обновлений главной исчерпан."
        : error.message,
    );
  }
});

refresh()
  .then(() => browse("trending"))
  .catch((error) => note(error.message));
