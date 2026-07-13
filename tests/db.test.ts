import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { StudyDatabase } from "../src/db";

describe("StudyDatabase", () => {
  const databases: StudyDatabase[] = [];

  afterEach(async () => {
    for (const database of databases) {
      database.close();
      await database.delete();
    }
    databases.length = 0;
  });

  it("カードと復習予定をIndexedDBへ保存できる", async () => {
    const database = new StudyDatabase();
    databases.push(database);
    await database.cards.put({
      id: "card-1", ownerId: null, builtIn: false, kind: "basic", deckId: "deck-personal",
      front: "表", back: "裏", choices: [], correctChoiceIndex: null, explanation: "", field: "",
      source: "自作", tags: [], image: null, imageAlt: "", version: 1,
      createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z", deletedAt: null,
    });
    expect((await database.cards.get("card-1"))?.back).toBe("裏");
  });
});
