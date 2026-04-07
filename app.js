const STORAGE_KEY = "command-atlas-state-v1";
const PINNED_KEY = "command-atlas-pinned-v1";
const DATA_URL = "./commands.json";
const SECURE_DATA_URL = "./secure-categories.json";
const SEARCH_DEBOUNCE_MS = 80;
const SCROLL_TOP_THRESHOLD = 280;
const RESULTS_PER_PAGE = 100;
const PBKDF2_ITERATIONS = 250000;
const PBKDF2_KEY_SIZE = 256 / 32;

const state = {
  publicCommands: [],
  protectedCategories: [],
  unlockedCommands: new Map(),
  placeholderValues: new Map(),
  pinned: new Set(),
  commands: [],
  categories: [],
  query: "",
  activeCategory: "all",
  pagination: {
    public: 1,
    protected: 1
  }
};

const ui = {
  hero: document.querySelector(".hero"),
  searchInput: document.getElementById("search-input"),
  stickySearchBar: document.getElementById("sticky-search-bar"),
  stickySearchInput: document.getElementById("sticky-search-input"),
  stickyActiveCategory: document.getElementById("sticky-active-category"),
  stickyCategoryPickerBtn: document.getElementById("sticky-category-picker-btn"),
  stickyCategoryPicker: document.getElementById("sticky-category-picker"),
  stickyClearButton: document.getElementById("sticky-clear-btn"),
  filterBar: document.getElementById("filter-bar"),
  categoryPickerBtn: document.getElementById("category-picker-btn"),
  categoryPicker: document.getElementById("category-picker"),
  publicResultsSection: document.getElementById("public-results-section"),
  results: document.getElementById("results"),
  publicPagination: document.getElementById("public-pagination"),
  protectedResultsSection: document.getElementById("protected-results-section"),
  protectedResults: document.getElementById("protected-results"),
  protectedPagination: document.getElementById("protected-pagination"),
  resultSummary: document.getElementById("result-summary"),
  commandCount: document.getElementById("command-count"),
  categoryCount: document.getElementById("category-count"),
  activeState: document.getElementById("active-state"),
  clearButton: document.getElementById("clear-btn"),
  scrollTopButton: document.getElementById("scroll-top-btn"),
  securePanel: document.getElementById("secure-panel"),
  secureCategoryList: document.getElementById("secure-category-list"),
  announcer: document.getElementById("app-announcer")
};

let searchDebounceId = 0;

init();

async function init() {
  bindEvents();
  restoreState();
  restorePinned();

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
  [ui.searchInput, ui.stickySearchInput].forEach((input) => {
    input?.addEventListener("input", (event) => {
      updateQuery(event.target.value, event.target);
    });
  });

  [ui.clearButton, ui.stickyClearButton].forEach((button) => {
    button?.addEventListener("click", () => {
      clearFilters();
      (button === ui.stickyClearButton ? ui.stickySearchInput : ui.searchInput)?.focus();
    });
  });

  ui.filterBar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");

    if (!button) {
      return;
    }

    applyCategoryFilter(button.dataset.category);
  });

  getCategoryPickerPairs().forEach(({ button, panel }) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();

      if (panel.hidden) {
        openCategoryPicker(panel);
      } else {
        closeCategoryPicker(panel);
      }
    });

    panel.addEventListener("click", (event) => {
      const categoryButton = event.target.closest("[data-category]");

      if (!categoryButton) {
        return;
      }

      applyCategoryFilter(categoryButton.dataset.category);
      closeCategoryPicker(panel);
    });
  });

  document.addEventListener("click", (event) => {
    handleOutsideCategoryPickerClick(event.target);
  });

  window.addEventListener("pointerdown", (event) => {
    handleOutsideCategoryPickerClick(event.target);
  }, { capture: true });

  ui.scrollTopButton?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  [ui.results, ui.protectedResults].forEach((container) => {
    container?.addEventListener("click", async (event) => {
      const categoryButton = event.target.closest("[data-category]");

      if (categoryButton) {
        applyCategoryFilter(categoryButton.dataset.category);
        closeAllCategoryPickers();
        return;
      }

      const pinButton = event.target.closest("[data-pin-id]");

      if (pinButton) {
        togglePin(pinButton.dataset.pinId, pinButton);
        return;
      }

      const tagButton = event.target.closest("[data-tag]");

      if (tagButton) {
        filterByTag(tagButton.dataset.tag);
        return;
      }

      if (event.target.closest(".placeholder-fields") || event.target.closest("[data-placeholder-token]")) {
        return;
      }

      const card = event.target.closest(".command-card");

      if (!card) {
        return;
      }

      const copyButton = card.querySelector("[data-copy-command]");

      if (!copyButton) {
        return;
      }

      const command = buildResolvedCommand(card, copyButton.dataset.copyCommand);
      await copyToClipboard(command, copyButton, card);
    });

    container?.addEventListener("input", (event) => {
      const placeholderInput = event.target.closest("[data-placeholder-token]");

      if (!placeholderInput) {
        return;
      }

      const card = placeholderInput.closest(".command-card");
      syncCardPlaceholderValues(card);
      updateCommandPreview(card);
    });
  });

  [ui.publicPagination, ui.protectedPagination].forEach((container) => {
    container?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-page-target][data-page-number]");

      if (!button) {
        return;
      }

      const target = button.dataset.pageTarget;
      const nextPage = Number.parseInt(button.dataset.pageNumber ?? "", 10);

      if (!Number.isFinite(nextPage)) {
        return;
      }

      if (target === "public" || target === "protected") {
        state.pagination[target] = nextPage;
        applyFiltersAnimated();
        (target === "public" ? ui.publicResultsSection : ui.protectedResultsSection)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
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
      if (hasOpenCategoryPicker()) {
        closeAllCategoryPickers();
        return;
      }

      closeShortcutsTooltip();
      clearFilters();
      ui.searchInput.blur();
    }
  });

  const helpBtn = document.getElementById("help-btn");
  const shortcutsTooltip = document.getElementById("shortcuts-tooltip");

  helpBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = shortcutsTooltip.classList.toggle("is-open");
    helpBtn.setAttribute("aria-expanded", String(isOpen));
    shortcutsTooltip.setAttribute("aria-hidden", String(!isOpen));
  });

  document.addEventListener("click", () => closeShortcutsTooltip());

  function closeShortcutsTooltip() {
    shortcutsTooltip?.classList.remove("is-open");
    helpBtn?.setAttribute("aria-expanded", "false");
    shortcutsTooltip?.setAttribute("aria-hidden", "true");
  }

  window.addEventListener("scroll", toggleUtilityChrome, { passive: true });
  window.addEventListener("resize", toggleUtilityChrome, { passive: true });
  toggleScrollTopButton();
  toggleStickySearchBar();
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

  const seenIds = new Set();

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

      const commandLower = normalized.command.toLowerCase();
      const categoryLower = normalized.category.toLowerCase();
      const descriptionLower = normalized.description.toLowerCase();
      const notesLower = normalized.notes.toLowerCase();

      return {
        ...normalized,
        commandLower,
        categoryLower,
        descriptionLower,
        notesLower,
        tagsLower: normalized.tags.map((t) => t.toLowerCase()),
        searchBlob: [commandLower, descriptionLower, categoryLower, notesLower, normalized.tags.join(" ").toLowerCase()].join(" ")
      };
    })
    .filter((item) => {
      if (!item.command || !item.description) {
        return false;
      }

      if (seenIds.has(item.id)) {
        console.warn(`[Command Atlas] duplicate command id detected: ${item.id}`);
      } else {
        seenIds.add(item.id);
      }

      return true;
    });
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
      ciphertext: String(entry.ciphertext ?? "").trim(),
      encryption: String(entry.encryption ?? "").trim(),
      kdf: String(entry.kdf ?? "").trim(),
      iterations: Number.isFinite(entry.iterations) ? Number(entry.iterations) : null,
      salt: String(entry.salt ?? "").trim(),
      iv: String(entry.iv ?? "").trim()
    }))
    .filter((entry) => entry.id && entry.label);
}

function getUnlockedCommands() {
  return Array.from(state.unlockedCommands.values()).flat();
}

function resetPagination() {
  state.pagination.public = 1;
  state.pagination.protected = 1;
}

function rebuildCommandState() {
  const unlocked = getUnlockedCommands();
  state.commands = [...state.publicCommands, ...unlocked];
  warnOnDuplicateCommandIds(state.commands);
  state.categories = getCategories(state.commands);

  if (state.activeCategory === "pinned" && state.pinned.size === 0) {
    state.activeCategory = "all";
  } else if (state.activeCategory !== "all" && state.activeCategory !== "pinned" && !state.categories.includes(state.activeCategory)) {
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
  const indicator = document.createElement("span");
  indicator.className = "filter-indicator";
  indicator.setAttribute("aria-hidden", "true");

  const pinnedPill = state.pinned.size > 0 ? [createPinnedFilterButton()] : [];

  const buttons = [
    createFilterButton("all", "全部"),
    ...pinnedPill,
    ...state.categories.map((category) => createFilterButton(category, category))
  ];

  ui.filterBar.replaceChildren(indicator, ...buttons);

  // Position indicator instantly (no transition), then enable transition after paint
  syncFilterIndicator();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ui.filterBar.querySelector(".filter-indicator")?.classList.add("is-ready");
    });
  });

  const activeButton = ui.filterBar.querySelector(`[data-category="${escapeCssSelector(state.activeCategory)}"]`);
  activeButton?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });

  updateStickySearchState();
}

function updateFilterPillActive() {
  document.body.classList.toggle("has-active-filter", state.activeCategory !== "all");

  ui.filterBar.querySelectorAll(".filter-pill[data-category]").forEach((btn) => {
    const isActive = btn.dataset.category === state.activeCategory;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  });

  const activeButton = ui.filterBar.querySelector(".filter-pill.is-active");
  activeButton?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });

  const pickerLabel = state.activeCategory === "all" ? "全部分類" : state.activeCategory;
  getCategoryPickerPairs().forEach(({ button }) => {
    button?.setAttribute("aria-label", `分類選單，當前 ${pickerLabel}`);
    button?.setAttribute("title", `分類選單：${pickerLabel}`);
  });

  syncFilterIndicator();
  updateStickySearchState();
}

function syncFilterIndicator() {
  const activeBtn = ui.filterBar.querySelector(".filter-pill.is-active");
  const indicator = ui.filterBar.querySelector(".filter-indicator");

  if (!indicator) {
    return;
  }

  if (!activeBtn) {
    indicator.style.opacity = "0";
    return;
  }

  indicator.style.opacity = "1";
  indicator.style.width = `${activeBtn.offsetWidth}px`;
  indicator.style.height = `${activeBtn.offsetHeight}px`;
  indicator.style.top = `${activeBtn.offsetTop}px`;
  indicator.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
}

function createFilterButton(category, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `filter-pill${state.activeCategory === category ? " is-active" : ""}`;
  button.dataset.category = category;
  button.setAttribute("aria-pressed", String(state.activeCategory === category));
  button.textContent = label;
  return button;
}

function createPinnedFilterButton() {
  const isActive = state.activeCategory === "pinned";
  const button = document.createElement("button");
  button.type = "button";
  button.className = `filter-pill filter-pill-pinned${isActive ? " is-active" : ""}`;
  button.dataset.category = "pinned";
  button.setAttribute("aria-pressed", String(isActive));
  button.innerHTML = `★ 已釘選 <span class="pin-pill-count">${state.pinned.size}</span>`;
  return button;
}

function getCategoryPickerPairs() {
  return [
    { button: ui.categoryPickerBtn, panel: ui.categoryPicker },
    { button: ui.stickyCategoryPickerBtn, panel: ui.stickyCategoryPicker }
  ].filter((entry) => entry.button && entry.panel);
}

function getCategoryPickerButton(panel) {
  return getCategoryPickerPairs().find((entry) => entry.panel === panel)?.button ?? null;
}

function hasOpenCategoryPicker() {
  return getCategoryPickerPairs().some(({ panel }) => !panel.hidden);
}

function openCategoryPicker(panel) {
  if (!panel) {
    return;
  }

  closeAllCategoryPickers(panel);
  renderCategoryPicker(panel);
  panel.hidden = false;
  const button = getCategoryPickerButton(panel);
  button?.setAttribute("aria-expanded", "true");
  button?.classList.add("is-open");
}

function closeCategoryPicker(panel) {
  if (!panel) {
    return;
  }

  panel.hidden = true;
  const button = getCategoryPickerButton(panel);
  button?.setAttribute("aria-expanded", "false");
  button?.classList.remove("is-open");
}

function closeAllCategoryPickers(exceptPanel = null) {
  getCategoryPickerPairs().forEach(({ panel }) => {
    if (panel !== exceptPanel) {
      closeCategoryPicker(panel);
    }
  });
}

function handleOutsideCategoryPickerClick(target) {
  const openPickers = getCategoryPickerPairs().filter(({ panel }) => !panel.hidden);

  if (!openPickers.length) {
    return;
  }

  const clickedInsideAnyPicker = openPickers.some(({ panel, button }) =>
    panel.contains(target) || button.contains(target)
  );

  if (!clickedInsideAnyPicker) {
    closeAllCategoryPickers();
  }
}

function renderCategoryPickers() {
  getCategoryPickerPairs().forEach(({ panel }) => {
    renderCategoryPicker(panel);
  });
}

function renderCategoryPicker(panel) {
  if (!panel) {
    return;
  }

  const counts = {};
  state.commands.forEach((command) => {
    counts[command.category] = (counts[command.category] || 0) + 1;
  });

  const categories = [
    { key: "all", label: "全部", count: state.commands.length },
    ...state.categories.map((category) => ({
      key: category,
      label: category,
      count: counts[category] || 0
    }))
  ];

  const fragment = document.createDocumentFragment();

  categories.forEach(({ key, label, count }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `picker-item${state.activeCategory === key ? " is-active" : ""}`;
    button.dataset.category = key;
    button.innerHTML = `
      <span class="picker-item-label">${escapeHtml(label)}</span>
      <span class="picker-item-count">${count}</span>
    `;
    fragment.appendChild(button);
  });

  panel.replaceChildren(fragment);

  const activeLabel = state.activeCategory === "all" ? "全部分類" : state.activeCategory;
  getCategoryPickerButton(panel)?.setAttribute("aria-label", `分類選單，當前 ${activeLabel}`);
  getCategoryPickerButton(panel)?.setAttribute("title", `分類選單：${activeLabel}`);
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
          <p class="secure-card-meta">鎖定指令庫</p>
        </div>
        <span class="secure-badge${isUnlocked ? " is-unlocked" : ""}">
          ${isUnlocked ? "已解鎖" : "鎖定中"}
        </span>
      </div>
      ${entry.description ? `<p class="secure-card-copy">${escapeHtml(entry.description)}</p>` : ""}
      ${isUnlocked ? `
        <p class="secure-status is-success" data-status-for="${escapeAttribute(entry.id)}">
          已解鎖，結果會自動顯示在下方的私人結果區。
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
          輸入密碼後，這些指令會顯示在下方的私人結果區。
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
    resetPagination();
    form.reset();
    renderProtectedCategories();
    rebuildCommandState();
    if (ui.securePanel) {
      ui.securePanel.open = false;
    }
    window.setTimeout(() => {
      if (!ui.protectedResultsSection?.hidden) {
        ui.protectedResultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 50);
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

  const plaintext = isModernEncryptedPayload(target)
    ? decryptWithPbkdf2(target, password)
    : decryptLegacyCiphertext(target.ciphertext, password);

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

function isModernEncryptedPayload(target) {
  return target.kdf === "PBKDF2-SHA256"
    && typeof target.iterations === "number"
    && typeof target.salt === "string"
    && typeof target.iv === "string";
}

function decryptWithPbkdf2(target, password) {
  const salt = window.CryptoJS.enc.Hex.parse(target.salt);
  const iv = window.CryptoJS.enc.Hex.parse(target.iv);
  const ciphertext = window.CryptoJS.enc.Base64.parse(target.ciphertext);
  const key = window.CryptoJS.PBKDF2(password, salt, {
    keySize: PBKDF2_KEY_SIZE,
    iterations: target.iterations,
    hasher: window.CryptoJS.algo.SHA256
  });

  const decryptedBytes = window.CryptoJS.AES.decrypt(
    { ciphertext },
    key,
    {
      iv,
      mode: window.CryptoJS.mode.CBC,
      padding: window.CryptoJS.pad.Pkcs7
    }
  );

  return decryptedBytes.toString(window.CryptoJS.enc.Utf8);
}

function decryptLegacyCiphertext(ciphertext, password) {
  const decryptedBytes = window.CryptoJS.AES.decrypt(ciphertext, password);
  return decryptedBytes.toString(window.CryptoJS.enc.Utf8);
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
  _runFilters(false);
}

function applyFiltersAnimated() {
  _runFilters(true);
}

function _runFilters(animated) {
  const tokens = tokenize(state.query);
  const filteredPublic = filterCommands(state.publicCommands, tokens);
  const filteredProtected = filterCommands(getUnlockedCommands(), tokens);
  const totalResults = filteredPublic.length + filteredProtected.length;

  updateSummary(totalResults);

  const doRender = () => renderResultSections(filteredPublic, filteredProtected, totalResults);

  if (animated && document.startViewTransition) {
    document.startViewTransition(doRender);
  } else {
    doRender();
  }
}

function filterCommands(commands, tokens) {
  return commands
    .filter((item) => {
      if (state.activeCategory === "pinned") return state.pinned.has(item.id);
      return state.activeCategory === "all" || item.category === state.activeCategory;
    })
    .map((item) => ({ item, score: getMatchScore(item, tokens) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => {
      const lp = state.pinned.has(left.item.id);
      const rp = state.pinned.has(right.item.id);
      if (lp !== rp) return lp ? -1 : 1;
      return right.score - left.score || left.item.category.localeCompare(right.item.category, "zh-Hant");
    })
    .map((entry) => entry.item);
}

function renderResultSections(publicItems, protectedItems, totalResults) {
  const hasPublicItems = publicItems.length > 0;
  const hasProtectedItems = protectedItems.length > 0;
  const publicPage = getValidPage("public", publicItems.length);
  const protectedPage = getValidPage("protected", protectedItems.length);
  const visiblePublicItems = paginateItems(publicItems, publicPage);
  const visibleProtectedItems = paginateItems(protectedItems, protectedPage);

  if (ui.publicResultsSection) {
    ui.publicResultsSection.hidden = !hasPublicItems && totalResults > 0;
  }

  if (ui.protectedResultsSection) {
    ui.protectedResultsSection.hidden = !hasProtectedItems;
  }

  if (!totalResults) {
    renderResults(ui.results, []);
    ui.protectedResults?.replaceChildren();
    renderPagination(ui.publicPagination, "public", 0, 1);
    renderPagination(ui.protectedPagination, "protected", 0, 1);
    return;
  }

  if (hasPublicItems) {
    renderResults(ui.results, visiblePublicItems);
  } else {
    ui.results.replaceChildren();
  }

  if (hasProtectedItems && ui.protectedResults) {
    renderResults(ui.protectedResults, visibleProtectedItems);
  } else {
    ui.protectedResults?.replaceChildren();
  }

  renderPagination(ui.publicPagination, "public", publicItems.length, publicPage);
  renderPagination(ui.protectedPagination, "protected", protectedItems.length, protectedPage);
}

function getPageCount(totalItems) {
  return Math.max(1, Math.ceil(totalItems / RESULTS_PER_PAGE));
}

function getValidPage(target, totalItems) {
  const totalPages = getPageCount(totalItems);
  const nextPage = Math.min(Math.max(state.pagination[target] ?? 1, 1), totalPages);
  state.pagination[target] = nextPage;
  return nextPage;
}

function paginateItems(items, page) {
  const startIndex = (page - 1) * RESULTS_PER_PAGE;
  return items.slice(startIndex, startIndex + RESULTS_PER_PAGE);
}

function renderPagination(container, target, totalItems, currentPage) {
  if (!container) {
    return;
  }

  const totalPages = getPageCount(totalItems);

  if (totalItems <= RESULTS_PER_PAGE) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }

  const pageNumbers = getVisiblePageNumbers(currentPage, totalPages);
  const buttonsHtml = pageNumbers
    .map((pageNumber) => `
      <button
        class="pagination-button pagination-number${pageNumber === currentPage ? " is-active" : ""}"
        type="button"
        data-page-target="${target}"
        data-page-number="${pageNumber}"
        aria-label="第 ${pageNumber} 頁"
        ${pageNumber === currentPage ? 'aria-current="page"' : ""}
      >
        ${pageNumber}
      </button>
    `)
    .join("");

  container.hidden = false;
  container.innerHTML = `
    <p class="pagination-meta">第 ${currentPage} / ${totalPages} 頁 · 每頁 ${RESULTS_PER_PAGE} 筆 · 共 ${totalItems} 筆</p>
    <div class="pagination-actions">
      <button
        class="pagination-button"
        type="button"
        data-page-target="${target}"
        data-page-number="${Math.max(1, currentPage - 1)}"
        ${currentPage <= 1 ? "disabled" : ""}
      >
        上一頁
      </button>
      ${buttonsHtml}
      <button
        class="pagination-button"
        type="button"
        data-page-target="${target}"
        data-page-number="${Math.min(totalPages, currentPage + 1)}"
        ${currentPage >= totalPages ? "disabled" : ""}
      >
        下一頁
      </button>
    </div>
  `;
}

function getVisiblePageNumbers(currentPage, totalPages) {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 3) {
    return [1, 2, 3, 4, totalPages];
  }

  if (currentPage >= totalPages - 2) {
    return [1, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, currentPage - 1, currentPage, currentPage + 1, totalPages];
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
    if (item.commandLower.startsWith(token)) {
      score += 12;
      continue;
    }

    if (item.commandLower.includes(token)) {
      score += 8;
      continue;
    }

    if (item.tagsLower.some((tag) => tag === token)) {
      score += 7;
      continue;
    }

    if (item.categoryLower.includes(token)) {
      score += 5;
      continue;
    }

    if (item.searchBlob.includes(token)) {
      score += 3;
      continue;
    }

    return -1;
  }

  return score;
}

function renderResults(container, items) {
  if (!items.length) {
    container.innerHTML = `
      <article class="empty-state">
        <h3>沒有找到符合的指令</h3>
        <p>可以換個關鍵字，或先切回「全部」再看看。</p>
      </article>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();
  const highlightPattern = compileHighlightPattern(tokenize(state.query));

  items.forEach((item) => {
    const placeholders = extractPlaceholders(item.command);
    const placeholderValues = state.placeholderValues.get(item.id) ?? {};
    const previewCommand = resolveCommandTemplate(item.command, placeholderValues);
    const accent = getCategoryAccent(item.category);
    const isPinned = state.pinned.has(item.id);
    const card = document.createElement("article");
    card.className = `command-card${isPinned ? " is-pinned" : ""}`;
    card.dataset.commandId = item.id;
    card.style.setProperty("--category-accent", accent.color);
    card.style.setProperty("--category-accent-soft", accent.soft);
    card.style.setProperty("--category-accent-border", accent.border);
    card.innerHTML = `
      <div class="card-top">
        <button class="category-badge category-badge-button" type="button" data-category="${escapeAttribute(item.category)}" aria-label="篩選分類 ${escapeAttribute(item.category)}" title="篩選分類 ${escapeAttribute(item.category)}">
          ${escapeHtml(item.category)}
        </button>
        <button class="pin-button" type="button" data-pin-id="${escapeAttribute(item.id)}" aria-label="${isPinned ? "取消釘選" : "釘選此指令"}" aria-pressed="${isPinned}" title="${isPinned ? "取消釘選" : "釘選"}">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><polygon points="8,1.5 10.2,6 15,6.6 11.5,9.9 12.5,14.5 8,12.1 3.5,14.5 4.5,9.9 1,6.6 5.8,6"/></svg>
        </button>
      </div>
      <div class="command-block">
        <pre class="command-line"><code>${highlightText(previewCommand, highlightPattern)}</code></pre>
        ${renderPlaceholderFields(placeholders, placeholderValues)}
        <button class="copy-button" type="button" data-copy-command="${escapeAttribute(item.command)}">複製</button>
      </div>
      <p class="description">${highlightText(item.description, highlightPattern)}</p>
      ${item.notes ? `<p class="notes">${highlightText(item.notes, highlightPattern)}</p>` : ""}
      <div class="card-footer">
        <div class="tag-list">
          ${item.tags.map((tag) => `<button class="tag tag-btn" type="button" data-tag="${escapeAttribute(tag)}">#${highlightText(tag, highlightPattern)}</button>`).join("")}
        </div>
      </div>
    `;
    card.setAttribute("tabindex", "0");
    card.addEventListener("keydown", (e) => {
      if (e.target !== card) {
        return;
      }

      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        card.querySelector("[data-copy-command]")?.click();
      }
    });
    fragment.appendChild(card);
  });

  container.replaceChildren(fragment);
}

function renderError(error) {
  ui.resultSummary.textContent = "資料讀取失敗";
  ui.results.innerHTML = `
    <article class="error-state">
      <h3>載入資料時發生問題</h3>
      <p>${escapeHtml(error.message)}。請先確認你是透過本機伺服器預覽，而不是直接雙擊 HTML 檔案。</p>
    </article>
  `;

  if (ui.publicResultsSection) {
    ui.publicResultsSection.hidden = false;
  }

  if (ui.protectedResultsSection) {
    ui.protectedResultsSection.hidden = true;
  }

  ui.publicPagination?.replaceChildren();
  ui.protectedPagination?.replaceChildren();
  if (ui.publicPagination) {
    ui.publicPagination.hidden = true;
  }
  if (ui.protectedPagination) {
    ui.protectedPagination.hidden = true;
  }
}

function updateMetrics() {
  ui.commandCount.textContent = `${state.commands.length} 筆指令`;
  ui.categoryCount.textContent = `${state.categories.length} 個分類`;
}

function updateSummary(resultCount) {
  const categoryLabel = state.activeCategory === "all" ? "全部分類" : state.activeCategory;
  const queryLabel = state.query ? `，關鍵字「${state.query}」` : "";
  const hasActiveFilters = state.query.length > 0 || state.activeCategory !== "all";
  const hasActiveCategoryFilter = state.activeCategory !== "all";

  ui.activeState.textContent = `目前：${categoryLabel}${queryLabel}`;
  ui.resultSummary.textContent = `共找到 ${resultCount} 筆結果`;
  ui.clearButton.hidden = !hasActiveFilters;
  if (ui.stickyClearButton) {
    ui.stickyClearButton.hidden = !hasActiveFilters;
  }
  document.body.classList.toggle("has-active-filter", hasActiveCategoryFilter);
  updateStickySearchState();
  toggleUtilityChrome();
}

function updateQuery(value, sourceInput = null) {
  state.query = String(value ?? "").trim();
  resetPagination();
  syncSearchInputs(sourceInput);
  saveState();
  window.clearTimeout(searchDebounceId);
  searchDebounceId = window.setTimeout(() => {
    applyFilters();
  }, SEARCH_DEBOUNCE_MS);
}

function syncSearchInputs(sourceInput = null) {
  [ui.searchInput, ui.stickySearchInput].forEach((input) => {
    if (!input || input === sourceInput) {
      return;
    }

    input.value = state.query;
  });
}

function clearFilters() {
  state.query = "";
  state.activeCategory = "all";
  resetPagination();
  syncSearchInputs();
  saveState();
  updateFilterPillActive();
  applyFiltersAnimated();
  closeAllCategoryPickers();
}

function applyCategoryFilter(category) {
  state.activeCategory = category;
  resetPagination();
  saveState();
  updateFilterPillActive();
  applyFiltersAnimated();
}

function updateStickySearchState() {
  const activeLabel = state.activeCategory === "all" ? "全部分類" : state.activeCategory;

  if (ui.stickyActiveCategory) {
    ui.stickyActiveCategory.textContent = activeLabel;
  }

  syncSearchInputs();
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
    syncSearchInputs();
  } catch (error) {
    console.warn("restoreState failed", error);
    localStorage.removeItem(STORAGE_KEY);
  }
}

function restorePinned() {
  try {
    const raw = localStorage.getItem(PINNED_KEY);

    if (raw) {
      const ids = JSON.parse(raw);

      if (Array.isArray(ids)) {
        state.pinned = new Set(ids);
      }
    }
  } catch (error) {
    console.warn("restorePinned failed", error);
    localStorage.removeItem(PINNED_KEY);
  }
}

function savePinned() {
  localStorage.setItem(PINNED_KEY, JSON.stringify([...state.pinned]));
}

function togglePin(commandId, buttonEl = null) {
  const wasPinned = state.pinned.has(commandId);

  if (wasPinned) {
    state.pinned.delete(commandId);
  } else {
    state.pinned.add(commandId);
  }

  savePinned();

  // If unpinned the last item while in pinned view, fall back to "all"
  if (state.pinned.size === 0 && state.activeCategory === "pinned") {
    state.activeCategory = "all";
  }

  if (buttonEl) {
    const isPinned = !wasPinned;
    buttonEl.setAttribute("aria-pressed", String(isPinned));
    buttonEl.setAttribute("aria-label", isPinned ? "取消釘選" : "釘選此指令");
    buttonEl.setAttribute("title", isPinned ? "取消釘選" : "釘選");
    buttonEl.closest(".command-card")?.classList.toggle("is-pinned", isPinned);
  }

  renderFilters();
  applyFiltersAnimated();
}

function filterByTag(tag) {
  state.query = tag;
  resetPagination();
  syncSearchInputs();
  saveState();
  applyFiltersAnimated();
}

async function copyToClipboard(text, button, card = null) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      fallbackCopy(text);
    }

    const originalLabel = button.textContent;
    button.textContent = "已複製";
    button.classList.add("is-copied");
    card?.classList.add("is-copied");

    window.setTimeout(() => {
      button.textContent = originalLabel;
      button.classList.remove("is-copied");
      card?.classList.remove("is-copied");
    }, 1400);

    announce("指令已複製到剪貼簿。");
  } catch (error) {
    console.error(error);
    button.textContent = "失敗";
    window.setTimeout(() => {
      button.textContent = "複製";
    }, 1400);
    announce("複製失敗。");
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

function extractPlaceholders(command) {
  const matches = String(command ?? "").match(/<[^>]+>/g) ?? [];
  return [...new Set(matches.map((token) => token.trim()).filter(Boolean))];
}

function renderPlaceholderFields(placeholders, currentValues = {}) {
  if (!placeholders.length) {
    return "";
  }

  return `
    <div class="placeholder-fields">
      ${placeholders.map((token) => `
        <label class="placeholder-field">
          <span>${escapeHtml(token.slice(1, -1))}</span>
          <input
            class="secure-input placeholder-input"
            type="text"
            data-placeholder-token="${escapeAttribute(token)}"
            placeholder="貼上實際值"
            value="${escapeAttribute(currentValues[token] ?? "")}"
            autocomplete="off"
            spellcheck="false"
          >
        </label>
      `).join("")}
    </div>
  `;
}

function buildResolvedCommand(card, template) {
  return resolveCommandTemplate(template, getPlaceholderValues(card));
}

function getPlaceholderValues(card) {
  const values = {};

  card?.querySelectorAll("[data-placeholder-token]").forEach((input) => {
    values[input.dataset.placeholderToken] = input.value;
  });

  return values;
}

function syncCardPlaceholderValues(card) {
  if (!card?.dataset.commandId) {
    return;
  }

  state.placeholderValues.set(card.dataset.commandId, getPlaceholderValues(card));
}

function resolveCommandTemplate(template, values) {
  return String(template ?? "").replace(/<[^>]+>/g, (token) => {
    const nextValue = values[token];
    return typeof nextValue === "string" && nextValue !== "" ? nextValue : token;
  });
}

function updateCommandPreview(card) {
  if (!card) {
    return;
  }

  const copyButton = card.querySelector("[data-copy-command]");
  const code = card.querySelector(".command-line code");

  if (!copyButton || !code) {
    return;
  }

  code.innerHTML = highlightText(
    buildResolvedCommand(card, copyButton.dataset.copyCommand),
    tokenize(state.query)
  );
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

function escapeCssSelector(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(String(value));
  }

  return String(value).replace(/["\\]/g, "\\$&");
}

function warnOnDuplicateCommandIds(commands) {
  const seen = new Set();

  commands.forEach((item) => {
    if (seen.has(item.id)) {
      console.warn(`[Command Atlas] duplicate command id found in combined state: ${item.id}`);
      return;
    }

    seen.add(item.id);
  });
}

function compileHighlightPattern(tokens) {
  if (!tokens.length) {
    return null;
  }

  const uniqueTokens = [...new Set(tokens.map((token) => token.trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length);

  if (!uniqueTokens.length) {
    return null;
  }

  const pattern = uniqueTokens
    .map((token) => escapeRegex(escapeHtml(token)))
    .join("|");

  return pattern ? new RegExp(`(${pattern})`, "gi") : null;
}

function highlightText(text, tokensOrPattern) {
  const escaped = escapeHtml(text);

  if (!tokensOrPattern) {
    return escaped;
  }

  if (tokensOrPattern instanceof RegExp) {
    tokensOrPattern.lastIndex = 0;
    return escaped.replace(tokensOrPattern, "<mark>$1</mark>");
  }

  const pattern = compileHighlightPattern(tokensOrPattern);
  return pattern ? escaped.replace(pattern, "<mark>$1</mark>") : escaped;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function announce(message) {
  if (!ui.announcer) {
    return;
  }

  ui.announcer.textContent = "";
  window.setTimeout(() => {
    ui.announcer.textContent = message;
  }, 20);
}

function getCategoryAccent(category) {
  const palette = {
    Git: { color: "#7ee787", soft: "rgba(126, 231, 135, 0.14)", border: "rgba(126, 231, 135, 0.34)" },
    Docker: { color: "#79b8ff", soft: "rgba(121, 184, 255, 0.14)", border: "rgba(121, 184, 255, 0.34)" },
    GitHub: { color: "#a78bfa", soft: "rgba(167, 139, 250, 0.14)", border: "rgba(167, 139, 250, 0.34)" },
    Python: { color: "#f2cc60", soft: "rgba(242, 204, 96, 0.14)", border: "rgba(242, 204, 96, 0.34)" },
    PowerShell: { color: "#9a8cff", soft: "rgba(154, 140, 255, 0.14)", border: "rgba(154, 140, 255, 0.34)" },
    WSL: { color: "#66d1c1", soft: "rgba(102, 209, 193, 0.14)", border: "rgba(102, 209, 193, 0.34)" },
    Bash: { color: "#93d977", soft: "rgba(147, 217, 119, 0.14)", border: "rgba(147, 217, 119, 0.34)" },
    "Windows Network & DNS": { color: "#5bb0ff", soft: "rgba(91, 176, 255, 0.14)", border: "rgba(91, 176, 255, 0.34)" },
    "Windows Port & Firewall": { color: "#ff9d5c", soft: "rgba(255, 157, 92, 0.14)", border: "rgba(255, 157, 92, 0.34)" },
    "Windows Process & Service": { color: "#7cc8a5", soft: "rgba(124, 200, 165, 0.14)", border: "rgba(124, 200, 165, 0.34)" },
    "Windows Event Log": { color: "#c792ea", soft: "rgba(199, 146, 234, 0.14)", border: "rgba(199, 146, 234, 0.34)" },
    "Windows Repair": { color: "#f28b82", soft: "rgba(242, 139, 130, 0.14)", border: "rgba(242, 139, 130, 0.34)" },
    "Windows Shortcut": { color: "#d1b36a", soft: "rgba(209, 179, 106, 0.14)", border: "rgba(209, 179, 106, 0.34)" },
    "Windows File & Directory": { color: "#8fb0ff", soft: "rgba(143, 176, 255, 0.14)", border: "rgba(143, 176, 255, 0.34)" }
  };

  return palette[category] ?? {
    color: "#79b8ff",
    soft: "rgba(121, 184, 255, 0.14)",
    border: "rgba(121, 184, 255, 0.34)"
  };
}

function toggleUtilityChrome() {
  toggleScrollTopButton();
  toggleStickySearchBar();
}

function toggleScrollTopButton() {
  if (!ui.scrollTopButton) {
    return;
  }

  const shouldShow = window.scrollY > SCROLL_TOP_THRESHOLD;
  ui.scrollTopButton.hidden = !shouldShow;
  ui.scrollTopButton.classList.toggle("is-visible", shouldShow);
}

function toggleStickySearchBar() {
  if (!ui.stickySearchBar || !ui.hero) {
    return;
  }

  const stickyThreshold = Math.max(160, ui.hero.offsetHeight - 72);
  const shouldShow = window.scrollY > stickyThreshold;
  ui.stickySearchBar.classList.toggle("is-visible", shouldShow);
  ui.stickySearchBar.setAttribute("aria-hidden", String(!shouldShow));
}
