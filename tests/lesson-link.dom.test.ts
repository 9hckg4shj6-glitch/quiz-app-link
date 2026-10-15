import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPracticeSessions, deletePracticeSession, getPracticeSession, savePracticeSession } from "../src/practice-session";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
const question = { id: "one", year: "テスト年度", field: "分野", question: "問題one", choices: ["正しい答え", "違う答え", "もう一つの答え"],
  answer: 0, explanation: "仕組みの説明", slideRefs: [{ deck: "01", name: "第1回", pages: [3] }] };
const lessons = [{ deck: "01", sections: [
  { heading: "導入", body: "前置き", slides: [1] },
  { heading: "核心の論点", body: "本文", slides: [3] },
] }];
const doms: JSDOM[] = [];
const scheduled = vi.fn();
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400; i++) { if (check()) return; await tick(5); }
  throw new Error("画面の更新が完了しませんでした");
}
function click(win: any, selector: string) { const el = win.document.querySelector(selector); expect(el, selector).toBeTruthy(); el.click(); }
function shown(win: any, selector: string) { return !win.document.querySelector(selector).classList.contains("hidden"); }
async function boot(): Promise<any> {
  const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  doms.push(dom);
  const win = dom.window as any;
  win.matchMedia = () => ({ matches: false, addEventListener() {} });
  win.scrollTo = () => {};
  win.CSS = { escape: (s: string) => s };
  win.Element.prototype.scrollIntoView = () => {};
  win.confirm = vi.fn(() => true);
  win.SUBJECTS = [{ id: "test", name: "テスト", learningMode: "lessons" }];
  win.APP_UPDATES = [];
  win.STUDY_CORE = { practiceSessions: { save: savePracticeSession, get: getPracticeSession, delete: deletePracticeSession, clear: clearPracticeSessions },
    scheduleReview: scheduled };
  win.localStorage.setItem("quizCustomData_v1", JSON.stringify([question]));
  win.eval(script);
  await until(() => win.document.querySelector("#appTitle").textContent === "テスト");
  await tick(20);
  win.LESSONS = lessons;
  return win;
}
async function start(win: any) {
  click(win, '#primaryNav [data-primary="practice"]');
  await until(() => shown(win, "#practiceView"));
  click(win, "#qRandom");
  await until(() => shown(win, "#quiz"));
}
function choose(win: any, text: string) {
  const btn: any = [...win.document.querySelectorAll("#qBlocks .choice")].find((b: any) => b.querySelector(".choiceText").textContent === text);
  expect(btn).toBeTruthy(); btn.click();
}
afterEach(async () => {
  doms.forEach(dom => dom.window.close()); doms.length = 0;
  await clearPracticeSessions();
  scheduled.mockClear();
});

describe("解く→分かる の導線", () => {
  it("解説から学習編の該当項目へ飛び、演習の状態を保ったまま問題へ戻れる", async () => {
    const win = await boot(); await start(win);
    choose(win, "違う答え");
    const links = win.document.querySelectorAll("#qBlocks .lessonLink");
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toContain("核心の論点");
    links[0].click();
    expect(shown(win, "#lessonView")).toBe(true);
    expect(shown(win, "#quiz")).toBe(false);
    expect(win.document.querySelector("#lesson-section-01-2").classList.contains("lsLinked")).toBe(true);
    expect(win.document.querySelector("#lessonBack").textContent).toBe("← 問題にもどる");
    click(win, "#lessonBack");
    expect(shown(win, "#quiz")).toBe(true);
    expect(shown(win, "#lessonView")).toBe(false);
    expect(win.document.querySelector("#qBlocks .explain.ng")).toBeTruthy();
    expect(win.document.querySelector("#lessonBack").textContent).toBe("← 授業回一覧");
  });

  it("学習編の項目から、同じスライドを根拠に持つ問題だけを解ける", async () => {
    const win = await boot();
    click(win, '#primaryNav [data-primary="learn"]');
    await until(() => !!win.document.querySelector('[data-deck="01"]'));
    click(win, '[data-deck="01"]');
    await until(() => shown(win, "#lessonView") && !!win.document.querySelector("#lesson-section-01-2"));
    expect(win.document.querySelector("#lesson-section-01-1 [data-sect-practice]")).toBeNull();
    expect(win.document.querySelector("#lesson-section-01-2 [data-sect-practice]").textContent).toContain("この論点を1問解く");
    click(win, "#lesson-section-01-2 [data-sect-practice]");
    await until(() => shown(win, "#quiz"));
    expect(win.document.querySelector("#counter").textContent).toBe("1 / 1");
    expect(win.document.querySelector("#qBlocks").textContent).toContain("問題one");
  });

  it("勘で当たった正解はAgainで記録し、苦手克服の連続正解に数えない", async () => {
    const win = await boot(); await start(win);
    choose(win, "正しい答え");
    click(win, '.confBtn[data-g="1"]');
    expect(scheduled).toHaveBeenLastCalledWith(expect.anything(), 1, "one");
    const progress = JSON.parse(win.localStorage.getItem("quizProgress_v1"));
    expect(progress.one).toMatchObject({ correct: 1, streak: 0, lastGrade: 1 });
    expect(win.document.querySelector('.confBtn[data-g="1"]').classList.contains("sel")).toBe(true);
  });
});
