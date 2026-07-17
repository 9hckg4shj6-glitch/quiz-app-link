import { beforeEach, describe, expect, it, vi } from "vitest";

// community.ts は supabase / dexie を読み込むので、通信部分だけ差し替える
vi.mock("../src/sync", () => ({ supabase: null }));
vi.mock("../src/db", () => ({ getDeviceId: async () => "device-1" }));
vi.mock("../src/leaderboard", () => ({ getSavedName: () => "" }));

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

const { markAllSeen, markBoardSeen, seenCountFor, unreadCount } = await import("../src/community");

// refreshUnread は通信するので、代わりに一覧取得の結果を直接書き込んで状況を作る
const setBoards = (boards: Record<string, number>) => store.set("cm_last_v1", JSON.stringify(boards));

describe("コミュニティの新着件数", () => {
  beforeEach(() => store.clear());

  it("何も読んでいなければ、全投稿が新着になる", () => {
    setBoards({ a: 3, b: 2 });
    expect(unreadCount()).toBe(5);
  });

  it("掲示板を開くと、その板の分だけ新着が減る", () => {
    setBoards({ a: 3, b: 2 });
    markBoardSeen("a", 3);
    expect(unreadCount()).toBe(2);
    markBoardSeen("b", 2);
    expect(unreadCount()).toBe(0);
  });

  it("読んだ後に書き込まれた分だけが新着になる", () => {
    setBoards({ a: 3 });
    markBoardSeen("a", 3);
    expect(unreadCount()).toBe(0);
    setBoards({ a: 5 }); // 誰かが2件書いた
    expect(unreadCount()).toBe(2);
    expect(seenCountFor("a")).toBe(3);
  });

  it("新しく作られた掲示板の投稿も新着に数える", () => {
    setBoards({ a: 3 });
    markBoardSeen("a", 3);
    setBoards({ a: 3, newBoard: 4 });
    expect(unreadCount()).toBe(4);
  });

  it("既読数は巻き戻らない（投稿が削除されて数が減っても負にしない）", () => {
    setBoards({ a: 5 });
    markBoardSeen("a", 5);
    markBoardSeen("a", 2); // 削除等で少ない値が来ても既読は減らさない
    expect(seenCountFor("a")).toBe(5);
    setBoards({ a: 2 });
    expect(unreadCount()).toBe(0); // 負にならない
  });

  it("まとめて既読にすると0になる", () => {
    setBoards({ a: 3, b: 7 });
    expect(unreadCount()).toBe(10);
    markAllSeen();
    expect(unreadCount()).toBe(0);
  });

  it("未読情報が壊れていても落ちない", () => {
    store.set("cm_last_v1", "{壊れたJSON");
    expect(unreadCount()).toBe(0);
  });
});
