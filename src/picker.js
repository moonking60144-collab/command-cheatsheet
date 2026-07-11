// Category picker popover: build & re-render the multi-column category
// menu, search-within-picker, keyboard navigation, width calibration.

import { escapeHtml } from "./utils.js";
import {
  state,
  ui,
  CATEGORY_GROUPS,
  getActiveCategoryLabel
} from "./state.js";

// Reusable canvas for text measurement; cached column width avoids
// re-measuring on every picker open.
const _pickerMeasureCanvas = document.createElement("canvas");
let _pickerGridMinCol = 0;

export function invalidatePickerLayoutCache() {
  _pickerGridMinCol = 0;
}

export function getCategoryPickerPairs() {
  return [
    { button: ui.categoryPickerBtn, panel: ui.categoryPicker },
    { button: ui.stickyCategoryPickerBtn, panel: ui.stickyCategoryPicker }
  ].filter((entry) => entry.button && entry.panel);
}

export function getCategoryPickerButton(panel) {
  return getCategoryPickerPairs().find((entry) => entry.panel === panel)?.button ?? null;
}

export function hasOpenCategoryPicker() {
  return getCategoryPickerPairs().some(({ panel }) => !panel.hidden);
}

function syncPickerOpenState() {
  document.body.classList.toggle("has-open-picker", hasOpenCategoryPicker());
}

export function openCategoryPicker(panel) {
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
  syncPickerOpenState();
  const button = getCategoryPickerButton(panel);
  button?.setAttribute("aria-expanded", "true");
  button?.classList.add("is-open");

  window.requestAnimationFrame(() => {
    calibratePickerGrid(panel);
    positionPicker(panel);
    const isFinePointer = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? true;
    if (isFinePointer) {
      searchInput?.focus();
    }
  });
}

export function closeCategoryPicker(panel) {
  if (!panel) {
    return;
  }

  panel.hidden = true;
  panel.classList.remove("expand-right");
  const button = getCategoryPickerButton(panel);
  button?.setAttribute("aria-expanded", "false");
  button?.classList.remove("is-open");
  syncPickerOpenState();
}

export function closeAllCategoryPickers(exceptPanel = null) {
  getCategoryPickerPairs().forEach(({ panel }) => {
    if (panel !== exceptPanel) {
      closeCategoryPicker(panel);
    }
  });
}

export function handleOutsideCategoryPickerClick(target) {
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

export function renderCategoryPickers() {
  getCategoryPickerPairs().forEach(({ panel }) => {
    renderCategoryPicker(panel);
  });
}

// Force full rebuild on next open by clearing DOM; used by
// rebuildCommandState when categories may have changed.
export function clearPickerPanels() {
  getCategoryPickerPairs().forEach(({ panel }) => panel.replaceChildren());
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
  button.setAttribute("aria-pressed", String(state.activeCategory === key));
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

export function renderCategoryPicker(panel) {
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
    item.setAttribute("aria-pressed", String(isActive));

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

export function positionPicker(panel) {
  if (!panel) {
    return;
  }

  const button = getCategoryPickerButton(panel);

  if (!button) {
    return;
  }

  const btnRect = button.getBoundingClientRect();
  const margin = 8;
  const maxWidth = 900;

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
