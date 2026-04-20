// Shared state, DOM references, constants, and persistence helpers.
// All other modules import from here. `state` and `ui` are live objects —
// mutating their properties from any module is observed everywhere.

export const STORAGE_KEY = "command-atlas-state-v1";
export const PINNED_KEY = "command-atlas-pinned-v1";
export const PLACEHOLDER_KEY = "command-atlas-placeholders-v1";
export const PLACEHOLDER_SESSION_KEY = "command-atlas-placeholders-session-v1";
export const DATA_URL = "./commands.json";
export const SECURE_DATA_URL = "./secure-categories.json";
export const SEARCH_DEBOUNCE_MS = 80;
export const RESULTS_PER_PAGE = 50;
export const FIRST_RENDER_BATCH = 20;
export const DEFERRED_RENDER_CHUNK = 15;

export const CATEGORY_GROUPS = [
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

export const state = {
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

export const ui = {
  hero: null,
  searchInput: null,
  stickySearchBar: null,
  stickySearchInput: null,
  stickyActiveCategory: null,
  stickyCategoryPickerBtn: null,
  stickyCategoryPicker: null,
  stickyClearButton: null,
  filterBar: null,
  categoryPickerBtn: null,
  categoryPicker: null,
  publicResultsSection: null,
  results: null,
  publicPagination: null,
  protectedResultsSection: null,
  protectedResults: null,
  protectedPagination: null,
  resultSummary: null,
  commandCount: null,
  categoryCount: null,
  activeState: null,
  viewToggleButton: null,
  clearButton: null,
  scrollTopButton: null,
  securePanel: null,
  secureCategoryList: null,
  announcer: null
};

// Populate the ui cache once DOM is parsed. Called by app boot.
export function bindUiRefs() {
  ui.hero = document.querySelector(".hero");
  ui.searchInput = document.getElementById("search-input");
  ui.stickySearchBar = document.getElementById("sticky-search-bar");
  ui.stickySearchInput = document.getElementById("sticky-search-input");
  ui.stickyActiveCategory = document.getElementById("sticky-active-category");
  ui.stickyCategoryPickerBtn = document.getElementById("sticky-category-picker-btn");
  ui.stickyCategoryPicker = document.getElementById("sticky-category-picker");
  ui.stickyClearButton = document.getElementById("sticky-clear-btn");
  ui.filterBar = document.getElementById("filter-bar");
  ui.categoryPickerBtn = document.getElementById("category-picker-btn");
  ui.categoryPicker = document.getElementById("category-picker");
  ui.publicResultsSection = document.getElementById("public-results-section");
  ui.results = document.getElementById("results");
  ui.publicPagination = document.getElementById("public-pagination");
  ui.protectedResultsSection = document.getElementById("protected-results-section");
  ui.protectedResults = document.getElementById("protected-results");
  ui.protectedPagination = document.getElementById("protected-pagination");
  ui.resultSummary = document.getElementById("result-summary");
  ui.commandCount = document.getElementById("command-count");
  ui.categoryCount = document.getElementById("category-count");
  ui.activeState = document.getElementById("active-state");
  ui.viewToggleButton = document.getElementById("view-toggle-btn");
  ui.clearButton = document.getElementById("clear-btn");
  ui.scrollTopButton = document.getElementById("scroll-top-btn");
  ui.securePanel = document.getElementById("secure-panel");
  ui.secureCategoryList = document.getElementById("secure-category-list");
  ui.announcer = document.getElementById("app-announcer");
}

export function resetPagination() {
  state.pagination.public = 1;
  state.pagination.protected = 1;
}

export function getCategories(commands) {
  return [...new Set(commands.map((item) => item.category))]
    .sort((left, right) => left.localeCompare(right, "zh-Hant"));
}

export function getCommandCounts() {
  return state.commands.reduce((accumulator, command) => {
    accumulator[command.category] = (accumulator[command.category] || 0) + 1;
    return accumulator;
  }, {});
}

export function saveState() {
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

export function restoreState() {
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
}

export function getUrlState() {
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

export function syncUrlState() {
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

export function updateMetrics() {
  ui.commandCount.innerHTML = `<span class="meta-num">${state.commands.length}</span> 筆指令`;
  ui.categoryCount.innerHTML = `<span class="meta-num">${state.categories.length}</span> 個分類`;
}

export function updateViewModeUI() {
  const isListView = state.viewMode === "list";
  document.body.classList.toggle("is-list-view", isListView);

  if (ui.viewToggleButton) {
    ui.viewToggleButton.classList.toggle("is-active", isListView);
    ui.viewToggleButton.setAttribute("aria-pressed", String(isListView));
    ui.viewToggleButton.setAttribute("title", isListView ? "切換成卡片檢視" : "切換成緊湊檢視");
    ui.viewToggleButton.textContent = isListView ? "卡片" : "緊湊";
  }
}

export function announce(message) {
  if (!ui.announcer) {
    return;
  }

  ui.announcer.textContent = "";
  window.setTimeout(() => {
    ui.announcer.textContent = message;
  }, 20);
}

export function getActiveCategoryLabel() {
  if (state.activeCategory === "all") {
    return "全部分類";
  }

  if (state.activeCategory === "pinned") {
    return "已釘選";
  }

  return state.activeCategory;
}

export function getFilterSequence() {
  return [
    "all",
    ...(state.pinned.size > 0 ? ["pinned"] : []),
    ...state.categories
  ];
}

export async function fetchJson(url, label) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`讀取${label}失敗：${response.status}`);
  }

  return response.json();
}

export function normalizeCommands(rawData, fallbackCategory = "") {
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

      // placeholderSuggestions: { "<token>": [{label, value}, ...] }
      // Optional. Only keep entries whose value is a non-empty string so
      // a malformed data shape can't crash the renderer.
      const rawSuggestions = item.placeholderSuggestions;
      const placeholderSuggestions = rawSuggestions && typeof rawSuggestions === "object" && !Array.isArray(rawSuggestions)
        ? Object.fromEntries(
            Object.entries(rawSuggestions)
              .map(([token, list]) => [
                token,
                Array.isArray(list)
                  ? list
                      .filter((s) => s && typeof s.value === "string" && s.value !== "")
                      .map((s) => ({
                        label: String(s.label ?? s.value).trim(),
                        value: String(s.value)
                      }))
                  : []
              ])
              .filter(([, list]) => list.length > 0)
          )
        : {};

      const normalized = {
        id: item.id ?? `command-${index + 1}`,
        category: derivedCategory,
        command: primaryCommand,
        variants: rawVariants,
        description: String(item.description ?? "").trim(),
        tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
        notes: String(item.notes ?? "").trim(),
        placeholderSuggestions
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
