const STORAGE_KEY = "command-atlas-state-v1";
const DATA_URL = "./commands.json";
const SECURE_DATA_URL = "./secure-categories.json";

const state = {
  publicCommands: [],
  protectedCategories: [],
  unlockedCommands: new Map(),
  commands: [],
  categories: [],
  query: "",
  activeCategory: "all"
};

const ui = {
  searchInput: document.getElementById("search-input"),
  filterBar: document.getElementById("filter-bar"),
  results: document.getElementById("results"),
  resultSummary: document.getElementById("result-summary"),
  commandCount: document.getElementById("command-count"),
  categoryCount: document.getElementById("category-count"),
  activeState: document.getElementById("active-state"),
  clearButton: document.getElementById("clear-btn"),
  securePanel: document.getElementById("secure-panel"),
  secureCategoryList: document.getElementById("secure-category-list")
};

init();

async function init() {
  bindEvents();
  restoreState();

  try {
    const [publicPayload, protectedPayload] = await Promise.all([
      fetchJson(DATA_URL, "公開指令資料"),
      fetchProtectedCategories()
    ]);

    state.publicCommands = normalizeCommands(publicPayload);
    state.protectedCategories = protectedPayload;

    renderProtectedCategories();
    rebuildCommandState();
    registerServiceWorker();
  } catch (error) {
    console.error(error);
    renderError(error);
  }
}

function bindEvents() {
  ui.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim();
    saveState();
    applyFilters();
  });

  ui.clearButton.addEventListener("click", () => {
    state.query = "";
    state.activeCategory = "all";
    ui.searchInput.value = "";
    saveState();
    renderFilters();
    applyFilters();
    ui.searchInput.focus();
  });

  ui.filterBar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");

    if (!button) {
      return;
    }

    state.activeCategory = button.dataset.category;
    saveState();
    renderFilters();
    applyFilters();
  });

  ui.results.addEventListener("click", async (event) => {
    const copyButton = event.target.closest("[data-copy-command]");

    if (!copyButton) {
      return;
    }

    const command = copyButton.dataset.copyCommand;
    await copyToClipboard(command, copyButton);
  });

  ui.secureCategoryList?.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-secure-form]");

    if (!form) {
      return;
    }

    event.preventDefault();
    await unlockProtectedCategory(form);
  });

  document.addEventListener("keydown", (event) => {
    const activeTag = document.activeElement?.tagName;
    const isTyping = activeTag === "INPUT" || activeTag === "TEXTAREA";

    if ((event.key === "/" || (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey))) && !isTyping) {
      event.preventDefault();
      ui.searchInput.focus();
      ui.searchInput.select();
    }

    if (event.key === "Escape") {
      state.query = "";
      ui.searchInput.value = "";
      saveState();
      applyFilters();
      ui.searchInput.blur();
    }
  });
}

async function fetchJson(url, label) {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`讀取${label}失敗：${response.status}`);
  }

  return response.json();
}

async function fetchProtectedCategories() {
  try {
    const response = await fetch(SECURE_DATA_URL, { cache: "no-store" });

    if (response.status === 404) {
      return [];
    }

    if (!response.ok) {
      throw new Error(`讀取受保護分類失敗：${response.status}`);
    }

    const payload = await response.json();
    return normalizeProtectedCategories(payload);
  } catch (error) {
    console.warn("secure categories load failed", error);
    return [];
  }
}

function normalizeCommands(rawData, fallbackCategory = "") {
  if (!Array.isArray(rawData)) {
    throw new Error("指令資料必須是陣列格式。");
  }

  return rawData
    .filter(Boolean)
    .map((item, index) => {
      const derivedCategory = String(item.category ?? fallbackCategory ?? "").trim() || "Uncategorized";
      const normalized = {
        id: item.id ?? `command-${index + 1}`,
        category: derivedCategory,
        command: String(item.command ?? "").trim(),
        description: String(item.description ?? "").trim(),
        tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
        notes: String(item.notes ?? "").trim()
      };

      return {
        ...normalized,
        searchBlob: [
          normalized.command,
          normalized.description,
          normalized.category,
          normalized.notes,
          normalized.tags.join(" ")
        ]
          .join(" ")
          .toLowerCase()
      };
    })
    .filter((item) => item.command && item.description);
}

function normalizeProtectedCategories(payload) {
  const source = Array.isArray(payload?.encryptedCategories)
    ? payload.encryptedCategories
    : Array.isArray(payload)
      ? payload
      : [];

  return source
    .filter(Boolean)
    .map((entry, index) => ({
      id: String(entry.id ?? `protected-${index + 1}`).trim(),
      label: String(entry.label ?? entry.category ?? `Protected ${index + 1}`).trim(),
      description: String(entry.description ?? "").trim(),
      ciphertext: String(entry.ciphertext ?? "").trim()
    }))
    .filter((entry) => entry.id && entry.label);
}

function rebuildCommandState() {
  const unlocked = Array.from(state.unlockedCommands.values()).flat();
  state.commands = [...state.publicCommands, ...unlocked];
  state.categories = getCategories(state.commands);

  if (state.activeCategory !== "all" && !state.categories.includes(state.activeCategory)) {
    state.activeCategory = "all";
  }

  updateMetrics();
  renderFilters();
  applyFilters();
}

function getCategories(commands) {
  return [...new Set(commands.map((item) => item.category))]
    .sort((left, right) => left.localeCompare(right, "zh-Hant"));
}

function renderFilters() {
  const buttons = [
    createFilterButton("all", "全部"),
    ...state.categories.map((category) => createFilterButton(category, category))
  ];

  ui.filterBar.replaceChildren(...buttons);
}

function createFilterButton(category, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `filter-pill${state.activeCategory === category ? " is-active" : ""}`;
  button.dataset.category = category;
  button.textContent = label;
  return button;
}

function renderProtectedCategories() {
  if (!ui.securePanel || !ui.secureCategoryList) {
    return;
  }

  if (!state.protectedCategories.length) {
    ui.securePanel.hidden = true;
    ui.secureCategoryList.replaceChildren();
    return;
  }

  ui.securePanel.hidden = false;

  const fragment = document.createDocumentFragment();

  state.protectedCategories.forEach((entry) => {
    const card = document.createElement("article");
    const isUnlocked = state.unlockedCommands.has(entry.id);
    card.className = "secure-card";
    card.innerHTML = `
      <div class="secure-card-header">
        <div>
          <p class="secure-card-title">${escapeHtml(entry.label)}</p>
          <p class="secure-card-meta">AES-256 受保護分類</p>
        </div>
        <span class="secure-badge${isUnlocked ? " is-unlocked" : ""}">
          ${isUnlocked ? "已解鎖" : "待解鎖"}
        </span>
      </div>
      ${entry.description ? `<p class="secure-card-copy">${escapeHtml(entry.description)}</p>` : ""}
      ${isUnlocked ? `
        <p class="secure-status is-success" data-status-for="${escapeAttribute(entry.id)}">
          此分類已加入目前頁面的搜尋與篩選結果。
        </p>
      ` : `
        <form class="secure-form" data-secure-form data-protected-id="${escapeAttribute(entry.id)}">
          <label class="password-field">
            <span>解密密碼</span>
            <input
              class="secure-input"
              type="password"
              name="password"
              autocomplete="current-password"
              spellcheck="false"
              placeholder="輸入密碼後解鎖"
              required
            >
          </label>
          <button class="secure-submit" type="submit">解鎖</button>
        </form>
        <p class="secure-status" data-status-for="${escapeAttribute(entry.id)}">
          解鎖後才會把這個分類加入結果中。
        </p>
      `}
    `;
    fragment.appendChild(card);
  });

  ui.secureCategoryList.replaceChildren(fragment);
}

async function unlockProtectedCategory(form) {
  const protectedId = form.dataset.protectedId;
  const passwordField = form.elements.password;
  const password = typeof passwordField?.value === "string" ? passwordField.value : "";
  const target = state.protectedCategories.find((entry) => entry.id === protectedId);

  setProtectedStatus(protectedId, "正在解鎖...", false);

  if (!target || !target.ciphertext || !password) {
    form.reset();
    setProtectedStatus(protectedId, "無法解鎖，請確認輸入內容。", true);
    return;
  }

  try {
    const decrypted = decryptProtectedCommands(target, password);
    state.unlockedCommands.set(target.id, decrypted);
    form.reset();
    renderProtectedCategories();
    rebuildCommandState();
  } catch (error) {
    console.warn("unlock failed", error);
    form.reset();
    setProtectedStatus(protectedId, "無法解鎖，請確認輸入內容。", true);
  }
}

function decryptProtectedCommands(target, password) {
  if (!window.CryptoJS?.AES) {
    throw new Error("CryptoJS unavailable");
  }

  const decryptedBytes = window.CryptoJS.AES.decrypt(target.ciphertext, password);
  const plaintext = decryptedBytes.toString(window.CryptoJS.enc.Utf8);

  if (!plaintext) {
    throw new Error("Decryption failed");
  }

  let parsed;

  try {
    parsed = JSON.parse(plaintext);
  } catch (error) {
    throw new Error("Invalid decrypted JSON");
  }

  return normalizeCommands(parsed, target.label);
}

function setProtectedStatus(protectedId, message, isError) {
  const target = Array.from(ui.secureCategoryList?.querySelectorAll("[data-status-for]") ?? [])
    .find((node) => node.dataset.statusFor === protectedId);

  if (!target) {
    return;
  }

  target.textContent = message;
  target.classList.toggle("is-error", Boolean(isError));
  target.classList.toggle("is-success", !isError && message.includes("已"));
}

function applyFilters() {
  const tokens = tokenize(state.query);
  const filtered = state.commands
    .filter((item) => state.activeCategory === "all" || item.category === state.activeCategory)
    .map((item) => ({ item, score: getMatchScore(item, tokens) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score || left.item.category.localeCompare(right.item.category, "zh-Hant"))
    .map((entry) => entry.item);

  updateSummary(filtered.length);
  renderResults(filtered);
}

function tokenize(query) {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function getMatchScore(item, tokens) {
  if (!tokens.length) {
    return 1;
  }

  let score = 0;

  for (const token of tokens) {
    const tagMatch = item.tags.some((tag) => tag.toLowerCase() === token);

    if (item.command.toLowerCase().startsWith(token)) {
      score += 12;
      continue;
    }

    if (item.command.toLowerCase().includes(token)) {
      score += 8;
      continue;
    }

    if (tagMatch) {
      score += 7;
      continue;
    }

    if (item.category.toLowerCase().includes(token)) {
      score += 5;
      continue;
    }

    if (item.description.toLowerCase().includes(token) || item.notes.toLowerCase().includes(token) || item.searchBlob.includes(token)) {
      score += 3;
      continue;
    }

    return -1;
  }

  return score;
}

function renderResults(items) {
  if (!items.length) {
    ui.results.innerHTML = `
      <article class="empty-state">
        <h3>沒有符合的結果</h3>
        <p>你可以換個關鍵字、切回全部分類，或到 commands.json / secure-categories.json 補上需要的資料。</p>
      </article>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "command-card";
    card.innerHTML = `
      <div class="card-top">
        <span class="category-badge">${escapeHtml(item.category)}</span>
        <button class="copy-button" type="button" data-copy-command="${escapeAttribute(item.command)}">複製</button>
      </div>
      <pre class="command-line"><code>${escapeHtml(item.command)}</code></pre>
      <p class="description">${escapeHtml(item.description)}</p>
      ${item.notes ? `<p class="notes">${escapeHtml(item.notes)}</p>` : ""}
      <div class="card-footer">
        <div class="tag-list">
          ${item.tags.map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join("")}
        </div>
      </div>
    `;
    fragment.appendChild(card);
  });

  ui.results.replaceChildren(fragment);
}

function renderError(error) {
  ui.resultSummary.textContent = "資料讀取失敗";
  ui.results.innerHTML = `
    <article class="error-state">
      <h3>載入資料時發生問題</h3>
      <p>${escapeHtml(error.message)}。請先確認你是透過本機伺服器預覽，而不是直接雙擊 HTML 檔案。</p>
    </article>
  `;
}

function updateMetrics() {
  ui.commandCount.textContent = `${state.commands.length} 筆指令`;
  ui.categoryCount.textContent = `${state.categories.length} 個分類`;
}

function updateSummary(resultCount) {
  const categoryLabel = state.activeCategory === "all" ? "全部分類" : state.activeCategory;
  const queryLabel = state.query ? `，關鍵字「${state.query}」` : "";

  ui.activeState.textContent = `目前：${categoryLabel}${queryLabel}`;
  ui.resultSummary.textContent = `共找到 ${resultCount} 筆結果`;
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      query: state.query,
      activeCategory: state.activeCategory
    })
  );
}

function restoreState() {
  const rawState = localStorage.getItem(STORAGE_KEY);

  if (!rawState) {
    return;
  }

  try {
    const parsed = JSON.parse(rawState);
    state.query = typeof parsed.query === "string" ? parsed.query : "";
    state.activeCategory = typeof parsed.activeCategory === "string" ? parsed.activeCategory : "all";
    ui.searchInput.value = state.query;
  } catch (error) {
    console.warn("restoreState failed", error);
    localStorage.removeItem(STORAGE_KEY);
  }
}

async function copyToClipboard(text, button) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      fallbackCopy(text);
    }

    const originalLabel = button.textContent;
    button.textContent = "已複製";
    button.classList.add("is-copied");

    window.setTimeout(() => {
      button.textContent = originalLabel;
      button.classList.remove("is-copied");
    }, 1400);
  } catch (error) {
    console.error(error);
    button.textContent = "失敗";
    window.setTimeout(() => {
      button.textContent = "複製";
    }, 1400);
  }
}

function fallbackCopy(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  const register = () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((error) => {
      console.error("Service worker register failed", error);
    });
  };

  if (document.readyState === "complete") {
    register();
    return;
  }

  window.addEventListener("load", register, { once: true });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
