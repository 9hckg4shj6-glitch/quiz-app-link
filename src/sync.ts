import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { db, nowIso, saveCard, saveSetting, uuid } from "./db";
import { rebuildScheduleFromEvents } from "./fsrs";
import type { OutboxRecord, StudyCard, SyncStatus } from "./types";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

async function currentUser(): Promise<User | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function getSyncStatus(error: string | null = null): Promise<SyncStatus> {
  const user = await currentUser();
  const last = await db.settings.get("lastSyncedAt");
  return {
    enabled: Boolean(supabase),
    online: navigator.onLine,
    userEmail: user?.email ?? null,
    pending: await db.outbox.where("status").anyOf("pending", "failed").count(),
    lastSyncedAt: typeof last?.value === "string" ? last.value : null,
    error,
  };
}

export async function requestOtp(email: string): Promise<void> {
  if (!supabase) throw new Error("Supabaseの環境変数が設定されていません");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${location.origin}${import.meta.env.BASE_URL}` },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

async function uploadCardImage(card: StudyCard, ownerId: string): Promise<string | null> {
  if (!supabase || !card.image?.startsWith("data:image/")) return card.image;
  const blob = await (await fetch(card.image)).blob();
  const path = `${ownerId}/${card.id}.webp`;
  const { error } = await supabase.storage.from("card-media").upload(path, blob, { contentType: "image/webp", upsert: true });
  if (error) throw error;
  return path;
}

async function cardPayload(card: StudyCard, ownerId: string): Promise<Record<string, unknown>> {
  return {
    id: card.id,
    owner_id: ownerId,
    kind: card.kind,
    deck_id: card.deckId,
    front: card.front,
    back: card.back,
    choices: card.choices,
    correct_choice_index: card.correctChoiceIndex,
    explanation: card.explanation,
    field: card.field,
    source: card.source,
    tags: card.tags,
    image: await uploadCardImage(card, ownerId),
    image_alt: card.imageAlt,
    version: card.version,
    created_at: card.createdAt,
    updated_at: card.updatedAt,
    deleted_at: card.deletedAt,
  };
}

function remoteToCard(row: Record<string, unknown>): StudyCard {
  return {
    id: String(row.id), ownerId: String(row.owner_id), builtIn: false,
    kind: row.kind as StudyCard["kind"], deckId: String(row.deck_id),
    front: String(row.front), back: String(row.back ?? ""),
    choices: Array.isArray(row.choices) ? row.choices.map(String) : [],
    correctChoiceIndex: row.correct_choice_index == null ? null : Number(row.correct_choice_index),
    explanation: String(row.explanation ?? ""), field: String(row.field ?? ""), source: String(row.source ?? ""),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [], image: row.image == null ? null : String(row.image),
    imageAlt: String(row.image_alt ?? ""), version: Number(row.version ?? 1),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
  };
}

async function hydrateRemoteImage(card: StudyCard): Promise<StudyCard> {
  if (!supabase || !card.image || card.image.startsWith("data:") || card.image.startsWith("http")) return card;
  const { data, error } = await supabase.storage.from("card-media").download(card.image);
  if (error) return card;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(data);
  });
  return { ...card, image: dataUrl };
}

async function attachOwner(userId: string): Promise<void> {
  const cards = await db.cards.filter((item) => !item.builtIn && !item.ownerId).toArray();
  for (const card of cards) {
    const next = { ...card, ownerId: userId, updatedAt: nowIso() };
    await db.cards.put(next);
    await db.outbox.add({
      operationId: uuid(), table: "cards", recordId: next.id, operation: "upsert",
      payload: next as unknown as Record<string, unknown>, createdAt: nowIso(), attempts: 0,
      status: "pending", lastError: null,
    });
  }
  await db.reviewEvents.filter((item) => !item.ownerId).modify({ ownerId: userId });
}

async function pushItem(item: OutboxRecord, user: User): Promise<void> {
  if (!supabase) return;
  if (item.table === "review_events" && item.operation === "delete") {
    const { error } = await supabase.from("review_events").delete().eq("id", item.recordId).eq("owner_id", user.id);
    if (error) throw error;
    return;
  }
  let payload = item.payload;
  if (item.table === "cards") payload = await cardPayload(payload as unknown as StudyCard, user.id);
  if (item.table === "review_events") {
    payload = {
      id: item.recordId, owner_id: user.id, card_id: payload.cardId,
      device_id: payload.deviceId, rating: payload.rating, reviewed_at: payload.reviewedAt,
      duration_ms: payload.durationMs,
    };
  }
  if (item.table === "settings") {
    payload = { owner_id: user.id, key: payload.key, value: payload.value, updated_at: payload.updatedAt };
  }
  if (item.table === "decks") {
    payload = {
      id: payload.id, owner_id: user.id, name: payload.name, description: payload.description,
      sort_order: payload.order, version: payload.version, created_at: payload.createdAt,
      updated_at: payload.updatedAt, deleted_at: payload.deletedAt,
    };
  }
  const { error } = await supabase.from(item.table).upsert(payload, { onConflict: item.table === "settings" ? "owner_id,key" : "id" });
  if (error) throw error;
}

async function pullCards(user: User): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase.from("cards").select("*").eq("owner_id", user.id);
  if (error) throw error;
  for (const row of data ?? []) {
    const remote = await hydrateRemoteImage(remoteToCard(row as Record<string, unknown>));
    const local = await db.cards.get(remote.id);
    const hasPending = (await db.outbox.where("recordId").equals(remote.id).filter((item) => item.status !== "syncing").count()) > 0;
    if (local && hasPending && local.updatedAt !== remote.updatedAt && local.version >= remote.version) {
      await saveCard({ ...remote, id: uuid(), front: `${remote.front}（競合コピー）`, version: 1, createdAt: nowIso(), updatedAt: nowIso() }, false);
      continue;
    }
    if (!local || remote.version >= local.version) await saveCard(remote, false);
  }
}

async function pullSupportingData(user: User): Promise<void> {
  if (!supabase) return;
  const [decksResult, reviewsResult, settingsResult] = await Promise.all([
    supabase.from("decks").select("*").eq("owner_id", user.id),
    supabase.from("review_events").select("*").eq("owner_id", user.id),
    supabase.from("settings").select("*").eq("owner_id", user.id),
  ]);
  if (decksResult.error) throw decksResult.error;
  if (reviewsResult.error) throw reviewsResult.error;
  if (settingsResult.error) throw settingsResult.error;

  await db.decks.bulkPut((decksResult.data ?? []).map((row) => ({
    id: String(row.id), ownerId: user.id, name: String(row.name), description: String(row.description ?? ""),
    order: Number(row.sort_order ?? 0), version: Number(row.version ?? 1), createdAt: String(row.created_at),
    updatedAt: String(row.updated_at), deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
  })));

  const changedCardIds = new Set<string>();
  for (const row of reviewsResult.data ?? []) {
    const id = String(row.id);
    if (await db.reviewEvents.get(id)) continue;
    const cardId = String(row.card_id);
    await db.reviewEvents.put({
      id, ownerId: user.id, cardId, deviceId: String(row.device_id),
      rating: Number(row.rating) as 1 | 2 | 3 | 4, reviewedAt: String(row.reviewed_at),
      durationMs: row.duration_ms == null ? null : Number(row.duration_ms), syncedAt: nowIso(),
    });
    changedCardIds.add(cardId);
  }
  for (const cardId of changedCardIds) await rebuildScheduleFromEvents(cardId);

  for (const row of settingsResult.data ?? []) {
    const remoteUpdatedAt = String(row.updated_at);
    const local = await db.settings.get(String(row.key));
    if (!local || remoteUpdatedAt > local.updatedAt) {
      await saveSetting({ key: String(row.key), ownerId: user.id, value: row.value, updatedAt: remoteUpdatedAt }, false);
    }
  }
}

export async function syncNow(): Promise<SyncStatus> {
  if (!supabase) return getSyncStatus("Supabaseの環境変数が未設定です");
  if (!navigator.onLine) return getSyncStatus("オフラインのため同期待ちです");
  const user = await currentUser();
  if (!user) return getSyncStatus("同期するにはメール認証が必要です");

  try {
    await attachOwner(user.id);
    const pending = await db.outbox.where("status").anyOf("pending", "failed").sortBy("createdAt");
    for (const item of pending) {
      if (item.seq == null) continue;
      await db.outbox.update(item.seq, { status: "syncing", attempts: item.attempts + 1, lastError: null });
      try {
        await pushItem(item, user);
        await db.outbox.delete(item.seq);
        if (item.table === "review_events") await db.reviewEvents.update(item.recordId, { ownerId: user.id, syncedAt: nowIso() });
      } catch (error) {
        await db.outbox.update(item.seq, { status: "failed", lastError: error instanceof Error ? error.message : String(error) });
      }
    }
    await pullCards(user);
    await pullSupportingData(user);
    await saveSetting({ key: "lastSyncedAt", ownerId: user.id, value: nowIso(), updatedAt: nowIso() }, false);
    window.dispatchEvent(new Event("study:sync-changed"));
    return getSyncStatus();
  } catch (error) {
    return getSyncStatus(error instanceof Error ? error.message : String(error));
  }
}

export async function deleteAccount(): Promise<void> {
  if (!supabase) throw new Error("Supabaseが設定されていません");
  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw error;
  await supabase.auth.signOut();
}

export function startAutomaticSync(): void {
  if (!supabase) return;
  window.addEventListener("online", () => void syncNow());
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN") void syncNow();
    window.dispatchEvent(new Event("study:sync-changed"));
  });
  setInterval(() => void syncNow(), 5 * 60 * 1000);
}
