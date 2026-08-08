// 最小構成の Service Worker。
// 目的は PWA としてのインストール可能性の確保（File System Access 権限の永続化）。
// アプリシェルを軽くキャッシュし、オフラインでも起動できるようにする。
const CACHE = "mdglow-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  // ネットワーク優先・失敗時キャッシュ（開発中の更新反映を優先）
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((r) => r ?? caches.match("/index.html"))),
  );
});
