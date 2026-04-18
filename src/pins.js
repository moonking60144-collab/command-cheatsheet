// Pin management: toggle, persistence, derived UI (pinned pill).

import { state, ui, PINNED_KEY } from "./state.js";

export function restorePinned() {
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

export function savePinned() {
  localStorage.setItem(PINNED_KEY, JSON.stringify([...state.pinned]));
}

export function prunePinnedIds() {
  const validIds = new Set(state.commands.map((item) => item.id));
  const beforeSize = state.pinned.size;
  state.pinned = new Set([...state.pinned].filter((id) => validIds.has(id)));

  if (state.pinned.size !== beforeSize) {
    savePinned();
  }
}

// Pin toggle needs to call back into filter + render logic. The caller
// wires those callbacks so this module does not import filters.js
// (which would create a cycle through render-cards → placeholders).
export function togglePin(commandId, buttonEl, callbacks = {}) {
  const {
    applyFiltersAnimated,
    applyFilters,
    updateFilterPillActive,
    syncFilterIndicator
  } = callbacks;

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

  updatePinnedPill(syncFilterIndicator);

  // Full re-render is only necessary when the toggled pin actually changes
  // which cards are visible — that's either when we just emptied the pinned
  // filter (and bounced back to "all") or when the user is currently looking
  // at the pinned list (where the toggled card must appear / disappear).
  if (categoryChanged) {
    updateFilterPillActive?.();
    applyFiltersAnimated?.();
    return;
  }

  if (state.activeCategory === "pinned") {
    applyFilters?.();
  }
}

export function updatePinnedPill(syncFilterIndicator) {
  const existingPill = ui.filterBar.querySelector(".filter-pill-pinned");

  if (state.pinned.size === 0) {
    if (existingPill) {
      existingPill.remove();
    }

    syncFilterIndicator?.();
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

  syncFilterIndicator?.();
}

export function createPinnedFilterButton() {
  const isActive = state.activeCategory === "pinned";
  const button = document.createElement("button");
  button.type = "button";
  button.className = `filter-pill filter-pill-pinned${isActive ? " is-active" : ""}`;
  button.dataset.category = "pinned";
  button.setAttribute("aria-pressed", String(isActive));
  button.innerHTML = `★ 已釘選 <span class="pin-pill-count">${state.pinned.size}</span>`;
  return button;
}
