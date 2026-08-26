import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

describe("account sync UI orchestration", () => {
  it("旧コード移行とアカウント本体の同期を独立して実行する", () => {
    expect(html).toContain("ds.syncAccountData(legacyCode");
    expect(html).toContain("syncIdentity:()=>ac.syncIdentity");
    expect(html).toContain("if(result.legacyPending)");
  });

  it("自動同期後も現在画面を再描画する", () => {
    expect(html).toContain("refreshCurrentScreen();");
    expect(html).toContain("else toast(result.migratedLegacy");
  });

  it("問題解答時に端末別ランキングカウンターを加算する", () => {
    expect(html).toContain("function recordDeviceSolved(questionId)");
    expect(html).toContain("deviceSolvedCount(currentSubjectId)");
  });

  it("問題別の正誤回数を端末別G-Counterとして統合する", () => {
    expect(html).toContain("function recordAnswerCounters(r,questionId,isCorrect)");
    expect(html).toContain("r._deviceCounts=map");
    expect(html).toContain("mergeDeviceCounts(a._deviceCounts)");
    expect(html.match(/recordAnswerCounters\(r,/g)?.length).toBeGreaterThanOrEqual(6);
  });
});
