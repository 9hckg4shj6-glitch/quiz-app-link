import { describe, expect, it } from "vitest";
import { cardSchema } from "../src/schema";

const baseCard = {
  id: "card-1",
  ownerId: null,
  builtIn: false,
  kind: "basic" as const,
  deckId: "deck-personal",
  front: "ATPとは何か",
  back: "アデノシン三リン酸",
  choices: [],
  correctChoiceIndex: null,
  explanation: "",
  field: "生化学",
  source: "自作",
  tags: ["ATP"],
  image: null,
  imageAlt: "",
  version: 1,
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z",
  deletedAt: null,
};

describe("cardSchema", () => {
  it("基本カードを受理する", () => {
    expect(cardSchema.parse(baseCard).front).toBe("ATPとは何か");
  });

  it("選択肢不足を拒否する", () => {
    const result = cardSchema.safeParse({ ...baseCard, kind: "multiple-choice", choices: ["1個だけ"], correctChoiceIndex: 0 });
    expect(result.success).toBe(false);
  });

  it("範囲外の正解番号を拒否する", () => {
    const result = cardSchema.safeParse({ ...baseCard, kind: "multiple-choice", choices: ["A", "B"], correctChoiceIndex: 2 });
    expect(result.success).toBe(false);
  });
});
