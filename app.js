import {
  escapeHtml,
  escapeAttribute,
  escapeCssSelector,
  compileHighlightPattern,
  compileTextHighlightPattern,
  highlightText,
  getCategoryAccent
} from "./utils.js";
import {
  getCommandHighlightLanguage,
  renderCommandCode,
  scheduleHighlightLoad
} from "./highlight.js";

const STORAGE_KEY = "command-atlas-state-v1";
const PINNED_KEY = "command-atlas-pinned-v1";
const PLACEHOLDER_KEY = "command-atlas-placeholders-v1";
const PLACEHOLDER_SESSION_KEY = "command-atlas-placeholders-session-v1";
const SENSITIVE_TOKEN_PATTERN = /token|password|secret|key|密碼|金鑰|憑證/i;
const DATA_URL = "./commands.json";
const SECURE_DATA_URL = "./secure-categories.json";
const SEARCH_DEBOUNCE_MS = 80;
const RESULTS_PER_PAGE = 50;
// Above-the-fold batch — render this many cards synchronously on each
// filter render, then defer the rest to subsequent animation frames so
// the initial paint of a page lands without waiting on the whole list.
const FIRST_RENDER_BATCH = 20;
const DEFERRED_RENDER_CHUNK = 15;

const CATEGORY_GROUPS = [
  {
    label: "開發工具",
    match: (c) => ["Bash", "Git", "GitHub", "Docker", "npm", "Python", "PowerShell"].includes(c)
  },
  {
    label: "Windows 系統",
    match: (c) => c.startsWith("Windows")
  },
  {
    label: "系統與環境",
    match: () => true
  }
];

const state = {
  publicCommands: [],
  protectedCategories: [],
  unlockedCommands: new Map(),
  placeholderValues: new Map(),
  activeVariants: new Map(),
  pinned: new Set(),
  commands: [],
  categories: [],
  commandCounts: {},
  query: "",
  activeCategory: "all",
  viewMode: "cards",
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
  viewToggleButton: document.getElementById("view-toggle-btn"),
  clearButton: document.getElementById("clear-btn"),
  scrollTopButton: document.getElementById("scroll-top-btn"),
  securePanel: document.getElementById("secure-panel"),
  secureCategoryList: document.getElementById("secure-category-list"),
  announcer: document.getElementById("app-announcer")
};

let searchDebounceId = 0;
let searchWorker = null;
let searchWorkerDisabled = false;
let workerSeq = 0;
let lastFilterAnimated = false;
let firstFilterDone = false;
let decryptWorker = null;
let decryptWorkerSeq = 0;
const decryptPending = new Map();

// Reusable canvas for text measurement; cached column width avoids re-measuring on every picker open
const _pickerMeasureCanvas = document.createElement("canvas");
let _pickerGridMinCol = 0;

init();

async function init() {
  bindEvents();
  restoreState();
  restorePinned();
  restorePlaceholders();

  // Start fetching search.worker.js in parallel with commands.json so the
  // worker script is usually already loaded by the time we need it for
  // subsequent filters. The first filter still runs on the main thread
  // (see _runFilters) so first paint does not depend on this.
  getSearchWorker();

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
    scheduleHighlightLoad(upgradeAllCodeBlocks);
  } catch (error) {
    console.error(error);
    renderError(error);
  }
}

function bindEvents() {
  [ui.searchInput, ui.stickySearchInput].forEach((input) => {
    if (!input) {
      return;
    }

    // IME composition guard: ignore input events while composing (Bopomofo,
    // Pinyin, Kana, etc.) so partial composition strings don't reach the
    // search filter and disturb the IME state mid-composition.
    input.addEventListener("compositionstart", () => {
      input.dataset.composing = "true";
    });

    input.addEventListener("compositionend", (event) => {
      delete input.dataset.composing;
      updateQuery(event.target.value, event.target);
    });

    input.addEventListener("input", (event) => {
      if (event.isComposing || input.dataset.composing === "true") {
        return;
      }
      updateQuery(event.target.value, event.target);
    });
  });

  [ui.clearButton, ui.stickyClearButton].forEach((button) => {
    button?.addEventListener("click", () => {
      clearFilters();
      (button === ui.stickyClearButton ? ui.stickySearchInput : ui.searchInput)
        ?.focus({ preventScroll: true });
    });
  });

  ui.viewToggleButton?.addEventListener("click", () => {
    state.viewMode = state.viewMode === "list" ? "cards" : "list";
    saveState();
    updateViewModeUI();
    applyFiltersAnimated();
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

    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeCategoryPicker(panel);
        getCategoryPickerButton(panel)?.focus();
        return;
      }

      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const items = Array.from(panel.querySelectorAll(".picker-item:not([hidden])"));
      const idx = items.indexOf(document.activeElement);

      if (idx === -1) {
        (event.key === "ArrowDown" ? items[0] : items[items.length - 1])?.focus();
      } else if (event.key === "ArrowUp" && idx === 0) {
        panel.querySelector(".picker-search")?.focus();
      } else {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        items[Math.max(0, Math.min(items.length - 1, idx + delta))]?.focus();
      }
    });
  });

  // pointerdown with capture covers both mouse and touch, fires before click
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

      const variantTab = event.target.closest("[data-variant-index]");

      if (variantTab) {
        event.stopPropagation();
        const variantCard = variantTab.closest(".command-card");
        const nextIndex = Number.parseInt(variantTab.dataset.variantIndex ?? "", 10);
        if (variantCard && Number.isFinite(nextIndex)) {
          switchCardVariant(variantCard, nextIndex);
        }
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

    container?.addEventListener("keydown", (event) => {
      const card = event.target.closest(".command-card");

      if (!card) {
        return;
      }

      if (event.target === card && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        event.stopPropagation();
        card.querySelector("[data-copy-command]")?.click();
        return;
      }

      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        const activeTag = event.target.tagName;

        if (activeTag === "INPUT" || activeTag === "TEXTAREA") {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        const cards = Array.from(container.querySelectorAll(".command-card"));
        const idx = cards.indexOf(card);
        const delta = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
        cards[idx + delta]?.focus();
      }
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

  ui.securePanel?.addEventListener("toggle", () => {
    if (ui.securePanel.open) {
      preloadDecryptWorker();
    }
  });

  document.addEventListener("keydown", (event) => {
    // Skip all custom shortcut handling while an IME composition is active
    // (Bopomofo, Pinyin, Kana, etc.) so we don't disturb the IME state.
    if (event.isComposing) {
      return;
    }

    const activeElement = document.activeElement;
    const activeTag = activeElement?.tagName;
    const isTyping = isTextEntryElement(activeElement);

    if ((event.key === "/" || (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey))) && !isTyping) {
      event.preventDefault();
      focusActiveSearch();
    }

    if (event.key === "Enter" && shouldFocusMainSearchOnEnter(event.target)) {
      event.preventDefault();
      focusActiveSearch();
      return;
    }

    if (!isTyping && (event.key === "[" || event.key === "]")) {
      event.preventDefault();
      cycleCategory(event.key === "[" ? -1 : 1);
      return;
    }

    if (event.key === "Escape") {
      if (handleScopedInputEscape(activeElement)) {
        event.preventDefault();
        return;
      }

      if (hasOpenCategoryPicker()) {
        closeAllCategoryPickers();
        focusActiveSearch({ select: false });
        return;
      }

      closeShortcutsTooltip();
      clearFilters();
      focusActiveSearch({ select: false });
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

  window.addEventListener("popstate", () => {
    restoreStateFromUrl();
  });

  function closeShortcutsTooltip() {
    shortcutsTooltip?.classList.remove("is-open");
    helpBtn?.setAttribute("aria-expanded", "false");
    shortcutsTooltip?.setAttribute("aria-hidden", "true");
  }

  window.addEventListener("resize", () => {
    updateFilterBarOverflow();
    getCategoryPickerPairs()
      .filter(({ panel }) => !panel.hidden)
      .forEach(({ panel }) => positionPicker(panel));
  }, { passive: true });

  ui.filterBar?.addEventListener("scroll", updateFilterBarOverflow, { passive: true });

  setupUtilityChromeObserver();
}

// Single IntersectionObserver drives both the scroll-to-top button and
// the sticky search bar: the moment the hero is no longer intersecting
// the top of the viewport (offset by 72px to trigger slightly before the
// hero's bottom edge crosses), both chrome elements come in together,
// and they leave together when the user scrolls back. No scroll listener,
// no cached offsetHeight, no threshold to keep in sync with anything.
function setupUtilityChromeObserver() {
  if (!ui.hero || typeof IntersectionObserver === "undefined") {
    return;
  }

  const observer = new IntersectionObserver(
    ([entry]) => {
      const showChrome = !entry.isIntersecting;
      if (ui.scrollTopButton) {
        ui.scrollTopButton.classList.toggle("is-visible", showChrome);
        ui.scrollTopButton.setAttribute("aria-hidden", String(!showChrome));
      }
      if (ui.stickySearchBar) {
        ui.stickySearchBar.classList.toggle("is-visible", showChrome);
        ui.stickySearchBar.setAttribute("aria-hidden", String(!showChrome));
      }
    },
    { rootMargin: "-72px 0px 0px 0px", threshold: 0 }
  );

  observer.observe(ui.hero);
}

async function fetchJson(url, label) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`讀取${label}失敗：${response.status}`);
  }

  return response.json();
}

async function fetchProtectedCategories() {
  try {
    const response = await fetch(SECURE_DATA_URL);

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
      const rawVariants = Array.isArray(item.variants)
        ? item.variants
          .map((variant) => ({
            label: String(variant?.label ?? "").trim(),
            command: String(variant?.command ?? "").trim()
          }))
          .filter((variant) => variant.label && variant.command)
        : [];
      const primaryCommand = rawVariants.length > 0
        ? rawVariants[0].command
        : String(item.command ?? "").trim();

      const normalized = {
        id: item.id ?? `command-${index + 1}`,
        category: derivedCategory,
        command: primaryCommand,
        variants: rawVariants,
        description: String(item.description ?? "").trim(),
        tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
        notes: String(item.notes ?? "").trim()
      };

      const commandLower = normalized.command.toLowerCase();
      const categoryLower = normalized.category.toLowerCase();
      const descriptionLower = normalized.description.toLowerCase();
      const notesLower = normalized.notes.toLowerCase();
      const variantBlob = normalized.variants
        .map((variant) => `${variant.label} ${variant.command}`.toLowerCase())
        .join(" ");

      return {
        ...normalized,
        commandLower,
        categoryLower,
        descriptionLower,
        notesLower,
        tagsLower: normalized.tags.map((t) => t.toLowerCase()),
        searchBlob: [commandLower, descriptionLower, categoryLower, notesLower, normalized.tags.join(" ").toLowerCase(), variantBlob].join(" ")
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
  prunePinnedIds();
  warnOnDuplicateCommandIds(state.commands);
  state.categories = getCategories(state.commands);
  state.commandCounts = getCommandCounts();

  if (state.activeCategory === "pinned" && state.pinned.size === 0) {
    state.activeCategory = "all";
  } else if (state.activeCategory !== "all" && state.activeCategory !== "pinned" && !state.categories.includes(state.activeCategory)) {
    state.activeCategory = "all";
  }

  saveState();
  _pickerGridMinCol = 0; // invalidate column-width cache — categories may have changed
  getCategoryPickerPairs().forEach(({ panel }) => panel.replaceChildren()); // force full rebuild on next open
  updateMetrics();
  renderFilters();
  updateViewModeUI();
  syncWorkerData();
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

  const counts = state.commandCounts;
  const pinnedPill = state.pinned.size > 0 ? [createPinnedFilterButton()] : [];

  const divider = document.createElement("span");
  divider.className = "filter-bar-divider";
  divider.setAttribute("aria-hidden", "true");

  const buttons = [
    createFilterButton("all", "全部", state.commands.length),
    divider,
    ...pinnedPill,
    ...state.categories.map((category) => createFilterButton(category, category, counts[category] || 0))
  ];

  ui.filterBar.replaceChildren(indicator, ...buttons);
  updateFilterBarOverflow();

  // Position indicator instantly (no transition), then enable transition after paint
  syncFilterIndicator();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ui.filterBar.querySelector(".filter-indicator")?.classList.add("is-ready");
    });
  });

  const activeButton = ui.filterBar.querySelector(`[data-category="${escapeCssSelector(state.activeCategory)}"]`);
  centerFilterPillHorizontally(activeButton);

  renderCategoryPickers();
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
  centerFilterPillHorizontally(activeButton);

  const pickerLabel = getActiveCategoryLabel();
  getCategoryPickerPairs().forEach(({ button, panel }) => {
    button?.setAttribute("aria-label", `分類選單，當前 ${pickerLabel}`);
    button?.setAttribute("title", `分類選單：${pickerLabel}`);

    if (!panel.hidden) {
      renderCategoryPicker(panel);
    }
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

  // Batch all layout reads before any writes to avoid forced reflows
  const w = activeBtn.offsetWidth;
  const h = activeBtn.offsetHeight;
  const top = activeBtn.offsetTop;
  const left = activeBtn.offsetLeft;

  indicator.style.opacity = "1";
  indicator.style.width = `${w}px`;
  indicator.style.height = `${h}px`;
  indicator.style.top = `${top}px`;
  indicator.style.transform = `translateX(${left}px)`;
}

function createFilterButton(category, label, count = 0) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `filter-pill${state.activeCategory === category ? " is-active" : ""}`;
  button.dataset.category = category;
  button.setAttribute("aria-pressed", String(state.activeCategory === category));
  button.innerHTML = `
    <span class="filter-pill-label">${escapeHtml(label)}</span>
    <span class="filter-pill-count">${count}</span>
  `;
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

function getCommandCounts() {
  return state.commands.reduce((accumulator, command) => {
    accumulator[command.category] = (accumulator[command.category] || 0) + 1;
    return accumulator;
  }, {});
}

function prunePinnedIds() {
  const validIds = new Set(state.commands.map((item) => item.id));
  const beforeSize = state.pinned.size;
  state.pinned = new Set([...state.pinned].filter((id) => validIds.has(id)));

  if (state.pinned.size !== beforeSize) {
    savePinned();
  }
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

  // Reset search state from previous open
  const searchInput = panel.querySelector(".picker-search");
  if (searchInput && searchInput.value) {
    searchInput.value = "";
    filterPickerCategories(panel, "");
  }

  panel.hidden = false;
  const button = getCategoryPickerButton(panel);
  button?.setAttribute("aria-expanded", "true");
  button?.classList.add("is-open");

  window.requestAnimationFrame(() => {
    calibratePickerGrid(panel);
    positionPicker(panel);
    searchInput?.focus();
  });
}

function closeCategoryPicker(panel) {
  if (!panel) {
    return;
  }

  panel.hidden = true;
  panel.classList.remove("expand-right");
  const button = getCategoryPickerButton(panel);
  button?.setAttribute("aria-expanded", "false");
  button?.classList.remove("is-open");
}

function calibratePickerGrid(panel) {
  const grid = panel.querySelector(".picker-groups-grid");

  if (!grid) {
    return;
  }

  // Re-use cached result — categories are fixed at runtime
  if (_pickerGridMinCol > 0) {
    grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${_pickerGridMinCol}px, 1fr))`;
    return;
  }

  const items = Array.from(grid.querySelectorAll(".picker-item"));

  if (!items.length) {
    return;
  }

  // Measure longest label text with reusable module-level canvas
  const sampleLabel = items[0]?.querySelector(".picker-item-label");
  const computedFont = sampleLabel ? getComputedStyle(sampleLabel).font : "13px system-ui";
  const ctx = _pickerMeasureCanvas.getContext("2d");
  ctx.font = computedFont;

  let maxLabelPx = 0;

  items.forEach((item) => {
    const text = item.querySelector(".picker-item-label")?.textContent?.trim() ?? "";
    maxLabelPx = Math.max(maxLabelPx, ctx.measureText(text).width);
  });

  // item padding (0.6rem × 2) + count badge (~38px) + flex gap (0.5rem)
  const rootFs = parseFloat(getComputedStyle(document.documentElement).fontSize);
  _pickerGridMinCol = Math.ceil(maxLabelPx + rootFs * 1.2 + 38 + rootFs * 0.5) + 4;

  grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${_pickerGridMinCol}px, 1fr))`;
}

function positionPicker(panel) {
  if (!panel) {
    return;
  }

  const button = getCategoryPickerButton(panel);

  if (!button) {
    return;
  }

  const btnRect = button.getBoundingClientRect();
  const margin = 8;
  const maxWidth = 860;

  // Fill leftward from button's right edge to viewport left edge, capped at maxWidth
  const desiredWidth = Math.min(Math.floor(btnRect.right) - margin, maxWidth);
  panel.style.width = `${Math.max(desiredWidth, 280)}px`;
  panel.style.right = "";
  panel.style.left = "";
  panel.classList.remove("expand-right");

  // Explicitly force reflow so getBoundingClientRect reflects the new width
  void panel.offsetWidth;

  // Re-check if left edge overflows viewport after applying new width
  const rect = panel.getBoundingClientRect();

  if (rect.left < margin) {
    panel.style.right = "auto";
    panel.style.left = "0";
    panel.classList.add("expand-right");
  }
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

function groupCategories(categories) {
  const assigned = new Set();
  return CATEGORY_GROUPS
    .map(({ label, match }) => {
      const items = categories.filter((c) => !assigned.has(c) && match(c));
      items.forEach((c) => assigned.add(c));
      return { label, items };
    })
    .filter((g) => g.items.length > 0);
}

function createPickerButton(key, label, count) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `picker-item${state.activeCategory === key ? " is-active" : ""}`;
  button.dataset.category = key;
  button.innerHTML = `
    <span class="picker-item-label">${escapeHtml(label)}</span>
    <span class="picker-item-count">${count}</span>
  `;
  return button;
}

function filterPickerCategories(panel, query) {
  const groups = panel.querySelectorAll(".picker-group");
  const groupsGrid = panel.querySelector(".picker-groups-grid");
  const allWrap = panel.querySelector(".picker-group-all");
  const emptyEl = panel.querySelector(".picker-empty");
  let totalVisible = 0;
  let topRowVisible = 0;

  if (allWrap) {
    const topItems = allWrap.querySelectorAll(".picker-item");

    topItems.forEach((item) => {
      const label = item.querySelector(".picker-item-label")?.textContent?.toLowerCase() ?? "";
      const visible = !query || label.includes(query);
      item.hidden = !visible;

      if (visible) {
        totalVisible++;
        topRowVisible++;
      }
    });
  }

  groups.forEach((group) => {
    const items = group.querySelectorAll(".picker-item");
    let groupVisible = 0;

    items.forEach((item) => {
      const label = item.querySelector(".picker-item-label")?.textContent?.toLowerCase() ?? "";
      const visible = !query || label.includes(query);
      item.hidden = !visible;
      if (visible) groupVisible++;
    });

    group.hidden = groupVisible === 0;
    totalVisible += groupVisible;
  });

  if (groupsGrid) {
    groupsGrid.hidden = totalVisible - topRowVisible === 0;
  }

  if (emptyEl) emptyEl.hidden = totalVisible > 0;
}

function renderCategoryPicker(panel) {
  if (!panel) {
    return;
  }

  // Fast path: if DOM already built, just update active states and counts in-place
  if (panel.children.length > 0 && panel.querySelector(".picker-groups-grid")) {
    updatePickerInPlace(panel);
    return;
  }

  const counts = state.commandCounts;
  const fragment = document.createDocumentFragment();

  // Search input
  const searchWrap = document.createElement("div");
  searchWrap.className = "picker-search-wrap";
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = "picker-search";
  searchInput.placeholder = "搜尋分類…";
  searchInput.autocomplete = "off";
  searchInput.setAttribute("spellcheck", "false");
  searchInput.setAttribute("aria-label", "搜尋分類");
  searchInput.addEventListener("input", (e) => {
    filterPickerCategories(panel, e.target.value.trim().toLowerCase());
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      panel.querySelector(".picker-item:not([hidden])")?.focus();
    }
  });
  searchWrap.appendChild(searchInput);
  fragment.appendChild(searchWrap);

  // "全部" row
  const allWrap = document.createElement("div");
  allWrap.className = "picker-group-all";
  allWrap.appendChild(createPickerButton("all", "全部", state.commands.length));
  if (state.pinned.size > 0) {
    allWrap.appendChild(createPickerButton("pinned", "已釘選", state.pinned.size));
  }
  fragment.appendChild(allWrap);

  // Grouped categories inside a multi-column grid
  const groupsGrid = document.createElement("div");
  groupsGrid.className = "picker-groups-grid";

  groupCategories(state.categories).forEach(({ label, items }) => {
    const groupEl = document.createElement("div");
    groupEl.className = "picker-group";

    const groupLabel = document.createElement("p");
    groupLabel.className = "picker-group-label";
    groupLabel.textContent = label;
    groupEl.appendChild(groupLabel);

    items.forEach((cat) => groupEl.appendChild(createPickerButton(cat, cat, counts[cat] || 0)));
    groupsGrid.appendChild(groupEl);
  });

  fragment.appendChild(groupsGrid);

  // Empty state
  const emptyEl = document.createElement("p");
  emptyEl.className = "picker-empty";
  emptyEl.textContent = "沒有符合的分類";
  emptyEl.hidden = true;
  fragment.appendChild(emptyEl);

  panel.replaceChildren(fragment);

  const activeLabel = getActiveCategoryLabel();
  getCategoryPickerButton(panel)?.setAttribute("aria-label", `分類選單，當前 ${activeLabel}`);
  getCategoryPickerButton(panel)?.setAttribute("title", `分類選單：${activeLabel}`);
}

function updatePickerInPlace(panel) {
  const counts = state.commandCounts;

  panel.querySelectorAll(".picker-item[data-category]").forEach((item) => {
    const key = item.dataset.category;
    const isActive = key === state.activeCategory;
    item.classList.toggle("is-active", isActive);

    const countEl = item.querySelector(".picker-item-count");
    if (countEl) {
      if (key === "all") {
        countEl.textContent = state.commands.length;
      } else if (key === "pinned") {
        countEl.textContent = state.pinned.size;
      } else {
        countEl.textContent = counts[key] || 0;
      }
    }
  });

  // Sync pinned button presence
  const allWrap = panel.querySelector(".picker-group-all");
  const pinnedBtn = allWrap?.querySelector('[data-category="pinned"]');

  if (state.pinned.size > 0 && !pinnedBtn && allWrap) {
    allWrap.appendChild(createPickerButton("pinned", "已釘選", state.pinned.size));
  } else if (state.pinned.size === 0 && pinnedBtn) {
    pinnedBtn.remove();
  }

  const activeLabel = getActiveCategoryLabel();
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

function isTextEntryElement(element) {
  if (!element) {
    return false;
  }

  const tagName = element.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || element.isContentEditable;
}

function shouldFocusMainSearchOnEnter(target) {
  if (hasOpenCategoryPicker()) {
    return false;
  }

  if (!(target instanceof Element)) {
    return true;
  }

  if (isTextEntryElement(target)) {
    return false;
  }

  if (target.closest(".command-card, .placeholder-fields, .secure-form, .category-picker, .help-wrap")) {
    return false;
  }

  if (target.closest("button, a, summary, [role='button'], [role='dialog']")) {
    return false;
  }

  return true;
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

  let plaintext;
  try {
    plaintext = await decryptInWorker(target, password);
  } catch (error) {
    console.warn("decrypt failed", error);
    form.reset();
    if (error?.phase === "init") {
      setProtectedStatus(protectedId, "載入解密模組失敗，請檢查網路後重試。", true);
    } else {
      setProtectedStatus(protectedId, "無法解鎖，請確認輸入內容。", true);
    }
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(plaintext);
  } catch (parseError) {
    console.warn("decrypted payload was not valid JSON", parseError);
    form.reset();
    setProtectedStatus(protectedId, "無法解鎖，請確認輸入內容。", true);
    return;
  }

  const decrypted = normalizeCommands(parsed, target.label);
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
  const seq = ++workerSeq;
  lastFilterAnimated = animated;

  // First call: run filter on the main thread instead of waiting on the
  // worker. 189 commands filter in a few ms and we skip the worker-script
  // fetch + init-message roundtrip on the critical path. The worker is
  // still being warmed by syncWorkerData / eager getSearchWorker() so
  // subsequent filters use it.
  if (!firstFilterDone) {
    firstFilterDone = true;
    const filteredPublic = filterCommands(state.publicCommands, tokens, state.activeCategory, state.pinned);
    const filteredProtected = filterCommands(getUnlockedCommands(), tokens, state.activeCategory, state.pinned);
    _renderFilterResults(filteredPublic, filteredProtected, animated);
    return;
  }

  const worker = getSearchWorker();

  if (worker) {
    worker.postMessage({
      type: "search",
      seq,
      tokens,
      activeCategory: state.activeCategory,
      pinned: Array.from(state.pinned)
    });
  } else {
    const filteredPublic = filterCommands(state.publicCommands, tokens, state.activeCategory, state.pinned);
    const filteredProtected = filterCommands(getUnlockedCommands(), tokens, state.activeCategory, state.pinned);
    _renderFilterResults(filteredPublic, filteredProtected, animated);
  }
}

function _renderFilterResults(filteredPublic, filteredProtected, animated) {
  const totalResults = filteredPublic.length + filteredProtected.length;
  updateSummary(totalResults);
  const doRender = () => renderResultSections(filteredPublic, filteredProtected, totalResults);

  if (animated && document.startViewTransition) {
    document.startViewTransition(doRender);
  } else {
    doRender();
  }
}

function handleWorkerResult(event) {
  const { seq, filteredPublic, filteredProtected } = event.data;

  if (seq !== workerSeq) {
    return;
  }

  _renderFilterResults(filteredPublic, filteredProtected, lastFilterAnimated);
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

  let pages;

  if (currentPage <= 3) {
    pages = [1, 2, 3, 4, totalPages];
  } else if (currentPage >= totalPages - 2) {
    pages = [1, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  } else {
    pages = [1, currentPage - 1, currentPage, currentPage + 1, totalPages];
  }

  // Fill single-page gaps (e.g. [1,2,3,4,6] → [1,2,3,4,5,6]) to avoid confusing skips
  const result = [pages[0]];

  for (let i = 1; i < pages.length; i++) {
    if (pages[i] - result[result.length - 1] === 2) {
      result.push(result[result.length - 1] + 1);
    }

    result.push(pages[i]);
  }

  return result;
}

function tokenize(query) {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function hasFuzzyMatch(item, tokens) {
  for (const token of tokens) {
    if (token.length < 3) continue;
    if (item.searchBlob.includes(token)) continue;

    if (fuzzyScore(token, item.commandLower) >= 0 || fuzzyScore(token, item.descriptionLower) >= 0) {
      return true;
    }
  }

  return false;
}

// Per-container render generation. Each renderResults call bumps the
// counter for its container; any pending rAF chunk from a previous
// render checks against the current gen and bails if a newer render
// has already replaced the DOM.
const renderGenerations = new WeakMap();

function renderResults(container, items) {
  if (!items.length) {
    const queryLabel = state.query.trim() || "*";
    const scope = state.activeCategory && state.activeCategory !== "all"
      ? `./${state.activeCategory}`
      : "./commands";
    container.innerHTML = `
      <article class="empty-state" role="status">
        <p class="empty-state-prompt"><span class="empty-state-sigil">$</span>grep -r <span class="empty-state-token">"${escapeHtml(queryLabel)}"</span> ${escapeHtml(scope)}</p>
        <p class="empty-state-result">→ <span class="empty-state-zero">0 matches</span></p>
        <p class="empty-state-hint">試試更短的關鍵字，或先清除目前的分類篩選。</p>
      </article>
    `;
    // Invalidate any pending deferred render for this container so a
    // stale rAF callback doesn't append orphan cards into the empty state.
    renderGenerations.set(container, (renderGenerations.get(container) ?? 0) + 1);
    return;
  }

  const myGen = (renderGenerations.get(container) ?? 0) + 1;
  renderGenerations.set(container, myGen);

  const tokens = tokenize(state.query);
  const highlightPattern = compileHighlightPattern(tokens);
  const commandHighlightPattern = compileTextHighlightPattern(tokens);
  const ctx = { tokens, highlightPattern, commandHighlightPattern };

  // First batch: render above-the-fold cards synchronously so the user
  // sees content the moment the filter result lands.
  const firstBatchEnd = Math.min(FIRST_RENDER_BATCH, items.length);
  const firstFragment = document.createDocumentFragment();
  for (let i = 0; i < firstBatchEnd; i++) {
    firstFragment.appendChild(buildCommandCard(items[i], i, ctx));
  }
  container.replaceChildren(firstFragment);

  if (firstBatchEnd >= items.length) {
    return;
  }

  // Remaining cards: append in DEFERRED_RENDER_CHUNK-sized groups on
  // subsequent animation frames. Each chunk checks the render gen so
  // that a newer filter / pagination click supersedes any in-flight work.
  scheduleRemainingCards(container, items, firstBatchEnd, myGen, ctx);
}

function scheduleRemainingCards(container, items, startIdx, gen, ctx) {
  requestAnimationFrame(() => {
    if (renderGenerations.get(container) !== gen) {
      return;
    }

    const endIdx = Math.min(startIdx + DEFERRED_RENDER_CHUNK, items.length);
    const fragment = document.createDocumentFragment();
    for (let i = startIdx; i < endIdx; i++) {
      fragment.appendChild(buildCommandCard(items[i], i, ctx));
    }
    container.appendChild(fragment);

    if (endIdx < items.length) {
      scheduleRemainingCards(container, items, endIdx, gen, ctx);
    }
  });
}

function buildCommandCard(item, index, ctx) {
  const { tokens, highlightPattern, commandHighlightPattern } = ctx;
  const isFuzzy = tokens.length > 0 && hasFuzzyMatch(item, tokens);
  const hasVariants = item.variants.length > 1;
  const activeVariantIndex = hasVariants ? getActiveVariantIndex(item) : 0;
  const activeCommand = hasVariants ? item.variants[activeVariantIndex].command : item.command;
  const placeholders = extractPlaceholders(activeCommand);
  const placeholderValues = state.placeholderValues.get(item.id) ?? {};
  const previewCommand = resolveCommandTemplate(activeCommand, placeholderValues);
  const commandLanguage = getCommandHighlightLanguage(item);
  const accent = getCategoryAccent(item.category);
  const isPinned = state.pinned.has(item.id);
  const card = document.createElement("article");
  card.className = `command-card${isPinned ? " is-pinned" : ""}${hasVariants ? " has-variants" : ""}`;
  card.dataset.commandId = item.id;
  card.style.setProperty("--category-accent", accent.color);
  card.style.setProperty("--category-accent-soft", accent.soft);
  card.style.setProperty("--category-accent-border", accent.border);
  card.style.setProperty("--card-index", String(Math.min(index, 5)));
  const variantStripHtml = hasVariants
    ? `
        <div class="variant-strip" role="tablist" aria-label="指令變體">
          ${item.variants.map((variant, variantIndex) => `
            <button
              class="variant-tab${variantIndex === activeVariantIndex ? " is-active" : ""}"
              type="button"
              role="tab"
              aria-selected="${variantIndex === activeVariantIndex}"
              data-variant-index="${variantIndex}"
            >${highlightText(variant.label, highlightPattern)}</button>
          `).join("")}
        </div>
      `
    : "";
  card.innerHTML = `
      <div class="card-top">
        <button class="category-badge category-badge-button" type="button" data-category="${escapeAttribute(item.category)}" aria-label="篩選分類 ${escapeAttribute(item.category)}" title="篩選分類 ${escapeAttribute(item.category)}">
          ${highlightText(item.category, highlightPattern)}
        </button>
        ${isFuzzy ? '<span class="fuzzy-hint">近似匹配</span>' : ''}
        <button class="pin-button" type="button" data-pin-id="${escapeAttribute(item.id)}" aria-label="${isPinned ? "取消釘選" : "釘選此指令"}" aria-pressed="${isPinned}" title="${isPinned ? "取消釘選" : "釘選"}">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><polygon points="8,1.5 10.2,6 15,6.6 11.5,9.9 12.5,14.5 8,12.1 3.5,14.5 4.5,9.9 1,6.6 5.8,6"/></svg>
        </button>
      </div>
      ${variantStripHtml}
      <div class="command-block">
        <pre class="command-line"><code class="command-code" data-command-language="${escapeAttribute(commandLanguage)}"></code></pre>
        <div class="placeholder-slot">${renderPlaceholderFields(placeholders, placeholderValues)}</div>
        <button class="copy-button" type="button" data-copy-command="${escapeAttribute(activeCommand)}">複製</button>
      </div>
      <p class="description">${highlightText(item.description, highlightPattern)}</p>
      ${item.notes ? `<p class="notes">${highlightText(item.notes, highlightPattern)}</p>` : ""}
      <div class="card-footer">
        <div class="tag-list">
          ${item.tags.map((tag) => `<button class="tag tag-btn" type="button" data-tag="${escapeAttribute(tag)}">#${highlightText(tag, highlightPattern)}</button>`).join("")}
        </div>
      </div>
    `;
  renderCommandCode(
    card.querySelector(".command-code"),
    previewCommand,
    commandLanguage,
    commandHighlightPattern
  );
  card.setAttribute("tabindex", "0");
  return card;
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
  ui.commandCount.innerHTML = `<span class="meta-num">${state.commands.length}</span> 筆指令`;
  ui.categoryCount.innerHTML = `<span class="meta-num">${state.categories.length}</span> 個分類`;
}

function updateSummary(resultCount) {
  const categoryLabel = getActiveCategoryLabel();
  const trimmedQuery = state.query.trim();
  const queryLabel = trimmedQuery ? `，關鍵字「${trimmedQuery}」` : "";
  const hasActiveFilters = trimmedQuery.length > 0 || state.activeCategory !== "all";

  ui.activeState.textContent = `目前：${categoryLabel}${queryLabel}`;
  ui.resultSummary.textContent = `共找到 ${resultCount} 筆結果`;
  ui.clearButton.hidden = !hasActiveFilters;
  if (ui.stickyClearButton) {
    ui.stickyClearButton.hidden = !hasActiveFilters;
  }
  updateStickySearchState();
}

function updateQuery(value, sourceInput = null) {
  state.query = String(value ?? "");
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
  const activeLabel = getActiveCategoryLabel();

  if (ui.stickyActiveCategory) {
    ui.stickyActiveCategory.textContent = activeLabel;
  }
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      query: state.query,
      activeCategory: state.activeCategory,
      viewMode: state.viewMode
    })
  );
  syncUrlState();
}

function restoreState() {
  let nextQuery = "";
  let nextCategory = "all";
  let nextViewMode = "cards";
  const rawState = localStorage.getItem(STORAGE_KEY);

  if (rawState) {
    try {
      const parsed = JSON.parse(rawState);
      nextQuery = typeof parsed.query === "string" ? parsed.query : "";
      nextCategory = typeof parsed.activeCategory === "string" ? parsed.activeCategory : "all";
      nextViewMode = parsed.viewMode === "list" ? "list" : "cards";
    } catch (error) {
      console.warn("restoreState failed", error);
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  const urlState = getUrlState();

  if (urlState.hasAnyParam) {
    nextQuery = urlState.query;
    nextCategory = urlState.activeCategory;
    nextViewMode = urlState.viewMode;
  }

  state.query = nextQuery;
  state.activeCategory = nextCategory || "all";
  state.viewMode = nextViewMode;
  syncSearchInputs();
}

function getUrlState() {
  const params = new URLSearchParams(window.location.search);
  const hasAnyParam = params.has("q") || params.has("cat") || params.has("view");
  let query = "";
  let activeCategory = "all";
  let viewMode = "cards";

  if (params.has("q")) {
    query = params.get("q") ?? "";
  }

  if (params.has("cat")) {
    activeCategory = params.get("cat") ?? "all";
  }

  if (params.get("view") === "list") {
    viewMode = "list";
  } else if (params.has("view")) {
    viewMode = "cards";
  }

  return {
    hasAnyParam,
    query,
    activeCategory: activeCategory || "all",
    viewMode
  };
}

function restoreStateFromUrl() {
  const urlState = getUrlState();

  state.query = urlState.query;
  state.activeCategory = urlState.activeCategory;
  state.viewMode = urlState.viewMode;
  resetPagination();
  syncSearchInputs();
  updateViewModeUI();

  if (!state.commands.length) {
    return;
  }

  if (state.activeCategory === "pinned" && state.pinned.size === 0) {
    state.activeCategory = "all";
  } else if (state.activeCategory !== "all" && state.activeCategory !== "pinned" && !state.categories.includes(state.activeCategory)) {
    state.activeCategory = "all";
  }

  updateFilterPillActive();
  applyFilters();
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

function isSensitiveToken(token) {
  return SENSITIVE_TOKEN_PATTERN.test(token);
}

function savePlaceholders() {
  const persistent = {};
  const session = {};

  state.placeholderValues.forEach((values, id) => {
    const persistentValues = {};
    const sessionValues = {};

    Object.entries(values).forEach(([token, value]) => {
      if (!value) return;

      if (isSensitiveToken(token)) {
        sessionValues[token] = value;
      } else {
        persistentValues[token] = value;
      }
    });

    if (Object.keys(persistentValues).length) persistent[id] = persistentValues;
    if (Object.keys(sessionValues).length) session[id] = sessionValues;
  });

  localStorage.setItem(PLACEHOLDER_KEY, JSON.stringify(persistent));
  sessionStorage.setItem(PLACEHOLDER_SESSION_KEY, JSON.stringify(session));
}

function restorePlaceholders() {
  const merged = new Map();

  [
    { raw: localStorage.getItem(PLACEHOLDER_KEY), store: localStorage, key: PLACEHOLDER_KEY },
    { raw: sessionStorage.getItem(PLACEHOLDER_SESSION_KEY), store: sessionStorage, key: PLACEHOLDER_SESSION_KEY }
  ].forEach(({ raw, store, key }) => {
    if (!raw) return;

    try {
      const data = JSON.parse(raw);

      if (data && typeof data === "object" && !Array.isArray(data)) {
        Object.entries(data).forEach(([id, values]) => {
          if (values && typeof values === "object") {
            merged.set(id, { ...(merged.get(id) || {}), ...values });
          }
        });
      }
    } catch (error) {
      console.warn("restorePlaceholders failed", error);
      store.removeItem(key);
    }
  });

  merged.forEach((values, id) => state.placeholderValues.set(id, values));
}

function togglePin(commandId, buttonEl = null) {
  const wasPinned = state.pinned.has(commandId);

  if (wasPinned) {
    state.pinned.delete(commandId);
  } else {
    state.pinned.add(commandId);
  }

  savePinned();

  const categoryChanged = state.pinned.size === 0 && state.activeCategory === "pinned";

  if (categoryChanged) {
    state.activeCategory = "all";
  }

  if (buttonEl) {
    const isPinned = !wasPinned;
    buttonEl.setAttribute("aria-pressed", String(isPinned));
    buttonEl.setAttribute("aria-label", isPinned ? "取消釘選" : "釘選此指令");
    buttonEl.setAttribute("title", isPinned ? "取消釘選" : "釘選");
    buttonEl.closest(".command-card")?.classList.toggle("is-pinned", isPinned);
  }

  updatePinnedPill();

  // Full re-render is only necessary when the toggled pin actually changes
  // which cards are visible — that's either when we just emptied the pinned
  // filter (and bounced back to "all") or when the user is currently looking
  // at the pinned list (where the toggled card must appear / disappear).
  // In every other case, the pin button's visual state is already updated
  // above, and the pinned-first re-ordering can wait for the next genuine
  // filter change instead of rebuilding every visible card on every star click.
  if (categoryChanged) {
    updateFilterPillActive();
    applyFiltersAnimated();
    return;
  }

  if (state.activeCategory === "pinned") {
    applyFilters();
  }
}

function updatePinnedPill() {
  const existingPill = ui.filterBar.querySelector(".filter-pill-pinned");

  if (state.pinned.size === 0) {
    if (existingPill) {
      existingPill.remove();
    }

    syncFilterIndicator();
    return;
  }

  if (existingPill) {
    const countEl = existingPill.querySelector(".pin-pill-count");

    if (countEl) {
      countEl.textContent = state.pinned.size;
    }
  } else {
    const allPill = ui.filterBar.querySelector('[data-category="all"]');
    const newPill = createPinnedFilterButton();

    if (allPill) {
      allPill.after(newPill);
    } else {
      ui.filterBar.prepend(newPill);
    }
  }

  syncFilterIndicator();
}

function filterByTag(tag) {
  state.query = tag;
  resetPagination();
  syncSearchInputs();
  saveState();
  applyFiltersAnimated();
}

function getActiveCategoryLabel() {
  if (state.activeCategory === "all") {
    return "全部分類";
  }

  if (state.activeCategory === "pinned") {
    return "已釘選";
  }

  return state.activeCategory;
}

function getFilterSequence() {
  return [
    "all",
    ...(state.pinned.size > 0 ? ["pinned"] : []),
    ...state.categories
  ];
}

function cycleCategory(direction) {
  const sequence = getFilterSequence();
  const currentIndex = Math.max(0, sequence.indexOf(state.activeCategory));
  const nextIndex = (currentIndex + direction + sequence.length) % sequence.length;
  applyCategoryFilter(sequence[nextIndex]);
}

function updateViewModeUI() {
  const isListView = state.viewMode === "list";
  document.body.classList.toggle("is-list-view", isListView);

  if (ui.viewToggleButton) {
    ui.viewToggleButton.classList.toggle("is-active", isListView);
    ui.viewToggleButton.setAttribute("aria-pressed", String(isListView));
    ui.viewToggleButton.setAttribute("title", isListView ? "切換成卡片檢視" : "切換成緊湊檢視");
    ui.viewToggleButton.textContent = isListView ? "卡片" : "緊湊";
  }
}

function syncUrlState() {
  const params = new URLSearchParams(window.location.search);
  const trimmedQuery = state.query.trim();

  if (trimmedQuery) {
    params.set("q", trimmedQuery);
  } else {
    params.delete("q");
  }

  if (state.activeCategory !== "all") {
    params.set("cat", state.activeCategory);
  } else {
    params.delete("cat");
  }

  if (state.viewMode === "list") {
    params.set("view", "list");
  } else {
    params.delete("view");
  }

  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", nextUrl);
}

async function copyToClipboard(text, button, card = null) {
  try {
    await navigator.clipboard.writeText(text);

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

function getActiveVariantIndex(item) {
  const stored = state.activeVariants.get(item.id);
  const total = item.variants.length;

  if (!total) {
    return 0;
  }

  if (typeof stored === "number" && stored >= 0 && stored < total) {
    return stored;
  }

  return 0;
}

function switchCardVariant(card, nextIndex) {
  const commandId = card.dataset.commandId;
  const item = commandId
    ? state.commands.find((entry) => entry.id === commandId)
    : null;

  if (!item || !item.variants.length) {
    return;
  }

  const clampedIndex = Math.max(0, Math.min(nextIndex, item.variants.length - 1));

  if (clampedIndex === getActiveVariantIndex(item)) {
    return;
  }

  state.activeVariants.set(item.id, clampedIndex);

  const activeCommand = item.variants[clampedIndex].command;
  const copyButton = card.querySelector("[data-copy-command]");
  if (copyButton) {
    copyButton.dataset.copyCommand = activeCommand;
  }

  card.querySelectorAll(".variant-tab").forEach((tab) => {
    const tabIndex = Number.parseInt(tab.dataset.variantIndex ?? "", 10);
    const isActive = tabIndex === clampedIndex;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  const placeholderSlot = card.querySelector(".placeholder-slot");
  if (placeholderSlot) {
    const placeholders = extractPlaceholders(activeCommand);
    const placeholderValues = state.placeholderValues.get(item.id) ?? {};
    placeholderSlot.innerHTML = renderPlaceholderFields(placeholders, placeholderValues);
  }

  updateCommandPreview(card);
}

// Cache placeholder extraction results. The command template text never
// changes once normalized, so the regex + Set + map + filter work only
// needs to happen once per unique template.
const placeholderCache = new Map();

function extractPlaceholders(command) {
  const key = String(command ?? "");
  const cached = placeholderCache.get(key);
  if (cached) return cached;

  const matches = key.match(/<[^>]+>/g) ?? [];
  const tokens = [...new Set(matches.map((token) => token.trim()).filter(Boolean))];
  placeholderCache.set(key, tokens);
  return tokens;
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
  savePlaceholders();
}

function handleScopedInputEscape(activeElement) {
  const placeholderInput = activeElement?.closest?.("[data-placeholder-token]");

  if (placeholderInput) {
    if (placeholderInput.value) {
      placeholderInput.value = "";
      const card = placeholderInput.closest(".command-card");
      syncCardPlaceholderValues(card);
      updateCommandPreview(card);
      announce("已清除目前欄位。");
    }

    return true;
  }

  const secureInput = activeElement instanceof Element
    && activeElement.matches(".secure-input")
    && activeElement.closest("[data-secure-form]")
    ? activeElement
    : null;

  if (secureInput) {
    if (secureInput.value) {
      secureInput.value = "";
      announce("已清除目前欄位。");
    }

    return true;
  }

  return false;
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

  renderCommandCode(
    code,
    buildResolvedCommand(card, copyButton.dataset.copyCommand),
    code.dataset.commandLanguage || "bash",
    compileTextHighlightPattern(tokenize(state.query))
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

function getSearchWorker() {
  if (searchWorker) {
    return searchWorker;
  }

  if (searchWorkerDisabled) {
    return null;
  }

  if (typeof Worker === "undefined") {
    return null;
  }

  try {
    const worker = new Worker("./search.worker.js");
    worker.onmessage = handleWorkerResult;
    worker.onerror = (e) => {
      console.warn("Search worker error, falling back to sync", e);
      try {
        worker.terminate();
      } catch (terminateError) {
        console.warn("Search worker terminate failed", terminateError);
      }
      searchWorker = null;
      searchWorkerDisabled = true;
      const tokens = tokenize(state.query);
      const filteredPublic = filterCommands(state.publicCommands, tokens, state.activeCategory, state.pinned);
      const filteredProtected = filterCommands(getUnlockedCommands(), tokens, state.activeCategory, state.pinned);
      _renderFilterResults(filteredPublic, filteredProtected, lastFilterAnimated);
    };
    searchWorker = worker;
  } catch (e) {
    console.warn("Search worker unavailable, using sync fallback", e);
    searchWorkerDisabled = true;
  }

  return searchWorker;
}

function syncWorkerData() {
  const worker = getSearchWorker();

  if (!worker) {
    return;
  }

  worker.postMessage({
    type: "init",
    publicCommands: state.publicCommands,
    unlockedCommands: getUnlockedCommands()
  });
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

// Decrypt worker wrapper. Lazily creates the worker on first use, then
// reuses it for the rest of the session. preloadDecryptWorker is a
// fire-and-forget warm-up triggered when the secure panel toggles open
// so importScripts(crypto-js) happens before the user submits.
function getDecryptWorker() {
  if (decryptWorker) {
    return decryptWorker;
  }

  if (typeof Worker === "undefined") {
    return null;
  }

  try {
    const worker = new Worker("./decrypt.worker.js");
    worker.onmessage = handleDecryptWorkerMessage;
    worker.onerror = (event) => {
      console.warn("Decrypt worker error", event);
      try { worker.terminate(); } catch (_) { /* ignore */ }
      decryptWorker = null;
      const error = new Error("Decrypt worker crashed");
      for (const pending of decryptPending.values()) {
        pending.reject(error);
      }
      decryptPending.clear();
    };
    decryptWorker = worker;
  } catch (error) {
    console.warn("Decrypt worker unavailable", error);
    return null;
  }

  return decryptWorker;
}

function handleDecryptWorkerMessage(event) {
  const data = event.data;
  if (!data || data.type !== "decrypt-result") {
    return;
  }

  const pending = decryptPending.get(data.id);
  if (!pending) {
    return;
  }
  decryptPending.delete(data.id);

  if (data.success) {
    pending.resolve(data.plaintext);
  } else {
    const error = new Error(data.error || "Decrypt failed");
    error.phase = data.phase;
    pending.reject(error);
  }
}

function preloadDecryptWorker() {
  const worker = getDecryptWorker();
  if (!worker) {
    return;
  }
  worker.postMessage({ type: "preload" });
}

function decryptInWorker(target, password) {
  const worker = getDecryptWorker();
  if (!worker) {
    return Promise.reject(new Error("Decrypt worker unavailable"));
  }
  const id = ++decryptWorkerSeq;
  return new Promise((resolve, reject) => {
    decryptPending.set(id, { resolve, reject });
    worker.postMessage({ type: "decrypt", id, target, password });
  });
}

function upgradeAllCodeBlocks() {
  if (!window.hljs) {
    return;
  }

  const pattern = compileTextHighlightPattern(tokenize(state.query));

  document.querySelectorAll(".command-code").forEach((code) => {
    const text = code.dataset.commandText;

    if (text === undefined) {
      return;
    }

    const language = code.dataset.commandLanguage || "bash";
    renderCommandCode(code, text, language, pattern);
  });
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


// scrollIntoView with block:"nearest" also scrolls the WINDOW to bring the
// element into vertical view — which yanked the page back to the top every
// time a filter pill was re-centered (e.g. on clearFilters via Esc). We only
// want horizontal re-centering inside the filter bar, so compute the scroll
// target ourselves and touch ui.filterBar.scrollLeft directly.
function centerFilterPillHorizontally(pill) {
  if (!pill || !ui.filterBar) return;
  const bar = ui.filterBar;
  const target = pill.offsetLeft + pill.offsetWidth / 2 - bar.clientWidth / 2;
  bar.scrollTo({
    left: Math.max(0, target),
    behavior: "smooth"
  });
}

function updateFilterBarOverflow() {
  const bar = ui.filterBar;
  const wrap = bar?.parentElement;
  if (!bar || !wrap) return;
  const maxScroll = bar.scrollWidth - bar.clientWidth;
  const hasLeft = bar.scrollLeft > 4;
  const hasRight = maxScroll > 4 && bar.scrollLeft < maxScroll - 4;
  wrap.classList.toggle("has-left-overflow", hasLeft);
  wrap.classList.toggle("has-right-overflow", hasRight);
}

function getActiveSearchInput() {
  const stickyVisible = ui.stickySearchBar?.classList.contains("is-visible");
  return stickyVisible && ui.stickySearchInput ? ui.stickySearchInput : ui.searchInput;
}

function focusActiveSearch({ select = true } = {}) {
  const target = getActiveSearchInput();

  if (!target) {
    return;
  }

  target.focus({ preventScroll: true });

  if (select) {
    target.select?.();
  }
}
