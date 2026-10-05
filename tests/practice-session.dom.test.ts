import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db";
import { clearPracticeSessions, deletePracticeSession, getPracticeSession, savePracticeSession } from "../src/practice-session";
import * as written from "../src/written";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
const choice = (id: string, extra = {}) => ({ id, year: "テスト年度", field: "分野", question: `問題${id}`,
  choices: ["正しい答え", "違う答え", "もう一つの答え"], answer: 0, explanation: "仕組みの説明", ...extra });
const essay = { id: "essay", year: "テスト年度", field: "分野", question: "仕組みを説明", type: "constructed", points: 2,
  responseParts: [{ id: "text", kind: "long-text", label: "答案", requiredTerms: ["因果"] }],
  rubric: [{ id: "a", text: "因果を説明", points: 1, partIds: ["text"] }, { id: "b", text: "働きを説明", points: 1, partIds: ["text"] }],
  modelAnswer: "因果と働きを説明する", explanation: "解説" };
const doms: JSDOM[] = [];
const scheduled = vi.fn((progress: any, rating: number) => ({ ...progress, reps: (progress.reps || 0) + 1,
  interval: 1, due: "2099-01-01", lastGrade: rating }));
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400; i++) { if (check()) return; await tick(5); }
  throw new Error("画面の更新が完了しませんでした");
}
function click(win: any, selector: string) { const el = win.document.querySelector(selector); expect(el, selector).toBeTruthy(); el.click(); }
function shown(win: any, selector: string) { return !win.document.querySelector(selector).classList.contains("hidden"); }
function storage(win: any): Record<string, string> { return Object.fromEntries(Object.keys(win.localStorage).map(k => [k, win.localStorage.getItem(k)])); }
async function boot(questions: unknown[] = [choice("one"), choice("two")], saved: Record<string, string> = {}): Promise<any> {
  const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  doms.push(dom);
  const win = dom.window as any;
  win.matchMedia = () => ({ matches: false, addEventListener() {} });
  win.scrollTo = () => {};
  win.CSS = { escape: (s: string) => s };
  win.Element.prototype.scrollIntoView = () => {};
  win.HTMLCanvasElement.prototype.getContext = () => ({ save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() {}, clearRect() {}, setTransform() {} });
  win.HTMLCanvasElement.prototype.setPointerCapture = () => {};
  win.confirm = vi.fn(() => true);
  win.SUBJECTS = [{ id: "test", name: "テスト", learningMode: "lessons" }];
  win.APP_UPDATES = [];
  win.STUDY_CORE = { practiceSessions: { save: savePracticeSession, get: getPracticeSession, delete: deletePracticeSession, clear: clearPracticeSessions },
    writtenAttempts: { ...written, deleteAll: written.deleteAll }, scheduleReview: scheduled };
  Object.entries(saved).forEach(([k, v]) => win.localStorage.setItem(k, v));
  win.localStorage.setItem("quizCustomData_v1", JSON.stringify(questions));
  win.eval(script);
  await until(() => win.document.querySelector("#appTitle").textContent === "テスト");
  await tick(20);
  return win;
}
async function start(win: any, batch = false) {
  click(win, '#primaryNav [data-primary="practice"]');
  await until(() => shown(win, "#practiceView"));
  if (batch) { click(win, "#yearList .cat"); click(win, "#gradingBatch"); click(win, "#countStart"); }
  else click(win, "#qRandom");
  await until(() => shown(win, "#quiz"));
}
function choose(win: any, text: string) {
  const buttons = [...win.document.querySelectorAll("#qBlocks .choice")];
  const btn: any = buttons.find((b: any) => b.querySelector(".choiceText").textContent === text);
  expect(btn).toBeTruthy(); btn.click();
}
async function pause(win: any) { click(win, "#pausePracticeBtn"); await until(() => shown(win, "#home") && shown(win, "#savedPracticeSection")); }
async function reload(win: any, questions?: unknown[]) {
  const values = storage(win); win.close();
  const next = await boot(questions, values);
  await until(() => shown(next, "#savedPracticeSection"));
  click(next, "#resumePracticeBtn");
  await until(() => shown(next, "#quiz"));
  return next;
}
afterEach(async () => {
  doms.forEach(dom => dom.window.close()); doms.length = 0;
  await clearPracticeSessions();
  await db.writtenAttempts.clear(); await db.writtenDrafts.clear();
  scheduled.mockClear(); vi.restoreAllMocks();
});

describe("通常演習の途中保存と復元", () => {
  it("作図の線を再起動後も保持し、続きを描ける", async () => {
    const questions = [{ ...essay, id: "drawing", responseParts: [{ id: "diagram", kind: "drawing", label: "図" }],
      rubric: [{ id: "a", text: "関係を描く", points: 2, partIds: ["diagram"] }] }];
    let win = await boot(questions); await start(win);
    const draw = () => {
      const canvas = win.document.querySelector(".drawCanvas");
      canvas.dispatchEvent(new win.MouseEvent("pointerdown", { clientX: 0, clientY: 0 }));
      canvas.dispatchEvent(new win.MouseEvent("pointermove", { clientX: 1, clientY: 1 }));
      canvas.dispatchEvent(new win.MouseEvent("pointerup"));
    };
    draw(); await pause(win);
    const before = (await getPracticeSession("test"))!.entries[0].written!.answers.diagram;
    expect(before).toMatchObject({ kind: "drawing", strokes: [{ tool: "pen", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }] });
    win = await reload(win, questions);
    expect(win.document.querySelector('.cwActions .primary').disabled).toBe(false);
    await pause(win);
    expect((await getPracticeSession("test"))!.entries[0].written!.answers.diagram).toEqual(before);
    click(win, "#resumePracticeBtn"); await until(() => shown(win, "#quiz")); draw(); await pause(win);
    expect((await getPracticeSession("test"))!.entries[0].written!.answers.diagram).toMatchObject({ strokes: [before.kind === "drawing" && before.strokes[0], before.kind === "drawing" && before.strokes[0]] });
  });
  it("採点結果・選択肢順・手ごたえを復元し、再開や前後移動で二重計上しない", async () => {
    let win = await boot(); await start(win);
    const order = [...win.document.querySelectorAll(".choiceText")].map((el: any) => el.textContent);
    choose(win, "正しい答え"); click(win, '.confBtn[data-g="4"]');
    expect(win.document.querySelector(".choiceStatus")).toBeTruthy();
    await pause(win);
    const progress = win.localStorage.getItem("quizProgress_v1"), meta = win.localStorage.getItem("quizMeta_v1");
    const reviews = scheduled.mock.calls.length;
    win = await reload(win);
    expect([...win.document.querySelectorAll(".choiceText")].map((el: any) => el.textContent)).toEqual(order);
    expect(win.document.querySelector('.confBtn[data-g="4"]').classList.contains("sel")).toBe(true);
    expect(win.document.querySelector(".confRow").classList.contains("done")).toBe(true);
    click(win, "#nextBtn"); click(win, "#prevBtn");
    await pause(win); win = await reload(win);
    expect(win.localStorage.getItem("quizProgress_v1")).toBe(progress);
    expect(win.localStorage.getItem("quizMeta_v1")).toBe(meta);
    expect(scheduled).toHaveBeenCalledTimes(reviews);
  });
  it("採点後・手ごたえ未選択から再開し、初めて手ごたえを選ぶと一度だけ記録する", async () => {
    let win = await boot([choice("one")]); await start(win); choose(win, "正しい答え"); await pause(win);
    expect(scheduled).not.toHaveBeenCalled();
    win = await reload(win, [choice("one")]); click(win, '.confBtn[data-g="3"]'); click(win, '.confBtn[data-g="3"]');
    expect(scheduled).toHaveBeenCalledTimes(1);
    expect(JSON.parse(win.localStorage.getItem("quizProgress_v1")).one.seen).toBe(1);
  });
  it("複数選択の選択途中を採点せず復元する", async () => {
    const questions = [choice("multi", { answers: [0, 2] })];
    let win = await boot(questions); await start(win); choose(win, "正しい答え"); await pause(win);
    win = await reload(win, questions);
    expect(win.document.querySelectorAll(".choice.selected")).toHaveLength(1);
    expect(win.document.querySelector(".multiConfirm").disabled).toBe(true);
    expect(win.document.querySelectorAll(".choiceStatus")).toHaveLength(0);
    choose(win, "もう一つの答え"); click(win, ".multiConfirm");
    expect(win.document.querySelector(".explain.head")?.textContent ?? win.document.querySelector(".explain .head").textContent).toContain("正解");
  });
  it("まとめて採点前の回答を復元し、提出時だけ記録する", async () => {
    let win = await boot(); await start(win, true); choose(win, "正しい答え"); await pause(win);
    expect(scheduled).not.toHaveBeenCalled();
    win = await reload(win);
    expect(win.document.querySelectorAll(".choice.selected")).toHaveLength(1);
    click(win, "#nextBtn"); choose(win, "違う答え"); click(win, "#nextBtn");
    await until(() => shown(win, "#result"));
    expect(scheduled).toHaveBeenCalledTimes(2);
    expect(await getPracticeSession("test")).toBeNull();
  });
  it("大問の回答途中を復元し、小問をまとめて採点できる", async () => {
    const questions = [choice("g1", { groupId: "g", groupOrder: 1 }), choice("g2", { groupId: "g", groupOrder: 2 })];
    let win = await boot(questions); await start(win);
    click(win, ".qBlock:first-child .choice"); await pause(win);
    win = await reload(win, questions);
    expect(win.document.querySelectorAll(".qBlock")).toHaveLength(2);
    expect(win.document.querySelectorAll(".choice.selected")).toHaveLength(1);
    expect(scheduled).not.toHaveBeenCalled();
    click(win, ".qBlock:last-child .choice"); click(win, "#qGroupSubmit");
    expect(win.document.querySelectorAll(".choiceStatus")).toHaveLength(6);
  });
  it("後で解くの並びと現在位置を復元する", async () => {
    let win = await boot(); await start(win);
    const before = win.document.querySelector(".qtext").textContent;
    click(win, "#deferBtn"); const after = win.document.querySelector(".qtext").textContent;
    expect(after).not.toBe(before); await pause(win); win = await reload(win);
    expect(win.document.querySelector(".qtext").textContent).toBe(after);
    expect(win.document.querySelector("#laterCount").textContent).toBe("1");
    click(win, "#laterQueueBtn"); expect(win.document.querySelector(".qtext").textContent).toBe(before);
  });
  it("記述入力と自己採点途中のチェックを復元し、確定済み答案も重複保存しない", async () => {
    let win = await boot([essay]); await start(win);
    const input = win.document.querySelector(".cwText"); input.value = "因果についての自分の説明"; input.dispatchEvent(new win.Event("input"));
    await pause(win); win = await reload(win, [essay]);
    expect(win.document.querySelector(".cwText").value).toBe("因果についての自分の説明");
    click(win, ".cwActions .primary"); click(win, '[data-crit="a"]'); await pause(win); win = await reload(win, [essay]);
    expect(win.document.querySelector('[data-crit="a"]').checked).toBe(true);
    expect(win.document.querySelector('[data-crit="b"]').checked).toBe(false);
    expect(await db.writtenAttempts.count()).toBe(0);
    click(win, '.cwRateRow .confBtn[data-g="2"]'); await pause(win);
    expect(await db.writtenAttempts.count()).toBe(1);
    const reviews = scheduled.mock.calls.length;
    win = await reload(win, [essay]);
    expect(win.document.querySelector('[data-crit="a"]').disabled).toBe(true);
    click(win, "#nextBtn"); await until(() => shown(win, "#result"));
    expect(scheduled).toHaveBeenCalledTimes(reviews);
    expect(await db.writtenAttempts.count()).toBe(1);
  });
  it("新しい演習への置換を断ると保存状態を維持し、破棄では学習記録を残す", async () => {
    const win = await boot(); await start(win); choose(win, "違う答え"); await pause(win);
    const original = await getPracticeSession("test"), progress = win.localStorage.getItem("quizProgress_v1");
    win.confirm.mockReturnValueOnce(false);
    click(win, '#primaryNav [data-primary="practice"]'); click(win, "#qRandom"); await tick(50);
    expect(shown(win, "#practiceView")).toBe(true);
    expect(await getPracticeSession("test")).toEqual(original);
    click(win, '#primaryNav [data-primary="home"]'); await until(() => shown(win, "#savedPracticeSection"));
    click(win, "#discardPracticeBtn"); await until(() => !shown(win, "#savedPracticeSection"));
    expect(await getPracticeSession("test")).toBeNull();
    expect(win.localStorage.getItem("quizProgress_v1")).toBe(progress);
  });
  it("教材変更を検出して再開せず、保存済み状態を勝手に破棄しない", async () => {
    const win = await boot([choice("one")]); await start(win); await pause(win);
    const next = await boot([choice("one", { explanation: "訂正された解説" })], storage(win));
    await until(() => shown(next, "#savedPracticeSection")); click(next, "#resumePracticeBtn"); await tick(50);
    expect(shown(next, "#quiz")).toBe(false);
    expect(next.document.querySelector("#savedPracticeInfo").textContent).toContain("教材の内容が変わった");
    expect(await getPracticeSession("test")).not.toBeNull();
  });
  it("保存に失敗したら中断せず、再試行で保存できる", async () => {
    const win = await boot(); await start(win);
    const save = win.STUDY_CORE.practiceSessions.save;
    win.STUDY_CORE.practiceSessions.save = () => Promise.reject(new Error("容量不足"));
    click(win, "#pausePracticeBtn"); await tick(50);
    expect(shown(win, "#quiz")).toBe(true);
    expect(win.document.querySelector("#practiceSaveStatus").textContent).toContain("保存できません");
    win.STUDY_CORE.practiceSessions.save = save; await pause(win);
    expect(await getPracticeSession("test")).not.toBeNull();
  });
  it("本番モードを途中保存の対象にしない", async () => {
    const win = await boot(); click(win, '#primaryNav [data-primary="practice"]'); click(win, "#examCard");
    await until(() => shown(win, "#quiz"));
    expect(shown(win, "#pausePracticeBtn")).toBe(false);
    expect(await getPracticeSession("test")).toBeNull();
  });
  it("科目別に保存を分け、リセットで全科目の途中状態を削除する", async () => {
    const win = await boot(); await start(win); await pause(win);
    const first = await getPracticeSession("test");
    await savePracticeSession({ ...first, subjectId: "other", id: "other-practice" });
    expect((await getPracticeSession("other"))?.id).toBe("other-practice");
    click(win, "#resetBtn");
    await until(() => !shown(win, "#savedPracticeSection"));
    expect(await getPracticeSession("test")).toBeNull();
    expect(await getPracticeSession("other")).toBeNull();
  });
  it("アプリを閉じる前のpagehideでも最新の選択途中を保存する", async () => {
    const questions = [choice("multi", { answers: [0, 2] })];
    let win = await boot(questions); await start(win); choose(win, "正しい答え");
    win.dispatchEvent(new win.Event("pagehide"));
    await getPracticeSession("test"); await tick(10);
    win = await reload(win, questions);
    expect(win.document.querySelectorAll(".choice.selected")).toHaveLength(1);
  });
  it("壊れた保存データは説明を表示し、破棄して開始できる", async () => {
    await db.practiceSessions.put({ subjectId: "test", version: 999 } as any);
    const win = await boot();
    await until(() => shown(win, "#savedPracticeSection"));
    expect(win.document.querySelector("#resumePracticeBtn").disabled).toBe(true);
    expect(win.document.querySelector("#savedPracticeInfo").textContent).toContain("保存データが壊れて");
    click(win, "#discardPracticeBtn"); await until(() => !shown(win, "#savedPracticeSection"));
    await start(win); expect(await getPracticeSession("test")).not.toBeNull();
  });
});

describe("読みやすさ設定", () => {
  it("文字・行間を即時反映し、再起動後も保持、標準へ戻せる", async () => {
    let win = await boot();
    const set = (id: string, value: string) => { const el = win.document.querySelector(id); el.value = value; el.dispatchEvent(new win.Event("change")); };
    set("#readingFontSize", "150"); set("#readingLineHeight", "1.4");
    expect(win.document.documentElement.style.getPropertyValue("--reading-font-scale")).toBe("1.5");
    expect(win.document.documentElement.style.getPropertyValue("--reading-line-scale")).toBe("1.4");
    win = await boot(undefined, storage(win));
    expect(win.document.querySelector("#readingFontSize").value).toBe("150");
    expect(win.document.querySelector("#readingLineHeight").value).toBe("1.4");
    click(win, "#resetReadabilityBtn");
    expect(JSON.parse(win.localStorage.getItem("quizReadability_v1"))).toEqual({ fontSize: 100, lineHeight: 1 });
  });
  it("壊れた設定を読み込んでも標準で起動できる", async () => {
    const win = await boot(undefined, { quizReadability_v1: '{"fontSize":500,"lineHeight":-1}' });
    expect(win.document.querySelector("#readingFontSize").value).toBe("100");
    expect(win.document.querySelector("#readingLineHeight").value).toBe("1");
  });
});
