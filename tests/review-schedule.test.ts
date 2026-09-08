import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";

// index.html の予定判定はモジュール外（旧来のインラインJS）にあるので、
// 該当箇所だけを切り出して評価する。
const html = fs.readFileSync("index.html", "utf8");
const source = html.slice(html.indexOf("  function reviewAt("), html.indexOf("  function renderReviewSchedule("));
const now = new Date(2026, 8, 7, 12, 0, 0).getTime();

type Rec = Record<string, unknown>;
function api(progress: Rec, DATA: { id: string }[], terms: { id: string }[] = []) {
  return new Function(
    "progress", "DATA", "termSources", "esc", "$",
    `${source};return {reviewAt,reviewText,dueItems,dueTermItems};`,
  )(progress, DATA, () => terms, (x: string) => x, () => null);
}

describe("復習の時刻判定", () => {
  it("10分後の問題は時刻を迎えて初めて復習対象になる", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(now);
      const r = { seen: 1, due: "2026-09-07", fsrs: { due: new Date(now + 600_000).toISOString() } };
      const a = api({ q: r }, [{ id: "q" }]);
      expect(a.dueItems()).toEqual([]);            // 日付だけ見ていた旧実装はここで対象にしていた
      expect(a.reviewText(r, now)).toContain("10分後");
      vi.setSystemTime(now + 600_000);
      expect(a.dueItems()).toEqual([{ id: "q" }]);
    } finally { vi.useRealTimers(); }
  });

  it("旧来の日付だけの予定は現地の午前0時として読む", () => {
    const a = api({}, []);
    expect(a.reviewAt({ due: "2026-09-08" })).toBe(new Date(2026, 8, 8).getTime());
    expect(a.reviewText({ seen: 1 })).toBe("予定未設定");
    expect(a.reviewText({})).toBe("未学習");
    expect(a.reviewText({ fsrs: { due: new Date(now - 172_800_000).toISOString() } }, now)).toContain("2日経過");
  });

  it("講義カードの復習も日付ではなく時刻で判定する", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(now);
      const terms = [{ id: "t1" }];
      const progress = { t1: { seen: 1, due: "2026-09-07", fsrs: { due: new Date(now + 600_000).toISOString() } } };
      const a = api(progress, [], terms);
      expect(a.dueTermItems()).toEqual([]);
      vi.setSystemTime(now + 600_000);
      expect(a.dueTermItems()).toEqual(terms);
    } finally { vi.useRealTimers(); }
  });
});
