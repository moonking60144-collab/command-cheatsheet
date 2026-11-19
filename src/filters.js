// Filter pipeline: query/category routing, main-thread <-> worker
// dispatch, sidebar category navigation.

import { escapeHtml, escapeCssSelector, tokenize } from "./utils.js";
import { filterCommands, parseSearchTokenPlan } from "./search-core.js";
import {
  state,
  ui,
  SEARCH_DEBOUNCE_MS,
  resetPagination,
  setQuery,
  saveState,
  updateViewModeUI,
  updateDocumentTitle,
  getActiveCategoryLabel,
  getFilterSequence
} from "./state.js";
import { renderResultSections } from "./cards.js";
import { createPinnedFilterButton } from "./pins.js";
import { icon, categoryIcon } from "./icons.js";
import { animateResults } from "./motion.js";
import {
  renderCategoryPickers,
  renderCategoryPicker,
  closeAllCategoryPickers,
  getCategoryPickerPairs
} from "./picker.js";
import { syncWorkerData, getSearchWorker, syncFilterCommands } from "./workers.js";

let searchDebounceId = 0;
let workerSeq = 0;
let lastFilterAnimated = false;
let lastFilterScrollY = null;
// Whether the last/in-flight render should tag cards with
// .is-fresh-batch. Paging re-renders pass fresh=false so visible cards
// don't replay card-in on every page click.
let lastFilterFresh = true;
let firstFilterDone = false;

export function applyFilters({ fresh = true, preserveScroll = false } = {}) {
  window.clearTimeout(searchDebounceId);
  _runFilters(false, fresh, preserveScroll);
}

export function applyFiltersAnimated({ fresh = true, preserveScroll = false } = {}) {
  window.clearTimeout(searchDebounceId);
  _runFilters(true, fresh, preserveScroll);
}

function _runFilters(animated, fresh, preserveScroll) {
  const tokens = tokenize(state.query);
  const seq = ++workerSeq;
  lastFilterAnimated = animated;
  lastFilterFresh = fresh;
  lastFilterScrollY = preserveScroll ? window.scrollY : null;
  setFilterPending();

  // First call: run filter on the main thread instead of waiting on the
  // worker. 196 commands filter in a few ms and we skip the worker-script
  // fetch + init-message roundtrip on the critical path. The worker is
  // still being warmed by syncWorkerData / eager getSearchWorker() so
  // subsequent filters use it.
  if (!firstFilterDone) {
    firstFilterDone = true;
    const pinnedSet = state.pinned;
    const filteredPublic = filterCommands(state.publicCommands, tokens, state.activeCategory, pinnedSet);
    _renderFilterResults(filteredPublic, animated, fresh, lastFilterScrollY);
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
    const filteredPublic = syncFilterCommands(tokens, state.activeCategory, state.pinned);
    _renderFilterResults(filteredPublic, animated, fresh, lastFilterScrollY);
  }
}

function _renderFilterResults(filteredPublic, animated, fresh, scrollY) {
  const totalResults = filteredPublic.length;
  updateSummary(totalResults);
  const doRender = () => {
    renderResultSections(filteredPublic, totalResults, fresh);
    document.dispatchEvent(new CustomEvent("commandatlas:results-rendered", {
      detail: { totalResults }
    }));
    if (scrollY !== null) {
      const restore = () => window.scrollTo({ top: scrollY, behavior: "instant" });
      requestAnimationFrame(restore);
    }
  };

  doRender();
  animateResults(ui.results, animated ? 220 : 150);
}

export function handleWorkerResult(event) {
  const { seq, filteredPublic } = event.data;

  if (seq !== workerSeq) {
    return;
  }

  _renderFilterResults(filteredPublic, lastFilterAnimated, lastFilterFresh, lastFilterScrollY);
}

export function handleWorkerFallback() {
  const tokens = tokenize(state.query);
  const filteredPublic = syncFilterCommands(tokens, state.activeCategory, state.pinned);
  _renderFilterResults(filteredPublic, lastFilterAnimated, lastFilterFresh, lastFilterScrollY);
}

export function updateQuery(value, sourceInput = null) {
  setQuery(String(value ?? ""));
  resetPagination();
  syncSearchInputs(sourceInput);
  saveState();
  window.clearTimeout(searchDebounceId);
  searchDebounceId = window.setTimeout(() => {
    applyFilters();
  }, SEARCH_DEBOUNCE_MS);
}

export function syncSearchInputs(sourceInput = null) {
  [ui.searchInput, ui.stickySearchInput].forEach((input) => {
    if (!input || input === sourceInput) {
      return;
    }

    input.value = state.query;
  });
  syncSearchClearButtons();
}

export function clearFilters({ preserveScroll = false } = {}) {
  setQuery("");
  state.activeCategory = "all";
  resetPagination();
  syncSearchInputs();
  saveState();
  updateFilterPillActive();
  applyFiltersAnimated({ preserveScroll });
  closeAllCategoryPickers();
}

export function applyCategoryFilter(category) {
  state.activeCategory = category;
  resetPagination();
  saveState();
  updateFilterPillActive();
  applyFiltersAnimated();
}

export function cycleCategory(direction) {
  const sequence = getFilterSequence();
  const currentIndex = Math.max(0, sequence.indexOf(state.activeCategory));
  const nextIndex = (currentIndex + direction + sequence.length) % sequence.length;
  applyCategoryFilter(sequence[nextIndex]);
}

export function filterByTag(tag) {
  setQuery(`tag:${tag}`);
  resetPagination();
  syncSearchInputs();
  saveState();
  applyFiltersAnimated();
}

export function restoreStateFromUrl(urlState) {
  setQuery(urlState.query);
  state.activeCategory = urlState.activeCategory;
  state.viewMode = urlState.viewMode;
  resetPagination();
  state.pagination.public = urlState.page;
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

export function updateSummary(resultCount) {
  clearFilterPending();
  const trimmedQuery = state.query.trim();
  const hasActiveFilters = trimmedQuery.length > 0 || state.activeCategory !== "all";

  ui.activeState.innerHTML = getActiveStateHtml();
  ui.resultsTitle.textContent = state.activeCategory === "all"
    ? (trimmedQuery ? "搜尋結果" : "全部指令")
    : getActiveCategoryLabel();
  ui.resultSummary.textContent = `${resultCount} 筆`;
  if (ui.stickyResultSummary) {
    ui.stickyResultSummary.textContent = `${resultCount} 筆`;
  }
  updateDocumentTitle(resultCount);
  ui.clearButton.hidden = !hasActiveFilters;
  if (ui.stickyClearButton) {
    ui.stickyClearButton.hidden = !hasActiveFilters;
  }
  updateStickySearchState();
}

function getActiveStateHtml() {
  const categoryLabel = getActiveCategoryLabel();
  const queryPlan = parseSearchTokenPlan(tokenize(state.query));
  const parts = [
    `<span class="active-state-prefix">目前</span>`,
    `<span class="active-token"><span>分類</span>${escapeHtml(categoryLabel)}</span>`
  ];

  if (queryPlan.searchTokens.length > 0) {
    parts.push(`<span class="active-token"><span>關鍵字</span>${escapeHtml(queryPlan.searchTokens.join(" "))}</span>`);
  }

  queryPlan.tagFilters.forEach((tag) => {
    parts.push(`<span class="active-token active-token-operator"><span>標籤</span>${escapeHtml(tag)}</span>`);
  });

  queryPlan.categoryFilters.forEach((category) => {
    parts.push(`<span class="active-token active-token-operator"><span>語法分類</span>${escapeHtml(category)}</span>`);
  });

  return parts.join("");
}

function setFilterPending() {
  const trimmedQuery = state.query.trim();
  const pendingLabel = trimmedQuery ? "搜尋中…" : "篩選中…";

  document.body.classList.add("is-searching");
  ui.resultSummary.classList.add("is-searching");
  ui.resultSummary.textContent = pendingLabel;
  if (ui.stickyResultSummary) {
    ui.stickyResultSummary.textContent = pendingLabel;
  }
}

function clearFilterPending() {
  document.body.classList.remove("is-searching");
  ui.resultSummary.classList.remove("is-searching");
}

function syncSearchClearButtons() {
  const hasQuery = state.query.trim().length > 0;
  [ui.searchClearButton, ui.stickySearchClearButton].forEach((button) => {
    if (button) {
      button.hidden = !hasQuery;
    }
  });
}

export function updateStickySearchState() {
  const activeLabel = getActiveCategoryLabel();

  if (ui.stickyActiveCategory) {
    ui.stickyActiveCategory.textContent = activeLabel;
  }
}

export function renderFilters() {
  const counts = state.commandCounts;

  const divider = document.createElement("span");
  divider.className = "filter-bar-divider";
  divider.textContent = "分類";

  const buttons = [
    createFilterButton("all", "全部指令", state.commands.length),
    createPinnedFilterButton(),
    divider,
    ...state.categories.map((category) => createFilterButton(category, category, counts[category] || 0))
  ];

  ui.filterBar.replaceChildren(...buttons);

  const activeButton = ui.filterBar.querySelector(`[data-category="${escapeCssSelector(state.activeCategory)}"]`);
  revealSidebarCategory(activeButton);

  renderCategoryPickers();
  updateStickySearchState();
}

export function updateFilterPillActive() {
  document.body.classList.toggle("has-active-filter", state.activeCategory !== "all");

  ui.filterBar.querySelectorAll(".filter-pill[data-category]").forEach((btn) => {
    const isActive = btn.dataset.category === state.activeCategory;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  });

  const activeButton = ui.filterBar.querySelector(".filter-pill.is-active");
  revealSidebarCategory(activeButton);

  const pickerLabel = getActiveCategoryLabel();
  getCategoryPickerPairs().forEach(({ button, panel }) => {
    button?.setAttribute("aria-label", `分類選單，當前 ${pickerLabel}`);
    button?.setAttribute("title", `分類選單：${pickerLabel}`);

    if (!panel.hidden) {
      renderCategoryPicker(panel);
    }
  });

  updateStickySearchState();
}

function createFilterButton(category, label, count = 0) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `filter-pill${state.activeCategory === category ? " is-active" : ""}`;
  button.dataset.category = category;
  button.setAttribute("aria-pressed", String(state.activeCategory === category));
  button.innerHTML = `
    ${icon(categoryIcon(category))}
    <span class="filter-pill-label">${escapeHtml(label)}</span>
    <span class="filter-pill-count">${count}</span>
  `;
  return button;
}

// Keep the selection visible inside the sidebar without moving the results page.
function revealSidebarCategory(button) {
  const bar = ui.filterBar;
  positionSelection(button);
  if (!button || !bar.clientHeight) return;
  const top = button.offsetTop;
  const bottom = top + button.offsetHeight;
  if (top < bar.scrollTop) bar.scrollTop = top;
  else if (bottom > bar.scrollTop + bar.clientHeight) bar.scrollTop = bottom - bar.clientHeight;
}

function positionSelection(button) {
  const sidebar = ui.filterBar;
  if (!button || !button.offsetWidth) {
    sidebar.removeAttribute("data-selection-frame");
    return;
  }
  // Scroll and selection share the sidebar's content coordinates.
  sidebar.style.setProperty("--selection-x", button.offsetLeft + "px");
  sidebar.style.setProperty("--selection-y", button.offsetTop + "px");
  sidebar.style.setProperty("--selection-width", button.offsetWidth + "px");
  sidebar.style.setProperty("--selection-height", button.offsetHeight + "px");
  sidebar.setAttribute("data-selection-frame", "");
}

export function observeSidebarSelection() {
  const align = () => positionSelection(ui.filterBar.querySelector(".filter-pill.is-active"));
  new ResizeObserver(align).observe(ui.filterBar);
  document.fonts.ready.then(align);
}
