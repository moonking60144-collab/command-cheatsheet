// Command-card rendering: result grid, pagination, per-card DOM assembly.
// Also owns the "render generation" counter that lets deferred rAF chunks
// bail out when a newer render supersedes them.

import {
  escapeHtml,
  escapeAttribute,
  compileHighlightPattern,
  compileTextHighlightPattern,
  highlightText,
  getCategoryAccent,
  tokenize
} from "./utils.js";
import {
  getCommandHighlightLanguage,
  renderCommandCode
} from "./highlight.js";
import {
  state,
  ui,
  RESULTS_PER_PAGE,
  FIRST_RENDER_BATCH,
  DEFERRED_RENDER_CHUNK,
  syncUrlState
} from "./state.js";
import {
  extractPlaceholders,
  renderPlaceholderFields,
  getActiveVariantIndex,
  resolveCommandTemplate,
  inferPlaceholderValuesFromQuery
} from "./placeholders.js";
import { normalizeCommandShapeToken, parseSearchTokenPlan } from "./search-core.js";

// Per-container render generation. Each renderResults call bumps the
// counter for its container; any pending rAF chunk from a previous
// render checks against the current gen and bails if a newer render
// has already replaced the DOM.
const renderGenerations = new WeakMap();

// fresh=true means this is a genuinely new filter result (user typed
// something, switched category, toggled a pin that's visible); cards
// should animate in. fresh=false is a paging re-render — same filter,
// different slice — where replaying card-in on every card looks jumpy.
export function renderResultSections(publicItems, totalResults, fresh = true) {
  const hasPublicItems = publicItems.length > 0;
  const publicPage = getValidPage("public", publicItems.length);
  const visiblePublicItems = paginateItems(publicItems, publicPage);

  if (ui.publicResultsSection) {
    ui.publicResultsSection.hidden = !hasPublicItems && totalResults > 0;
  }

  if (!totalResults) {
    renderResults(ui.results, [], fresh);
    renderPagination(ui.publicPagination, "public", 0, 1);
    renderPageJumps("public", 0, 1);
    return;
  }

  if (hasPublicItems) {
    renderResults(ui.results, visiblePublicItems, fresh, getPageStartIndex(publicPage));
  } else {
    ui.results.replaceChildren();
  }

  renderPagination(ui.publicPagination, "public", publicItems.length, publicPage);
  renderPageJumps("public", publicItems.length, publicPage);
}

function getPageCount(totalItems) {
  return Math.max(1, Math.ceil(totalItems / RESULTS_PER_PAGE));
}

function getValidPage(target, totalItems) {
  const totalPages = getPageCount(totalItems);
  const currentPage = state.pagination[target] ?? 1;
  const nextPage = Math.min(Math.max(state.pagination[target] ?? 1, 1), totalPages);
  state.pagination[target] = nextPage;

  if (nextPage !== currentPage) {
    syncUrlState();
  }

  return nextPage;
}

function paginateItems(items, page) {
  const startIndex = getPageStartIndex(page);
  return items.slice(startIndex, startIndex + RESULTS_PER_PAGE);
}

function getPageStartIndex(page) {
  return (page - 1) * RESULTS_PER_PAGE;
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

function renderPageJump(container, target, totalItems, currentPage) {
  if (!container) {
    return;
  }

  const totalPages = getPageCount(totalItems);

  if (totalItems <= RESULTS_PER_PAGE) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }

  const startItem = (currentPage - 1) * RESULTS_PER_PAGE + 1;
  const endItem = Math.min(totalItems, currentPage * RESULTS_PER_PAGE);

  container.hidden = false;
  container.innerHTML = `
    <button
      class="page-jump-button page-jump-prev"
      type="button"
      data-page-target="${target}"
      data-page-number="${Math.max(1, currentPage - 1)}"
      aria-label="上一頁"
      ${currentPage <= 1 ? "disabled" : ""}
    >‹</button>
    <span class="page-jump-current" aria-label="目前顯示第 ${startItem} 到 ${endItem} 筆，共 ${totalItems} 筆，第 ${currentPage} 頁，共 ${totalPages} 頁">${startItem}-${endItem} / ${totalItems}</span>
    <button
      class="page-jump-button page-jump-next"
      type="button"
      data-page-target="${target}"
      data-page-number="${Math.min(totalPages, currentPage + 1)}"
      aria-label="下一頁"
      ${currentPage >= totalPages ? "disabled" : ""}
    >›</button>
  `;
}

function renderPageJumps(target, totalItems, currentPage) {
  [ui.pageJump, ui.stickyPageJump].forEach((container) => {
    renderPageJump(container, target, totalItems, currentPage);
  });
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

function renderResults(container, items, fresh = true, rowOffset = 0) {
  if (!items.length) {
    const queryLabel = state.query.trim() || "*";
    const hasQuery = state.query.trim().length > 0;
    const hasCategory = state.activeCategory !== "all";
    const scope = state.activeCategory && state.activeCategory !== "all"
      ? `./${state.activeCategory}`
      : "./commands";
    const clearQueryAction = hasQuery
      ? '<button class="empty-action" type="button" data-empty-action="clear-query">只清搜尋</button>'
      : "";
    const clearCategoryAction = hasCategory
      ? '<button class="empty-action" type="button" data-category="all">回到全部分類</button>'
      : "";
    const clearAllAction = hasQuery || hasCategory
      ? '<button class="empty-action empty-action-primary" type="button" data-empty-action="clear-all">清除條件</button>'
      : "";
    const actionHtml = clearAllAction || clearQueryAction || clearCategoryAction
      ? `<div class="empty-actions">${clearAllAction}${clearQueryAction}${clearCategoryAction}</div>`
      : "";
    container.innerHTML = `
      <article class="empty-state" role="status">
        <p class="empty-state-prompt"><span class="empty-state-sigil">$</span>grep -r <span class="empty-state-token">"${escapeHtml(queryLabel)}"</span> ${escapeHtml(scope)}</p>
        <p class="empty-state-result">→ <span class="empty-state-zero">0 matches</span></p>
        <p class="empty-state-hint">試試更短的關鍵字，或先清除目前的分類篩選。</p>
        ${actionHtml}
      </article>
    `;
    // Invalidate any pending deferred render for this container so a
    // stale rAF callback doesn't append orphan cards into the empty state.
    renderGenerations.set(container, (renderGenerations.get(container) ?? 0) + 1);
    return;
  }

  const myGen = (renderGenerations.get(container) ?? 0) + 1;
  renderGenerations.set(container, myGen);

  const rawTokens = tokenize(state.query);
  const queryPlan = parseSearchTokenPlan(rawTokens);
  const tokens = queryPlan.searchTokens;
  const highlightPattern = compileHighlightPattern(tokens);
  const commandHighlightPattern = compileTextHighlightPattern(tokens);
  const ctx = { tokens, queryPlan, highlightPattern, commandHighlightPattern, fresh, rowOffset };

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
  const { tokens, queryPlan, highlightPattern, commandHighlightPattern, fresh, rowOffset } = ctx;
  // _fuzzy is attached by filterCommands when the item matched only via
  // fuzzyScore. Carrying the flag through avoids recomputing on the main
  // thread for the current page.
  const isFuzzy = tokens.length > 0 && Boolean(item._fuzzy);
  const hasVariants = item.variants.length > 1;
  const activeVariantIndex = hasVariants ? getActiveVariantIndex(item) : 0;
  const activeCommand = hasVariants ? item.variants[activeVariantIndex].command : item.command;
  const placeholders = extractPlaceholders(activeCommand);
  const inferredValues = inferPlaceholderValuesFromQuery(activeCommand, state.query);
  const placeholderValues = {
    ...(state.placeholderValues.get(item.id) ?? {}),
    ...inferredValues
  };
  const previewCommand = resolveCommandTemplate(activeCommand, placeholderValues);
  const commandLanguage = getCommandHighlightLanguage(item);
  const accent = getCategoryAccent(item.category);
  const isPinned = state.pinned.has(item.id);
  const matchSignals = getMatchSignals(item, tokens, isFuzzy, queryPlan);
  const matchSignalHtml = matchSignals.length
    ? `<div class="match-line" aria-label="搜尋命中來源">命中：${matchSignals.map((signal) => `<span>${signal}</span>`).join("")}</div>`
    : "";
  const card = document.createElement("article");
  card.className = `command-card${isPinned ? " is-pinned" : ""}${hasVariants ? " has-variants" : ""}${fresh ? " is-fresh-batch" : ""}`;
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
        <span class="row-index" aria-hidden="true">${String(rowOffset + index + 1).padStart(3, "0")}</span>
        <button class="pin-button" type="button" data-pin-id="${escapeAttribute(item.id)}" aria-label="${isPinned ? "取消釘選" : "釘選此指令"}" aria-pressed="${isPinned}" title="${isPinned ? "取消釘選" : "釘選"}">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><polygon points="8,1.5 10.2,6 15,6.6 11.5,9.9 12.5,14.5 8,12.1 3.5,14.5 4.5,9.9 1,6.6 5.8,6"/></svg>
        </button>
        <button class="category-badge category-badge-button" type="button" data-category="${escapeAttribute(item.category)}" aria-label="篩選分類 ${escapeAttribute(item.category)}" title="篩選分類 ${escapeAttribute(item.category)}">
          ${highlightText(item.category, highlightPattern)}
        </button>
        ${isFuzzy ? '<span class="fuzzy-hint">近似匹配</span>' : ''}
      </div>
      ${variantStripHtml}
      <div class="command-block">
        <pre class="command-line"><code class="command-code" data-command-language="${escapeAttribute(commandLanguage)}"></code></pre>
        <div class="placeholder-slot">${renderPlaceholderFields(placeholders, placeholderValues, item.placeholderSuggestions, inferredValues)}</div>
        <button class="copy-button" type="button" data-copy-command="${escapeAttribute(activeCommand)}">複製</button>
      </div>
      <div class="description-stack">
        ${matchSignalHtml}
        <p class="description">${highlightText(item.description, highlightPattern)}</p>
      </div>
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

function getMatchSignals(item, tokens, isFuzzy, queryPlan) {
  if (!tokens.length && !queryPlan.tagFilters.length && !queryPlan.categoryFilters.length) {
    return [];
  }

  const signals = [];
  const includesAnyToken = (text) => tokens.some((token) => String(text ?? "").toLowerCase().includes(token));

  if (includesAnyToken([item.command, ...item.variants.map((variant) => variant.command)].join(" "))) {
    signals.push("指令");
  }

  if (hasTemplateMatch(item, tokens)) {
    signals.push("模板");
  }

  if (
    item.tagsLower.some((tag) => tokens.some((token) => tag.includes(token))) ||
    (queryPlan.tagFilters.length > 0 && queryPlan.tagFilters.every((filter) => item.tagsLower.some((tag) => tag.includes(filter))))
  ) {
    signals.push("標籤");
  }

  if (
    tokens.some((token) => item.categoryLower.includes(token)) ||
    (queryPlan.categoryFilters.length > 0 && queryPlan.categoryFilters.every((filter) => item.categoryLower.includes(filter)))
  ) {
    signals.push("分類");
  }

  if (includesAnyToken(item.description)) {
    signals.push("說明");
  }

  if (item.notes && includesAnyToken(item.notes)) {
    signals.push("備註");
  }

  if (isFuzzy) {
    signals.push("近似");
  }

  return [...new Set(signals)].slice(0, 3);
}

function hasTemplateMatch(item, tokens) {
  if (!item.commandTemplateTokenSets?.length) {
    return false;
  }

  const queryTokens = tokens.map(normalizeCommandShapeToken).filter(Boolean);

  return item.commandTemplateTokenSets.some((templateTokens) =>
    templateTokens.length > 0 &&
    templateTokens.every((templateToken) =>
      queryTokens.some((queryToken) =>
        queryToken === templateToken ||
        queryToken.startsWith(`${templateToken}:`) ||
        queryToken.startsWith(`${templateToken}=`)
      )
    )
  );
}

export function renderError(error) {
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

  ui.publicPagination?.replaceChildren();
  if (ui.publicPagination) {
    ui.publicPagination.hidden = true;
  }
  [ui.pageJump, ui.stickyPageJump].forEach((container) => {
    if (!container) {
      return;
    }

    container.replaceChildren();
    container.hidden = true;
  });
}

export function upgradeAllCodeBlocks() {
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
