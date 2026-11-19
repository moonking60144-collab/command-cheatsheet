import { state } from "./state.js";
import { categoryIcon, icon } from "./icons.js";

const panel = document.getElementById("desk");
const results = document.getElementById("results");
const layout = panel.closest("main");
const find = (selector) => panel.querySelector(selector);
let source = null;
let copiedText = null;

function closeInspector() {
  const restoreFocus = panel.contains(document.activeElement);
  const target = source?.isConnected ? source : document.getElementById("search-input");
  sourceChanges.disconnect();
  source?.classList.remove("panel-source");
  source = null;
  panel.hidden = true;
  layout.classList.remove("has-inspector");
  if (restoreFocus) target.focus({ preventScroll: true });
}

function syncCommand() {
  const code = source.querySelector(".command-code");
  find(".desk-code code").replaceChildren(...Array.from(code.childNodes, (node) => node.cloneNode(true)));
  const copied = code.textContent === copiedText;
  const status = find(".desk-status");
  status.classList.toggle("is-draft", !copied);
  status.textContent = copiedText === null ? "未複製" : copied ? "✓ 已複製" : "已修改 · 待複製";
  find(".desk-retry").hidden = copiedText !== null;
}

function syncPin() {
  const pin = source.querySelector(".pin-button");
  const button = find(".desk-pin");
  button.setAttribute("aria-pressed", pin.getAttribute("aria-pressed"));
  button.setAttribute("aria-label", pin.getAttribute("aria-label"));
  button.title = pin.title;
}

function parameterEditor(input) {
  const label = document.createElement("label");
  label.className = "desk-param";
  const caption = document.createElement("span");
  caption.className = "desk-param-text";
  caption.textContent = input.dataset.placeholderToken.slice(1, -1);
  const editor = document.createElement("input");
  editor.className = "desk-input";
  editor.value = input.value;
  editor.placeholder = "輸入實際值";
  editor.autocomplete = "off";
  editor.spellcheck = false;
  editor.addEventListener("input", () => {
    input.value = editor.value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  label.append(caption, editor);
  return label;
}

function panelButton(original, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = original.textContent;
  button.addEventListener("click", () => original.click());
  return button;
}

function renderInspector() {
  const item = state.commands.find((command) => command.id === source.dataset.commandId);
  const description = source.querySelector(".description").textContent;
  find(".desk-title").textContent = item.title || description;
  const summary = find(".desk-summary");
  summary.textContent = description;
  summary.hidden = !item.title || item.title === description;
  const language = find(".desk-language");
  language.innerHTML = icon(categoryIcon(item.category));
  language.append(item.category);
  syncPin();

  const fields = find(".desk-fields");
  fields.replaceChildren(...Array.from(source.querySelectorAll(".placeholder-input"), parameterEditor));
  find("#desk-params").hidden = !fields.childElementCount;
  const variants = find(".desk-variants");
  const restoreVariantFocus = variants.contains(document.activeElement);
  variants.replaceChildren(...Array.from(source.querySelectorAll(".variant-tab"), (original) => {
    const button = panelButton(original, "desk-variant");
    button.setAttribute("aria-pressed", original.getAttribute("aria-selected"));
    return button;
  }));
  variants.hidden = !variants.childElementCount;
  if (restoreVariantFocus) variants.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });

  find(".desk-notes").textContent = item.notes || "";
  find("#desk-notes").hidden = !item.notes;
  const tags = find(".desk-tags");
  tags.replaceChildren(...Array.from(source.querySelectorAll(".tag-btn"), (original) => {
    const button = panelButton(original, "desk-tag");
    button.title = "篩選標籤 " + original.dataset.tag;
    button.addEventListener("click", closeInspector);
    return button;
  }));
  find(".desk-context").hidden = !item.notes && !tags.childElementCount;
  syncCommand();
}

// Card controls own template values, pinning and variant selection. Mirror their
// committed changes, including edits from keyboard shortcuts and syntax highlighting.
const sourceChanges = new MutationObserver((records) => {
  if (!source?.isConnected) return;
  if (records.some((record) => record.attributeName === "aria-selected")) {
    renderInspector();
    return;
  }
  if (records.some((record) => record.attributeName === "aria-pressed")) syncPin();
  if (records.some((record) => record.target.parentElement?.closest(".command-code") || record.target.matches?.(".command-code"))) {
    const editors = panel.querySelectorAll(".desk-input");
    source.querySelectorAll(".placeholder-input").forEach((input, index) => {
      if (editors[index].value !== input.value) editors[index].value = input.value;
    });
    syncCommand();
  }
});

function bindSource(card) {
  sourceChanges.disconnect();
  source?.classList.remove("panel-source");
  source = card;
  source.classList.add("panel-source");
  sourceChanges.observe(card, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected", "aria-pressed"]
  });
  renderInspector();
}

export function showCommandInspector(card, text) {
  if (!card.isConnected) return;
  const opening = panel.hidden;
  copiedText = text;
  panel.hidden = false;
  layout.classList.add("has-inspector");
  if (source === card) {
    syncCommand();
  } else {
    bindSource(card);
    panel.scrollTop = 0;
  }
  if (opening && (card.matches(":focus-visible") || card.querySelector(":focus-visible"))) {
    find(".desk-close").focus({ preventScroll: true });
  }
}

find(".desk-close").addEventListener("click", closeInspector);
find(".desk-copy").addEventListener("click", () => source.querySelector(".copy-button").click());
find(".desk-pin").addEventListener("click", () => source.querySelector(".pin-button").click());
new MutationObserver(() => {
  if (!source || source.isConnected) return;
  const replacement = results.querySelector(`[data-command-id="${CSS.escape(source.dataset.commandId)}"]`);
  if (replacement) bindSource(replacement);
  else closeInspector();
}).observe(results, { childList: true });

document.addEventListener("keydown", (event) => {
  if (panel.hidden || event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
  if (document.querySelector('.category-picker:not([hidden]), #shortcuts-tooltip[aria-hidden="false"]')) return;
  if (!panel.contains(event.target) && event.target.closest("input, textarea")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  closeInspector();
}, true);
