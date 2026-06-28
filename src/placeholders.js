// Placeholder (<token>) lifecycle: extraction, rendering, persistence,
// per-card sync, and command-preview updates. Variants switching lives
// here too because it shares placeholder-rebuild logic.

import { escapeHtml, escapeAttribute, compileTextHighlightPattern, tokenize } from "./utils.js";
import { renderCommandCode } from "./highlight.js";
import {
  state,
  PLACEHOLDER_KEY,
  PLACEHOLDER_SESSION_KEY,
  announce
} from "./state.js";

// Word-boundary match so `<keyword>` is NOT flagged just because it
// contains "key".
const SENSITIVE_TOKEN_PATTERN = /\b(?:token|password|passphrase|secret|credential|passwd|key)\b|(?:^|[<_\-\s])(?:密碼|金鑰|憑證|通行碼)(?:$|[>_\-\s])/i;

function isSensitiveToken(token) {
  return SENSITIVE_TOKEN_PATTERN.test(token);
}

// Cache placeholder extraction results. The command template text never
// changes once normalized, so the regex + Set + map + filter work only
// needs to happen once per unique template.
const placeholderCache = new Map();

export function extractPlaceholders(command) {
  const key = String(command ?? "");
  const cached = placeholderCache.get(key);
  if (cached) return cached;

  const matches = key.match(/<[^>]+>/g) ?? [];
  const tokens = [...new Set(matches.map((token) => token.trim()).filter(Boolean))];
  placeholderCache.set(key, tokens);
  return tokens;
}

export function renderPlaceholderFields(placeholders, currentValues = {}, suggestions = {}, inferredValues = {}) {
  if (!placeholders.length) {
    return "";
  }

  return `
    <div class="placeholder-fields">
      ${placeholders.map((token) => {
        const chips = Array.isArray(suggestions[token]) ? suggestions[token] : [];
        const chipsHtml = chips.length > 0
          ? `
            <div class="placeholder-suggestions" role="list" aria-label="${escapeAttribute(token.slice(1, -1))} 的常用值">
              ${chips.map((s) => `
                <button
                  class="placeholder-chip"
                  type="button"
                  role="listitem"
                  data-suggestion-for="${escapeAttribute(token)}"
                  data-suggestion-value="${escapeAttribute(s.value)}"
                  title="${escapeAttribute(s.value)}"
                >${escapeHtml(s.label)}</button>
              `).join("")}
            </div>
          `
          : "";
        const isInferred = inferredValues[token] && inferredValues[token] === currentValues[token];
        return `
          <label class="placeholder-field${isInferred ? " is-inferred" : ""}">
            <span class="placeholder-label-row">
              <span>${escapeHtml(token.slice(1, -1))}</span>
              ${isInferred ? '<span class="placeholder-source">搜尋帶入</span>' : ""}
            </span>
            <input
              class="placeholder-input"
              type="text"
              data-placeholder-token="${escapeAttribute(token)}"
              ${isInferred ? 'data-placeholder-inferred="true"' : ""}
              placeholder="貼上實際值"
              value="${escapeAttribute(currentValues[token] ?? "")}"
              autocomplete="off"
              spellcheck="false"
            >
            ${chipsHtml}
          </label>
        `;
      }).join("")}
    </div>
  `;
}

export function resolveCommandTemplate(template, values) {
  return String(template ?? "").replace(/<[^>]+>/g, (token) => {
    const nextValue = values[token];
    return typeof nextValue === "string" && nextValue !== "" ? nextValue : token;
  });
}

export function inferPlaceholderValuesFromQuery(template, query) {
  const placeholders = extractPlaceholders(template);

  if (!placeholders.length || !query.trim()) {
    return {};
  }

  const parts = String(template).split(/(<[^>]+>)/g);
  const pattern = parts
    .map((part) => {
      if (/^<[^>]+>$/.test(part)) {
        return "(.+?)";
      }

      return escapeRegExp(part).replace(/\s+/g, "\\s+");
    })
    .join("");
  const match = query.trim().match(new RegExp(`^\\s*${pattern}\\s*$`, "i"));

  if (!match) {
    return {};
  }

  return Object.fromEntries(
    placeholders
      .map((token, index) => [token, match[index + 1]?.trim() ?? ""])
      .filter(([, value]) => value)
  );
}

export function getPlaceholderValues(card) {
  const values = {};

  card?.querySelectorAll("[data-placeholder-token]").forEach((input) => {
    values[input.dataset.placeholderToken] = input.value;
  });

  return values;
}

export function buildResolvedCommand(card, template) {
  return resolveCommandTemplate(template, getPlaceholderValues(card));
}

export function syncCardPlaceholderValues(card) {
  if (!card?.dataset.commandId) {
    return;
  }

  state.placeholderValues.set(card.dataset.commandId, {
    ...(state.placeholderValues.get(card.dataset.commandId) ?? {}),
    ...getPlaceholderValues(card)
  });
  savePlaceholders();
}

export function clearPlaceholderInference(input) {
  if (!input?.hasAttribute?.("data-placeholder-inferred")) {
    return;
  }

  input.removeAttribute("data-placeholder-inferred");
  const field = input.closest(".placeholder-field");
  field?.classList.remove("is-inferred");
  field?.querySelector(".placeholder-source")?.remove();
}

export function updateCommandPreview(card) {
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

export function savePlaceholders() {
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

export function restorePlaceholders() {
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

export function handleScopedInputEscape(activeElement) {
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

  return false;
}

export function getActiveVariantIndex(item) {
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function switchCardVariant(card, nextIndex) {
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

  syncCardPlaceholderValues(card);
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
    const inferredValues = inferPlaceholderValuesFromQuery(activeCommand, state.query);
    const placeholderValues = {
      ...(state.placeholderValues.get(item.id) ?? {}),
      ...inferredValues
    };
    placeholderSlot.innerHTML = renderPlaceholderFields(placeholders, placeholderValues, item.placeholderSuggestions, inferredValues);
  }

  updateCommandPreview(card);
}
