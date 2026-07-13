import Dexie, { type EntityTable } from "dexie";
import type {
  Deck,
  OutboxRecord,
  ReviewEvent,
  SettingRecord,
  StoredSchedule,
  StudyCard,
  SyncTable,
} from "./types";

export class StudyDatabase extends Dexie {
  cards!: EntityTable<StudyCard, "id">;
  decks!: EntityTable<Deck, "id">;
  reviewEvents!: EntityTable<ReviewEvent, "id">;
  schedules!: EntityTable<StoredSchedule, "cardId">;
  outbox!: EntityTable<OutboxRecord, "seq">;
  settings!: EntityTable<SettingRecord, "key">;

  constructor() {
    super("metabolism-study-v2");
    this.version(1).stores({
      cards: "&id, ownerId, deckId, kind, updatedAt, deletedAt, *tags",
      decks: "&id, ownerId, order, updatedAt, deletedAt",
      reviewEvents: "&id, ownerId, cardId, reviewedAt, [cardId+reviewedAt], syncedAt",
      schedules: "&cardId, due, state, updatedAt",
      outbox: "++seq, &operationId, table, recordId, status, createdAt",
      settings: "&key, ownerId, updatedAt",
    });
  }
}

export const db = new StudyDatabase();

export function nowIso(): string {
  return new Date().toISOString();
}

export function uuid(): string {
  return crypto.randomUUID();
}

export async function enqueue(
  table: SyncTable,
  recordId: string,
  operation: OutboxRecord["operation"],
  payload: Record<string, unknown>,
): Promise<void> {
  await db.outbox.add({
    operationId: uuid(),
    table,
    recordId,
    operation,
    payload,
    createdAt: nowIso(),
    attempts: 0,
    status: "pending",
    lastError: null,
  });
}

export async function saveCard(card: StudyCard, queue = true): Promise<void> {
  await db.cards.put(card);
  if (queue && !card.builtIn) {
    await enqueue("cards", card.id, card.deletedAt ? "delete" : "upsert", card as unknown as Record<string, unknown>);
  }
}

export async function saveDeck(deck: Deck, queue = true): Promise<void> {
  await db.decks.put(deck);
  if (queue) await enqueue("decks", deck.id, deck.deletedAt ? "delete" : "upsert", deck as unknown as Record<string, unknown>);
}

export async function saveSetting(setting: SettingRecord, queue = true): Promise<void> {
  await db.settings.put(setting);
  if (queue) await enqueue("settings", setting.key, "upsert", setting as unknown as Record<string, unknown>);
}

export async function getDeviceId(): Promise<string> {
  const existing = await db.settings.get("deviceId");
  if (typeof existing?.value === "string") return existing.value;
  const value = uuid();
  await saveSetting({ key: "deviceId", ownerId: null, value, updatedAt: nowIso() }, false);
  return value;
}
