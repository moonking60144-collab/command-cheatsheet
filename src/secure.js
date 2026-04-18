// Secure / protected categories: load encrypted payload, render lock
// cards, unlock via decrypt worker, merge decrypted commands into state.

import { escapeHtml, escapeAttribute } from "./utils.js";
import {
  state,
  ui,
  SECURE_DATA_URL,
  normalizeCommands,
  resetPagination
} from "./state.js";

let decryptWorker = null;
let decryptWorkerSeq = 0;
const decryptPending = new Map();

export function getUnlockedCommands() {
  return Array.from(state.unlockedCommands.values()).flat();
}

export function normalizeProtectedCategories(payload) {
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

export async function fetchProtectedCategories() {
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

export function renderProtectedCategories() {
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

export async function unlockProtectedCategory(form, onUnlocked) {
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
  onUnlocked?.();
  if (ui.securePanel) {
    ui.securePanel.open = false;
  }
  window.setTimeout(() => {
    if (!ui.protectedResultsSection?.hidden) {
      ui.protectedResultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, 50);
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
    const worker = new Worker(new URL("./decrypt.worker.js", import.meta.url));
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

export function preloadDecryptWorker() {
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
