/* Service worker — precaches the app shell, then caches same-origin assets so
 * the tree opens offline after the first visit.
 *
 * The encrypted payloads (data/tree.json.enc and media/*.enc) are served
 * network-first: a rebuild or password rotation produces fresh ciphertext with
 * a new salt, and a cache-first policy would keep serving the stale file, which
 * decrypts with neither the old nor the new password. Cache fallback is still
 * used, so the tree remains readable offline.
 *
 * Navigations are also network-first so a deploy is picked up promptly and a
 * stale index.html (with its stale bundle) is never served to returning users.
 * Hashed static assets are immutable, so those stay cache-first. */
const BASE = "/family-tree-site/";
const CACHE = "bhimjiyani-v1788305680";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([BASE, `${BASE}index.html`]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function networkFirst(event) {
  const req = event.request;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && (res.type === "basic" || res.type === "cors")) {
          const clone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, clone));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Navigations must fetch the live HTML so a deploy is picked up promptly.
  if (req.mode === "navigate") {
    networkFirst(event);
    return;
  }

  // Encrypted data and media are per-build: always take the current build's
  // bytes (falling back to cache only when offline).
  if (/\/data\/|\/media\/|\.enc($|\?)/.test(url.pathname)) {
    networkFirst(event);
    return;
  }

  // Hashed static assets are immutable — cache-first with a background refresh.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && (res.type === "basic" || res.type === "cors")) {
            const clone = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
