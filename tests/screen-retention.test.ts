import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const mainTs = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

/**
 * 「機能の利用中に勝手にホーム画面へ戻される」不具合の回帰テスト。
 * 原因は (1) 自動同期・カード編集後の再描画が renderHome() を呼んでいたこと、
 * (2) Service Worker の新版が有効化された瞬間にページを再読み込みしていたこと。
 */
describe("利用中に画面を奪われない", () => {
  const legacyRefresh = html.slice(
    html.indexOf("window.__legacyAppRefresh="),
    html.indexOf("(async function boot()"),
  );

  it("同期・カード編集後の再描画は画面を移動しない", () => {
    expect(legacyRefresh).toContain("refreshCurrentScreen();");
    expect(legacyRefresh).not.toContain("renderHome(");
  });

  it("ホーム表示中の再描画は遷移をやり直さない（スクロール位置を保つ）", () => {
    expect(html).toContain("function renderHomeContent()");
    expect(html).toContain('if(!$("#home").classList.contains("hidden")){ renderHomeContent(); return; }');
  });

  it("演習中は新バージョンの再読み込みを保留し、ホームへ戻ったときに適用する", () => {
    expect(html).toContain("window.__studyAppUpdateReady=()=>{");
    expect(html).toContain("if(!goingHome && currentScreenId!==\"home\") return;");
    expect(mainTs).toContain("onNeedReload()");
    expect(mainTs).toContain("window.__studyAppUpdateReady");
  });
});
