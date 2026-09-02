import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";

/**
 * 「機能を使っている最中に勝手にホーム画面へ戻される」不具合の実動作テスト。
 *
 * 文字列の検査ではなく、index.html のアプリ本体（src なしの <script>）を jsdom 上で
 * 実際に起動し、利用者と同じ操作をしたうえで次の2つの割り込みを起こして確かめる:
 *   1. 自動同期の完了（5分ごと・アプリ復帰時に走る）… src/legacy-bridge.ts が呼ぶ
 *      window.__legacyAppRefresh() をそのまま呼ぶ
 *   2. 新バージョンの配信 … src/main.ts の onNeedReload が呼ぶ
 *      window.__studyAppUpdateReady() をそのまま呼ぶ
 */

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const inlineScript = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";

const QUESTIONS = Array.from({ length: 50 }, (_, i) => ({
  id: `t${i + 1}`, year: "テスト年度", field: "テスト分野",
  question: `テスト問題${i + 1}`, choices: ["ア", "イ", "ウ", "エ", "オ"],
  answer: 0, explanation: "テスト解説",
  slideRefs: [{ deck: "01", name: "テスト講義", pages: [1] }],
}));

interface App {
  dom: JSDOM;
  /** アプリを動かしている window（インラインJSと同じ実行環境） */
  win: any;
  /** jsdom は location.reload() を実装していないので、その通知を再読み込みの印として拾う */
  reloads: string[];
  /** transitionToScreen が行う window.scrollTo(0,0) の記録 */
  scrolls: Array<[number, number]>;
}

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (check()) return;
    await tick(5);
  }
  throw new Error(`条件が満たされませんでした: ${label}`);
}

function bootApp(): Promise<App> {
  const reloads: string[] = [];
  const scrolls: Array<[number, number]> = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error: Error) => {
    if (/navigation/i.test(error.message)) reloads.push(error.message);
  });

  const dom = new JSDOM(html, {
    url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole,
  });
  const win = dom.window as any;
  // jsdom に無いブラウザAPIだけを補う（アプリのコードには手を入れない）
  win.matchMedia = (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => false,
  });
  win.scrollTo = (x: number, y: number) => { scrolls.push([x, y]); };
  win.Element.prototype.scrollIntoView = function scrollIntoView(): void {};
  // 外部 <script>（subjects.js / updates.js / src/main.ts）は読み込まれないので同等の値を用意する
  win.SUBJECTS = [{ id: "test", name: "テスト科目", emoji: "🧪", accent: "#147d8f", learningMode: "lessons" }];
  win.APP_UPDATES = [];
  win.localStorage.setItem("quizCustomData_v1", JSON.stringify(QUESTIONS));

  win.eval(inlineScript);
  const app: App = { dom, win, reloads, scrolls };
  return until(() => shown(app, "#home"), "起動してホームが表示される").then(() => app);
}

function shown(app: App, selector: string): boolean {
  const el = app.win.document.querySelector(selector);
  return !!el && !el.classList.contains("hidden");
}

function click(app: App, selector: string): void {
  const el = app.win.document.querySelector(selector);
  if (!el) throw new Error(`要素がありません: ${selector}`);
  el.click();
}

/** 下のタブから「問題演習」を開き、そこからランダム10問の演習を始める */
async function startQuiz(app: App): Promise<void> {
  click(app, '#primaryNav [data-primary="practice"]');
  await until(() => shown(app, "#practiceView"), "問題演習の画面が開く");
  await until(() => !!app.win.document.querySelector("#qRandom"), "クイック演習が描画される");
  click(app, "#qRandom");
  await until(() => shown(app, "#quiz"), "演習が始まる");
}

/** 年度別演習から指定した問題数で開始する */
async function startQuizWithCount(app: App, count: number): Promise<void> {
  click(app, '#primaryNav [data-primary="practice"]');
  await until(() => shown(app, "#practiceView"), "問題演習の画面が開く");
  click(app, "#yearList .cat");
  await until(() => shown(app, "#countModal"), "問題数の選択画面が開く");
  app.win.document.querySelector("#countInput").value = String(count);
  click(app, "#countStart");
  await until(() => shown(app, "#quiz"), `${count}問の演習が始まる`);
}

let app: App | null = null;
afterEach(() => { app?.dom.window.close(); app = null; });

describe("利用中にホーム画面へ戻されない（実動作）", () => {
  it("問題演習の画面を開いている間に自動同期が終わっても、画面はそのまま", async () => {
    app = await bootApp();
    click(app, '#primaryNav [data-primary="practice"]');
    await until(() => shown(app!, "#practiceView"), "問題演習の画面が開く");

    app.win.__legacyAppRefresh();   // ← 同期完了時に src/legacy-bridge.ts が呼ぶもの
    await tick(20);

    expect(shown(app, "#practiceView")).toBe(true);
    expect(shown(app, "#home")).toBe(false);
  });

  it("問題を解いている最中に自動同期が終わっても、出題が中断されない", async () => {
    app = await bootApp();
    await startQuiz(app);
    const before = app.win.document.querySelector("#quiz").textContent;

    app.win.__legacyAppRefresh();
    await tick(20);

    expect(shown(app, "#quiz")).toBe(true);
    expect(shown(app, "#home")).toBe(false);
    expect(app.win.document.querySelector("#quiz").textContent).toBe(before);
  });

  it("45問を連続で解き、同期や更新が重なってもホームへ戻されない", async () => {
    app = await bootApp();
    await startQuizWithCount(app, 45);

    for (let question = 1; question <= 45; question += 1) {
      expect(app.win.document.querySelector("#counter").textContent).toBe(`${question} / 45`);
      expect(shown(app, "#quiz")).toBe(true);
      expect(shown(app, "#home")).toBe(false);

      click(app, "#qBlocks .choice");
      expect(shown(app, "#nextBtn")).toBe(true);

      // 長時間利用時に発生する自動同期の完了を繰り返し割り込ませる。
      if (question % 10 === 0) app.win.__legacyAppRefresh();
      // 新版の配信が40問を超えた直後に重なっても、演習中は適用を保留する。
      if (question === 41) app.win.__studyAppUpdateReady();
      await tick();

      expect(app.reloads).toEqual([]);
      expect(shown(app, "#quiz")).toBe(true);
      expect(shown(app, "#home")).toBe(false);
      click(app, "#nextBtn");
    }

    await until(() => shown(app!, "#result"), "45問の結果画面が開く");
    expect(shown(app, "#home")).toBe(false);
    expect(app.reloads).toEqual([]);
  });

  it("学習項目を読んでいる最中に自動同期が終わっても、本文は閉じない", async () => {
    app = await bootApp();
    click(app, '#primaryNav [data-primary="learn"]');
    await until(() => shown(app!, "#inputView"), "学習の画面が開く");
    click(app, "#lessonList [data-deck]");
    await until(() => shown(app!, "#lessonView"), "学習項目の本文が開く");
    const before = app.win.document.querySelector("#lessonView").textContent;

    app.win.__legacyAppRefresh();
    await tick(20);

    expect(shown(app, "#lessonView")).toBe(true);
    expect(shown(app, "#home")).toBe(false);
    expect(app.win.document.querySelector("#lessonView").textContent).toBe(before);

    app.win.__studyAppUpdateReady();
    await tick(20);
    expect(app.reloads).toEqual([]);
    expect(shown(app, "#lessonView")).toBe(true);
    expect(app.win.document.querySelector("#lessonView").textContent).toBe(before);
  });

  it("暗記カードなど他の画面でも同じ（メニューから開いた画面が閉じない）", async () => {
    app = await bootApp();
    click(app, '[data-menu-view="statsView"]');
    await until(() => shown(app!, "#statsView"), "学習状況の画面が開く");

    app.win.__legacyAppRefresh();
    await tick(20);

    expect(shown(app, "#statsView")).toBe(true);
    expect(shown(app, "#home")).toBe(false);
  });

  it("ホームを見ている最中の自動同期では、スクロール位置が先頭へ飛ばない", async () => {
    app = await bootApp();
    app.scrolls.length = 0;

    app.win.__legacyAppRefresh();
    await tick(20);

    expect(shown(app, "#home")).toBe(true);
    expect(app.scrolls).toEqual([]);   // 画面遷移をやり直していない証拠
  });

  it("新バージョンが届いても演習中は再読み込みせず、ホームへ戻ったときに適用する", async () => {
    app = await bootApp();
    await startQuiz(app);

    app.win.__studyAppUpdateReady();   // ← src/main.ts の onNeedReload が呼ぶもの
    await tick(20);
    expect(app.reloads).toEqual([]);
    expect(shown(app, "#quiz")).toBe(true);
    const toasts = [...app.win.document.querySelectorAll(".toast")].map((el: any) => el.textContent);
    expect(toasts.join(" ")).toContain("新しいバージョン");

    click(app, '#primaryNav [data-primary="home"]');   // 利用者が自分でホームへ戻る
    await tick(20);
    expect(app.reloads.length).toBe(1);
  });

  it("ホームから別画面へ遷移を始めた直後の更新でも、再読み込みしない", async () => {
    app = await bootApp();
    const updates: Array<() => void> = [];
    // 実ブラウザの View Transition は更新コールバックを次の描画機会まで待つ。
    app.win.document.startViewTransition = (update: () => void) => {
      updates.push(update);
      return {};
    };

    click(app, '#primaryNav [data-primary="practice"]');
    expect(updates).toHaveLength(1);
    expect(shown(app, "#home")).toBe(true); // DOM更新前でも、遷移先は問題演習として扱う

    app.win.__studyAppUpdateReady();
    await tick(20);
    expect(app.reloads).toEqual([]);

    updates.shift()?.();
    await tick(20);
    expect(shown(app, "#practiceView")).toBe(true);
    expect(shown(app, "#home")).toBe(false);
  });
});
