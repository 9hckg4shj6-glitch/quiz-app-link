import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
const doms: JSDOM[] = [];
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

function boot(session: Record<string, string> = {}) {
  const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  doms.push(dom);
  const win = dom.window as any;
  win.matchMedia = () => ({ matches: false, addEventListener() {} });
  win.scrollTo = () => {};
  win.CSS = { escape: (s: string) => s };
  win.SUBJECTS = [{ id: "test", name: "テスト", learningMode: "lessons", expectQuestions: 1 }];
  win.APP_UPDATES = [];
  const account = {
    state: () => ({ status: "guest", socialEnabled: false }), publicName: () => "", entryChoice: () => null,
    chooseEntry: vi.fn(), saveStartName: vi.fn(async (name: string) => name),
  };
  const guide = { open: vi.fn(), seen: () => false };
  win.STUDY_CORE = { account, guide };
  Object.entries(session).forEach(([k, v]) => win.sessionStorage.setItem(k, v));
  win.localStorage.setItem("quizCustomData_v1", JSON.stringify([{ id: "q1", year: "年度", field: "分野", question: "問題", choices: ["正", "誤"], answer: 0, explanation: "解説" }]));
  win.eval(script);
  const $ = (s: string) => win.document.querySelector(s);
  return { win, $, account, guide };
}

afterEach(() => { doms.splice(0).forEach(d => d.window.close()); });

describe("スタート画面", () => {
  it("開いたときに出て、名前が空なら先へ進まない", async () => {
    const { win, $, account } = boot();
    expect($("#startScreen").classList.contains("hidden")).toBe(false);
    $("#startForm").dispatchEvent(new win.Event("submit", { cancelable: true }));
    await tick(300);
    expect($("#startScreen").classList.contains("hidden")).toBe(false);
    expect($("#startError").classList.contains("hidden")).toBe(false);
    expect($("#startName").getAttribute("aria-invalid")).toBe("true");
    expect(account.saveStartName).not.toHaveBeenCalled();
  });

  it("名前を入れて始めると、名前を保存して閉じ、同じ起動の中では二度出さない", async () => {
    const { win, $, account } = boot();
    $("#startName").value = "  医学 太郎 ";
    $("#startForm").dispatchEvent(new win.Event("submit", { cancelable: true }));
    expect(account.saveStartName).toHaveBeenCalledWith("医学 太郎");
    expect(account.chooseEntry).toHaveBeenCalledWith("guest");
    await tick(300);
    expect($("#startScreen").classList.contains("hidden")).toBe(true);
    expect(win.sessionStorage.getItem("startSeen_v1")).toBe("1");
    const again = boot({ startSeen_v1: "1" });
    expect(again.$("#startScreen").classList.contains("hidden")).toBe(true);
  });

  it("初めての人には使い方ガイドを先に勧め、押すとガイドを開く", async () => {
    const { $, guide } = boot();
    await tick(20);   // 中身は起動処理（科目の読み込み）のあとに描く
    expect($("#startAction").classList.contains("first")).toBe(true);
    $("#startGuideBtn").click();
    expect(guide.open).toHaveBeenCalled();
  });
});
