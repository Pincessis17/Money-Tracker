// Keeps the app shell available offline; always tries the network first so updates arrive.
const CACHE = "my-money-v55";
const SHELL = ["./", "index.html", "style.css?v=55", "app.js?v=55", "i18n.js?v=55", "config.js?v=55", "vault.js?v=55", "supabase.js", "manifest.webmanifest", "icons/icon-192.png", "vendor/great-vibes.woff2"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});

// Daily reminder from the server.
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil(self.registration.showNotification(d.title || "My Money", {
    body: d.body || "Did you spend anything today? Tap to add it.",
    icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: d.tag || "daily-reminder", data: { url: d.url || "./" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope)) { c.postMessage({ type: "add-expense" }); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
