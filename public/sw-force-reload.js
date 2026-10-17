// この Service Worker が古い版と入れ替わった時点で、開いているタブをすべて読み直す。
// 古い版のページは演習・学習の途中だと更新を保留し続ける（旧 index.html の applyAppUpdateIfIdle）ため、
// ページ側の作りに関係なく、どんな画面にいても新しい版へ切り替える（演習の途中経過は pagehide で保存される）。
// 初めて開いた端末（入れ替わる古い版が無い）は読み直さない。
// navigate を waitUntil で待つと、読み直しの取得が有効化の完了待ちになって止まるので待たない。
let replacingOld = false;
self.addEventListener("install", () => { replacingOld = !!self.registration.active; });
self.addEventListener("activate", (event) => {
  if (!replacingOld) return;
  event.waitUntil(self.clients.claim().then(() => {
    void self.clients.matchAll({ type: "window" })
      .then((clients) => clients.forEach((client) => client.navigate(client.url).catch(() => {})));
  }));
});
