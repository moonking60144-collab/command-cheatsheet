// Search worker lifecycle for command filtering.

import { filterCommands } from "./search-core.js";
import { state } from "./state.js";

let searchWorker = null;
let searchWorkerDisabled = false;
let onWorkerResult = null;
let onFallback = null;

export function registerWorkerHandlers({ onResult, onWorkerUnavailableFallback }) {
  onWorkerResult = onResult;
  onFallback = onWorkerUnavailableFallback;
}

export function getSearchWorker() {
  if (searchWorker) {
    return searchWorker;
  }

  if (searchWorkerDisabled) {
    return null;
  }

  if (typeof Worker === "undefined") {
    return null;
  }

  try {
    // Resolve against this module's URL so the path survives a move of
    // src/ to any subpath (GitHub Pages + /src/ co-location).
    const worker = new Worker(new URL("./search.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => onWorkerResult?.(event);
    worker.onerror = (e) => {
      console.warn("Search worker error, falling back to sync", e);
      try {
        worker.terminate();
      } catch (terminateError) {
        console.warn("Search worker terminate failed", terminateError);
      }
      searchWorker = null;
      searchWorkerDisabled = true;
      onFallback?.();
    };
    searchWorker = worker;
  } catch (e) {
    console.warn("Search worker unavailable, using sync fallback", e);
    searchWorkerDisabled = true;
  }

  return searchWorker;
}

export function syncWorkerData() {
  const worker = getSearchWorker();

  if (!worker) {
    return;
  }

  worker.postMessage({
    type: "init",
    publicCommands: state.publicCommands
  });
}

// Synchronous fallback used when the worker is not available (or after
// it has failed). Runs filterCommands on the main thread.
export function syncFilterCommands(tokens, activeCategory, pinnedSet) {
  return filterCommands(state.publicCommands, tokens, activeCategory, pinnedSet);
}
