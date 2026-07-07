// サービスワーカー: オフライン(電波なし)でも起動できるようにする。
//
// 方針: network-first(ネット優先)。
//   オンラインのときは必ず最新をネットから取得し、そのコピーを保存する。
//   オフラインのときだけ、保存済み(キャッシュ)を返す。
//   → 更新がすぐ反映され、電波がなくても動く。
// ファイルを更新したら CACHE_VERSION の数字を上げること。

const CACHE_VERSION = "baito-v4";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

// インストール時: 必要なファイルを先に保存(オフライン初回対策)
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// 有効化時: 古いバージョンのキャッシュを掃除し、開いているページを即座に引き継ぐ
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 取得時: まずネットから取得(成功したら保存)。失敗(オフライン)なら保存版を返す。
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
