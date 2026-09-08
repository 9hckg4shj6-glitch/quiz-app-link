import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";

/**
 * 復習画面の実動作テスト。index.html のアプリ本体を jsdom で起動し、
 * 予定時刻を過ぎた問題が「本日復習すべき問題」に、まだの問題が
 * 「これからの復習予定」に時刻つきで並ぶことを確かめる。
 */
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const inlineScript = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";

const QUESTIONS = [
  { id: "t1", year: "2025年度", field: "分野A", question: "過ぎている問題", choices: ["ア", "イ"], answer: 0, explanation: "解説" },
  { id: "t2", year: "2024年度", field: "分野B", question: "これからの問題", choices: ["ア", "イ"], answer: 0, explanation: "解説" },
];
const now = Date.now();
const PROGRESS = {
  t1: { seen: 1, correct: 1, wrong: 0, streak: 1, reps: 1, interval: 1, due: "2000-01-01",
        fsrs: { due: new Date(now - 600_000).toISOString() } },
  t2: { seen: 1, correct: 1, wrong: 0, streak: 1, reps: 1, interval: 1, due: "2099-01-01",
        fsrs: { due: new Date(now + 7_200_000).toISOString() } },
};

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) { if (check()) return; await tick(5); }
  throw new Error(`条件が満たされませんでした: ${label}`);
}

let dom: JSDOM | null = null;
afterEach(() => { dom?.window.close(); dom = null; });

async function boot(): Promise<any> {
  const virtualConsole = new VirtualConsole();
  dom = new JSDOM(html, { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  const win = dom.window as any;
  win.matchMedia = (q: string) => ({ matches: false, media: q, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
  win.scrollTo = () => {};
  win.Element.prototype.scrollIntoView = function () {};
  win.SUBJECTS = [{ id: "test", name: "テスト科目", emoji: "🧪", accent: "#147d8f", learningMode: "lessons" }];
  win.APP_UPDATES = [];
  win.localStorage.setItem("quizCustomData_v1", JSON.stringify(QUESTIONS));
  win.localStorage.setItem("quizProgress_v1", JSON.stringify(PROGRESS));
  win.eval(inlineScript);
  await until(() => !win.document.querySelector("#home")?.classList.contains("hidden"), "ホームが表示される");
  return win;
}

describe("復習画面", () => {
  it("予定を過ぎた問題と、これからの問題を時刻つきで並べる", async () => {
    const win = await boot();
    win.document.querySelector('#primaryNav [data-primary="review"]').click();
    await until(() => !win.document.querySelector("#reviewView").classList.contains("hidden"), "復習画面が開く");

    const due = win.document.querySelector("#reviewDueList");
    const future = win.document.querySelector("#reviewScheduleList");
    expect(due.querySelectorAll("[data-review-question]").length).toBe(1);
    expect(due.textContent).toContain("過ぎている問題");
    expect(due.textContent).toContain("予定から約");
    expect(future.querySelectorAll("[data-review-question]").length).toBe(1);
    expect(future.textContent).toContain("これからの問題");
    expect(future.textContent).toContain("約2時間後");

    // ホームの復習カードは件数を時刻で数える
    expect(win.document.querySelector("#reviewDueCount").textContent).toBe("1");
  });

  it("年度で絞ると、その年度の分野だけが選択肢になる", async () => {
    const win = await boot();
    win.document.querySelector('#primaryNav [data-primary="review"]').click();
    await until(() => !win.document.querySelector("#reviewView").classList.contains("hidden"), "復習画面が開く");

    const year = win.document.querySelector("#reviewYear");
    const field = win.document.querySelector("#reviewField");
    expect([...year.options].map((o: any) => o.value)).toEqual(["", "2025年度", "2024年度"]);
    year.value = "2024年度"; year.onchange();
    expect([...field.options].map((o: any) => o.textContent)).toEqual(["すべて", "分野B"]);
    expect(win.document.querySelector("#reviewScheduleList").textContent).toContain("これからの問題");
  });
});
