// 2026-10-18（日）18:00 のメンテナンス明けまでは、この Service Worker が古い版と入れ替わった時点で、開いているタブをすべて読み直す。
// 古い版のタブは演習・学習の途中だと更新を保留し続ける（index.html の applyAppUpdateIfIdle）ため、
// ブラウザを閉じていない人もメンテナンス画面（src/maintenance.ts）の入った版へ強制的に切り替える。期限後は何もしない。
// 初めて開いた端末（入れ替わる古い版が無い）は読み直さない。
// navigate を waitUntil で待つと、読み直しの取得が有効化の完了待ちになって止まるので待たない。
let replacingOld = false;
self.addEventListener("install", () => { replacingOld = !!self.registration.active; });
self.addEventListener("activate", (event) => {
  if (!replacingOld || Date.now() >= Date.parse("2026-10-18T18:00:00+09:00")) return;
  event.waitUntil(self.clients.claim().then(() => {
    void self.clients.matchAll({ type: "window" })
      .then((clients) => clients.forEach((client) => client.navigate(client.url).catch(() => {})));
  }));
});
