import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { publishBlockReason, shareErrorMessage } from "../src/memory-cards";
import type { Deck, StudyCard } from "../src/types";

const deck = (over: Partial<Deck> = {}): Deck => ({
  id: "deck-1", ownerId: null, system: "memory", subjectId: "genome",
  originSharedDeckId: null, originVersion: null, name: "ゲノム用語", description: "説明",
  order: 0, newCardsPerDay: 20, reviewsPerDay: 200, desiredRetention: 0.9, version: 1,
  createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z", deletedAt: null,
  ...over,
});

const card = (over: Partial<StudyCard> = {}): StudyCard => ({
  id: "card-1", ownerId: null, builtIn: false, kind: "basic", deckId: "deck-1",
  front: "表", back: "裏", choices: [], correctChoiceIndex: null, explanation: "", field: "ゲノム",
  source: "暗記カード", tags: [], image: null, imageAlt: "", version: 1, suspendedAt: null,
  originDeckId: null, originVersion: null, originCardId: null,
  createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z", deletedAt: null,
  ...over,
});

describe("公開前チェック（DBのcheck制約と同じ条件）", () => {
  it("正しいデッキは通す", () => {
    expect(publishBlockReason(deck(), [card()])).toBeNull();
  });

  it("デッキ名が空白だけなら止める", () => {
    expect(publishBlockReason(deck({ name: "   " }), [card()])).toContain("デッキ名");
  });

  it("デッキ名81文字は止める", () => {
    expect(publishBlockReason(deck({ name: "あ".repeat(81) }), [card()])).toContain("デッキ名");
  });

  it("説明501文字は止める", () => {
    expect(publishBlockReason(deck({ description: "あ".repeat(501) }), [card()])).toContain("説明");
  });

  it("空欄のカードは何枚目かを示す", () => {
    const reason = publishBlockReason(deck(), [card(), card({ id: "card-2", back: " " })]);
    expect(reason).toContain("2枚目");
  });

  it("表2000字超・裏4000字超は止める", () => {
    expect(publishBlockReason(deck(), [card({ front: "あ".repeat(2001) })])).toContain("1枚目");
    expect(publishBlockReason(deck(), [card({ back: "あ".repeat(4001) })])).toContain("1枚目");
  });

  it("5001枚は止める", () => {
    const many = Array.from({ length: 5001 }, (_, i) => card({ id: `card-${i}` }));
    expect(publishBlockReason(deck(), many)).toContain("5000枚");
  });
});

describe("共有エラーの日本語化", () => {
  it("テーブル未作成はマイグレーション未適用として案内する", () => {
    const message = shareErrorMessage({ code: "PGRST205", message: "Could not find the table 'public.shared_memory_decks' in the schema cache" });
    expect(message).toContain("マイグレーション未適用");
    expect(message).toContain("apply-all.generated.sql");
  });

  it("RPC未作成も同じ案内にする", () => {
    expect(shareErrorMessage({ code: "PGRST202", message: "Could not find the function public.publish_memory_deck" })).toContain("マイグレーション未適用");
  });

  it("RPCの検証メッセージ（P0001）はそのまま見せる", () => {
    expect(shareErrorMessage({ code: "P0001", message: "公開するカードは1〜5000枚にしてください" })).toBe("公開するカードは1〜5000枚にしてください");
  });

  it("セッション切れは再ログインを促す", () => {
    expect(shareErrorMessage({ code: "PGRST301", message: "JWT expired" })).toContain("ログイン");
  });

  it("通信エラーは再試行を促す", () => {
    expect(shareErrorMessage(new TypeError("Failed to fetch"))).toContain("通信");
  });
});
