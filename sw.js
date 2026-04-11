const CACHE_VERSION = "__CACHE_BUSTER__"; // Replaced in GitHub Actions; remains literal during local preview
const CACHE_NAME = `command-atlas-shell-${CACHE_VERSION}`;
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./search-core.js",
  "./search.worker.js",
  "./commands.json",
  "./manifest.json",
  "./assets/crypto-js.min.js",
  "./assets/highlight.min.js",
  "./assets/highlight-powershell.min.js",
  "./assets/highlight-dos.min.js",
  "./assets/icons/icon-192.svg",
  "./assets/icons/icon-512.svg"
];

const OPTIONAL_ASSETS = [
  "./secure-categories.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const toRequest = (path) => new Request(new URL(path, self.registration.scope).toString(), { cache: "reload" });

    // Required assets — all must succeed
    await cache.addAll(ASSETS.map(toRequest));

    // Optional assets — skip silently on 404
    await Promise.allSettled(
      OPTIONAL_ASSETS.map(async (path) => {
        try {
          const response = await fetch(toRequest(path));
          if (response.ok) {
            await cache.put(toRequest(path), response);
          }
        } catch (_) { /* optional, ignore */ }
      })
    );

    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const fresh = await fetch(request);

    if (fresh.ok) {
      cache.put(request, fresh.clone()).catch(() => {});
    }

    return fresh;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });

    if (cached) {
      return cached;
    }

    if (request.mode === "navigate") {
      const appShell = await cache.match(new URL("./index.html", self.registration.scope).toString());

      if (appShell) {
        return appShell;
      }
    }

    return new Response("Offline", {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8"
      }
    });
  }
}
