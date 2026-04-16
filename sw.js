const CACHE_VERSION = "__CACHE_BUSTER__"; // Replaced in GitHub Actions; remains literal during local preview
const CACHE_NAME = `command-atlas-shell-${CACHE_VERSION}`;
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./utils.js",
  "./search-core.js",
  "./search.worker.js",
  "./decrypt.worker.js",
  "./commands.json",
  "./manifest.json",
  "./assets/icons/icon-192.svg",
  "./assets/icons/icon-512.svg"
];

// crypto-js and highlight.* are intentionally NOT precached — app.js
// lazy-loads them after first paint / on secure panel open, and the
// runtime fetch handler below caches them on first request.
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
  const url = new URL(request.url);

  // Vendor assets under /assets/ are effectively immutable within a
  // deploy (CACHE_VERSION bumps per deploy and the activate hook wipes
  // the old cache), so serve cache-first with stale-while-revalidate:
  // instant response from cache, background fetch to freshen for next
  // visit. This is what gives repeat visits a truly zero-wait lazy-load
  // of highlight.js / crypto-js.
  if (url.pathname.includes("/assets/")) {
    const cached = await cache.match(request, { ignoreSearch: true });

    if (cached) {
      fetch(request)
        .then((fresh) => {
          if (fresh.ok) {
            cache.put(request, fresh.clone()).catch(() => {});
          }
        })
        .catch(() => { /* offline refresh is fine, we already returned cached */ });
      return cached;
    }

    try {
      const fresh = await fetch(request);
      if (fresh.ok) {
        cache.put(request, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (error) {
      return new Response("Offline", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  }

  // commands.json is the data file the user actually queries against.
  // Pure network-first means every visit pays the network round-trip;
  // pure stale-while-revalidate means newly-added entries take two
  // refreshes to appear, which fights the "edit a command, reload to
  // verify" workflow. Compromise: network-first with a short timeout,
  // falling back to cache only when network is too slow (or offline).
  // GH Pages TTFB to TW is normally ~200-400ms, so 600ms gives normal
  // visits the fresh response while still snapping to cache on weak
  // networks.
  if (url.pathname.endsWith("/commands.json")) {
    const cached = await cache.match(request, { ignoreSearch: true });
    const network = fetch(request)
      .then((fresh) => {
        if (fresh.ok) {
          cache.put(request, fresh.clone()).catch(() => {});
        }
        return fresh;
      });

    if (!cached) {
      try {
        return await network;
      } catch (error) {
        return new Response("Offline", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      }
    }

    // Swallow rejections on the network promise we feed into Promise.race
    // so a fast network failure resolves to cached instead of throwing.
    const networkOrCached = network.catch(() => cached);
    return Promise.race([
      networkOrCached,
      new Promise((resolve) => setTimeout(() => resolve(cached), 600))
    ]);
  }

  // Everything else (navigation, app shell, app.js) stays network-first
  // so fresh content reaches users without waiting for a new SW version.
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
