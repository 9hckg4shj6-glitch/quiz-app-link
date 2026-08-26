import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { clearPrivateStudyDataForAccountSwitch } from "../src/sync";
import type { StudyCard } from "../src/types";

function card(id: string, builtIn: boolean): StudyCard {
  return {
    id, ownerId: builtIn ? null : "old-user", builtIn, kind: "basic", deckId: "deck-personal",
    front: id, back: "", choices: [], correctChoiceIndex: null, explanation: "", field: "",
    source: "", tags: [], image: null, imageAlt: "", version: 1,
    suspendedAt: null, originDeckId: null, originVersion: null, originCardId: null,
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", deletedAt: null,
  };
}

beforeEach(async () => {
  await Promise.all([
    db.cards.clear(), db.decks.clear(), db.reviewEvents.clear(), db.schedules.clear(), db.outbox.clear(),
    db.settings.clear(), db.writtenAttempts.clear(), db.writtenDrafts.clear(),
  ]);
});

describe("account local data isolation", () => {
  it("アカウント切替時は公開端末IDと内蔵カードだけを残す", async () => {
    await db.cards.bulkPut([card("built-in", true), card("private", false)]);
    await db.settings.bulkPut([
      { key: "deviceId", ownerId: null, value: "device-1", updatedAt: "2026-08-01T00:00:00.000Z" },
      { key: "legacyProgress", ownerId: "old-user", value: { q1: { seen: 1 } }, updatedAt: "2026-08-01T00:00:00.000Z" },
    ]);
    await db.decks.put({
      id: "deck-personal", ownerId: "old-user", name: "自作", description: "", order: 0, version: 1,
      system: "legacy", subjectId: "metabolism", originSharedDeckId: null, originVersion: null,
      newCardsPerDay: 20, reviewsPerDay: 200, desiredRetention: 0.9,
      createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", deletedAt: null,
    });

    await clearPrivateStudyDataForAccountSwitch();

    expect(await db.cards.get("built-in")).toBeTruthy();
    expect(await db.cards.get("private")).toBeUndefined();
    expect(await db.decks.count()).toBe(0);
    expect((await db.settings.get("deviceId"))?.value).toBe("device-1");
    expect(await db.settings.get("legacyProgress")).toBeUndefined();
  });
});
