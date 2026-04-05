const STORAGE_KEY = "command-atlas-state-v1";
const DATA_URL = "./commands.json";

const state = {
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
  clearButton: document.getElementById("clear-btn")
};

init();

async function init() {
  bindEvents();
  restoreState();

  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`讀取失敗：${response.status}`);
    }

    const rawData = await response.json();
    state.commands = normalizeCommands(rawData);
    state.categories = getCategories(state.commands);

    if (state.activeCategory !== "all" && !state.categories.includes(state.activeCategory)) {
      state.activeCategory = "all";
    }

    updateMetrics();
    renderFilters();
    applyFilters();
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

function normalizeCommands(rawData) {
  if (!Array.isArray(rawData)) {
    throw new Error("commands.json 必須是陣列格式。");
  }

  return rawData
    .filter(Boolean)
    .map((item, index) => {
      const normalized = {
        id: item.id ?? `command-${index + 1}`,
        category: String(item.category ?? "Uncategorized").trim(),
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
        <p>你可以換個關鍵字、切回全部分類，或直接到 commands.json 新增這條常用指令。</p>
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
      <h3>載入 commands.json 時發生問題</h3>
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
