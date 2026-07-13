/* 代謝演習アプリ Service Worker
   - ナビゲーション：ネットワーク優先（オフライン時はキャッシュのindex.html）
   - スクリプト/JSON/CSS：stale-while-revalidate（表示は即・裏で更新）
   - 画像/アイコン：キャッシュ優先
   - revalidate は cache:"no-cache" でGitHub PagesのHTTPキャッシュを迂回し常に最新化
   - キャッシュは世代管理し、activate 時に旧世代を削除
*/
const VERSION = "v1.3.9";
const CACHE = "metaquiz-" + VERSION;

const CORE = [
  "./",
  "index.html",
  "questions.js",
  "updates.js",
  "terms.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-192.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 個別に取得して1つ失敗しても全体を壊さない
    await Promise.all(CORE.map(async (url) => {
      try {
        const res = await fetch(url, { cache: "no-cache" });
        if (res && res.ok) await cache.put(url, res.clone());
      } catch (e) { /* オフライン等は無視 */ }
    }));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("metaquiz-") && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function isImage(url, dest) {
  return dest === "image" || url.pathname.indexOf("/images/") !== -1 || url.pathname.indexOf("/icons/") !== -1;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // 同一オリジンのみ

  // ページ遷移：ネットワーク優先（最新のindex.html）→ オフライン時キャッシュ
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-cache" });
        const cache = await caches.open(CACHE);
        cache.put("index.html", fresh.clone());
        return fresh;
      } catch (e) {
        const cache = await caches.open(CACHE);
        return (await cache.match("index.html")) || (await cache.match("./")) || Response.error();
      }
    })());
    return;
  }

  // 画像・アイコン：キャッシュ優先
  if (isImage(url, req.destination)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (e) { return hit || Response.error(); }
    })());
    return;
  }

  // それ以外（JS/JSON/CSS等）：stale-while-revalidate（最新化は no-cache でHTTPキャッシュ迂回）
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    const fetching = fetch(req, { cache: "no-cache" }).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return hit || (await fetching) || Response.error();
  })());
});
