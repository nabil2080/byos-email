// BYOS Webmail Service Worker
const SHELL_CACHE = "byos-shell-v1";
const RUNTIME_CACHE = "byos-runtime-v1";

const PRECACHE_ASSETS = [
  "/",
  "/index.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      // Best-effort precaching for shell assets
      for (const asset of PRECACHE_ASSETS) {
        try {
          await cache.add(asset);
        } catch (e) {
          console.warn("[sw] Precaching failed for:", asset, e);
        }
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== SHELL_CACHE && key !== RUNTIME_CACHE) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data && (event.data.action === "CLEAR_CACHES" || event.data.action === "LOGOUT")) {
    event.waitUntil(
      Promise.all([
        caches.delete(SHELL_CACHE),
        caches.delete(RUNTIME_CACHE),
      ]).then(() => {
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ success: true });
        }
      })
    );
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. Mutations always bypass Service Worker (Directive D5: queue handles offline mutations)
  if (req.method !== "GET") {
    return;
  }

  // 2. Bypass SSE live streams
  if (url.pathname.includes("/events") || req.headers.get("Accept")?.includes("text/event-stream")) {
    return;
  }

  // 3. API requests: Network first with runtime cache fallback
  if (url.pathname.startsWith("/v1/")) {
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (response.ok && response.status === 200) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) {
            return cached;
          }
          return new Response(JSON.stringify({ error: "offline", offline: true }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        })
    );
    return;
  }

  // 4. App shell, scripts, CSS, WASM: Network-first with cache fallback
  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) {
          return cached;
        }
        // Fallback to cached index.html for navigation requests
        if (req.mode === "navigate") {
          const indexCached = (await caches.match("/")) || (await caches.match("/index.html"));
          if (indexCached) {
            return indexCached;
          }
        }
        return new Response("Offline", { status: 503, statusText: "Service Unavailable" });
      })
  );
});
