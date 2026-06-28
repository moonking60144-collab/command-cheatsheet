// UI chrome: sticky search bar / scroll-top button observer, clipboard
// copy feedback, focus management for the active search input.

import { ui, announce } from "./state.js";

let copyToastTimer = 0;

export function setupUtilityChromeObserver() {
  if (!ui.hero) {
    return;
  }

  const updateChromeVisibility = () => {
    const showChrome = window.scrollY > ui.hero.offsetHeight + 24;

    if (ui.scrollTopButton) {
      ui.scrollTopButton.classList.toggle("is-visible", showChrome);
      ui.scrollTopButton.setAttribute("aria-hidden", String(!showChrome));
    }

    if (ui.stickySearchBar) {
      ui.stickySearchBar.classList.toggle("is-visible", showChrome);
      ui.stickySearchBar.setAttribute("aria-hidden", String(!showChrome));
      document.body.classList.toggle("has-sticky-search", showChrome);
      syncFocusWhenStickyChromeHides(showChrome);
    }
  };

  updateChromeVisibility();
  window.addEventListener("scroll", updateChromeVisibility, { passive: true });
  window.addEventListener("resize", updateChromeVisibility, { passive: true });
}

function syncFocusWhenStickyChromeHides(showChrome) {
  const activeElement = document.activeElement;

  if (showChrome || !ui.stickySearchBar?.contains(activeElement)) {
    return;
  }

  const focusTarget =
    activeElement === ui.stickySearchInput ? ui.searchInput :
    activeElement === ui.stickyViewToggleButton ? ui.viewToggleButton :
    activeElement === ui.stickyCurrentLinkButton ? ui.currentLinkButton :
    activeElement === ui.stickyClearButton ? ui.clearButton :
    activeElement === ui.stickyCategoryPickerBtn ? ui.categoryPickerBtn :
    null;

  if (focusTarget && !focusTarget.hidden) {
    focusTarget.focus({ preventScroll: true });
    return;
  }

  activeElement.blur();
}

export async function copyToClipboard(text, button, card = null, successAnnouncement = "指令已複製到剪貼簿。") {
  const originalLabel = button.textContent;

  try {
    await navigator.clipboard.writeText(text);

    button.textContent = "已複製";
    button.classList.add("is-copied");
    card?.classList.add("is-copied");

    window.setTimeout(() => {
      button.textContent = originalLabel;
      button.classList.remove("is-copied");
      card?.classList.remove("is-copied");
    }, 1400);

    showCopyToast(text);
    announce(successAnnouncement);
  } catch (error) {
    console.error(error);
    button.textContent = "失敗";
    window.setTimeout(() => {
      button.textContent = originalLabel;
    }, 1400);
    showCopyToast("複製失敗", { isError: true });
    announce("複製失敗。");
  }
}

function showCopyToast(text, { isError = false } = {}) {
  if (!ui.copyToast) {
    return;
  }

  const status = ui.copyToast.querySelector(".copy-toast-status");
  const command = ui.copyToast.querySelector(".copy-toast-command");
  const normalized = text.replace(/\s+/g, " ").trim();

  status.textContent = isError ? "複製失敗" : "已複製";
  command.textContent = isError ? "剪貼簿未更新" : normalized;
  ui.copyToast.classList.toggle("is-error", isError);
  ui.copyToast.classList.add("is-visible");
  ui.copyToast.setAttribute("aria-hidden", "false");

  window.clearTimeout(copyToastTimer);
  copyToastTimer = window.setTimeout(() => {
    ui.copyToast.classList.remove("is-visible", "is-error");
    ui.copyToast.setAttribute("aria-hidden", "true");
  }, 1900);
}

export function getActiveSearchInput() {
  const stickyVisible = ui.stickySearchBar?.classList.contains("is-visible");
  return stickyVisible && ui.stickySearchInput ? ui.stickySearchInput : ui.searchInput;
}

export function focusActiveSearch({ select = true } = {}) {
  const target = getActiveSearchInput();

  if (!target) {
    return;
  }

  target.focus({ preventScroll: true });

  if (select) {
    target.select?.();
  }
}

export function isTextEntryElement(element) {
  if (!element) {
    return false;
  }

  const tagName = element.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || element.isContentEditable;
}
