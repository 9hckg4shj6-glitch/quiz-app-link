// 2026-10-18（日）8:00〜18:00（日本時間）はメンテナンス中として、全面の画面で操作できなくする（usage.ts の「停止中」と同じ作り）。
// 静的配信なので端末の時計で判定する。開きっぱなしの端末も30秒ごと（と表示に戻ったとき）に切り替え、終わったら開き直す。
const START = Date.parse("2026-10-18T08:00:00+09:00");
const END = Date.parse("2026-10-18T18:00:00+09:00");

function check(): void {
  const now = Date.now();
  const screen = document.getElementById("app-maintenance");
  if (now < START || now >= END) {
    if (screen) location.reload();
    return;
  }
  if (screen) return;
  for (const el of Array.from(document.body.children)) el.setAttribute("inert", "");
  const el = document.createElement("div");
  el.id = "app-maintenance";
  el.setAttribute("role", "alertdialog");
  el.setAttribute("aria-modal", "true");
  el.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:Canvas;color:CanvasText;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans',sans-serif";
  el.innerHTML = '<div><h1 style="font-size:20px;margin:0 0 12px">ただいまメンテナンス中です</h1><p style="margin:0;opacity:.7;font-size:14px;line-height:1.7">10月18日（日）8:00〜18:00 はご利用いただけません。<br>18:00 を過ぎたら、もう一度開いてください。</p></div>';
  document.body.append(el);
}

if (Date.now() < END) {
  check();
  setInterval(check, 30_000);
  document.addEventListener("visibilitychange", check);
}
