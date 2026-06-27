// Filter pipeline: query/category routing, main-thread <-> worker
// dispatch, filter pill bar rendering + animated indicator.

import { escapeHtml, escapeCssSelector, tokenize } from "./utils.js";
import { filterCommands } from "./search-core.js";
import {
  state,
  ui,
  SEARCH_DEBOUNCE_MS,
  resetPagination,
  saveState,
  updateViewModeUI,
  getActiveCategoryLabel,
  getFilterSequence
} from "./state.js";
import { renderResultSections } from "./cards.js";
import { createPinnedFilterButton } from "./pins.js";
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
const SCROLL_RESTORE_DELAYS_MS = [120, 360];
// Whether the last/in-flight render should tag cards with
// .is-fresh-batch. Paging re-renders pass fresh=false so visible cards
// don't replay card-in on every page click.
let lastFilterFresh = true;
let firstFilterDone = false;

export function applyFilters({ fresh = true, preserveScroll = false } = {}) {
  _runFilters(false, fresh, preserveScroll);
}

export function applyFiltersAnimated({ fresh = true, preserveScroll = false } = {}) {
  _runFilters(true, fresh, preserveScroll);
}

function _runFilters(animated, fresh, preserveScroll) {
  const tokens = tokenize(state.query);
  const seq = ++workerSeq;
  lastFilterAnimated = animated;
  lastFilterFresh = fresh;
  lastFilterScrollY = preserveScroll ? window.scrollY : null;

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
    if (scrollY !== null) {
      const restore = () => window.scrollTo(0, scrollY);
      requestAnimationFrame(restore);
      SCROLL_RESTORE_DELAYS_MS.forEach((delay) => window.setTimeout(restore, delay));
    }
  };

  if (animated && scrollY === null && document.startViewTransition) {
    document.startViewTransition(doRender);
  } else {
    doRender();
  }
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
  state.query = String(value ?? "");
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
}

export function clearFilters({ preserveScroll = false } = {}) {
  state.query = "";
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
  state.query = tag;
  resetPagination();
  syncSearchInputs();
  saveState();
  applyFiltersAnimated();
}

export function restoreStateFromUrl(urlState) {
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

export function updateSummary(resultCount) {
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

export function updateStickySearchState() {
  const activeLabel = getActiveCategoryLabel();

  if (ui.stickyActiveCategory) {
    ui.stickyActiveCategory.textContent = activeLabel;
  }
}

export function renderFilters() {
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

export function updateFilterPillActive() {
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

export function syncFilterIndicator() {
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

// scrollIntoView with block:"nearest" also scrolls the WINDOW to bring the
// element into vertical view — which yanked the page back to the top every
// time a filter pill was re-centered (e.g. on clearFilters via Esc). We only
// want horizontal re-centering inside the filter bar, so compute the scroll
// target ourselves and touch ui.filterBar.scrollLeft directly.
export function centerFilterPillHorizontally(pill) {
  if (!pill || !ui.filterBar) return;
  const bar = ui.filterBar;
  const target = pill.offsetLeft + pill.offsetWidth / 2 - bar.clientWidth / 2;
  bar.scrollTo({
    left: Math.max(0, target),
    behavior: "smooth"
  });
}

export function updateFilterBarOverflow() {
  const bar = ui.filterBar;
  const wrap = bar?.parentElement;
  if (!bar || !wrap) return;
  const maxScroll = bar.scrollWidth - bar.clientWidth;
  const hasLeft = bar.scrollLeft > 4;
  const hasRight = maxScroll > 4 && bar.scrollLeft < maxScroll - 4;
  wrap.classList.toggle("has-left-overflow", hasLeft);
  wrap.classList.toggle("has-right-overflow", hasRight);
}
