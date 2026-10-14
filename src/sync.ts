import type { User } from "@supabase/supabase-js";
import { assessAccountBinding, clearLocalDataOwner, getLocalDataOwner } from "./account-auth";
import { supabase } from "./backend";
import { db, nowIso, saveCard, saveDeck, saveSetting, uuid } from "./db";
import { rebuildScheduleFromEvents } from "./fsrs";
import { clearPracticeSessions } from "./practice-session";
import type { OutboxRecord, StudyCard, SyncStatus } from "./types";

export { supabase } from "./backend";

async function currentUser(): Promise<User | null> {
  if (!supabase) return null;
  // getUser() は毎回認証サーバーへ問い合わせる。所有者の検証はRLSが行うので端末のセッションで足りる
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
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
    suspended_at: card.suspendedAt,
    origin_deck_id: card.originDeckId,
    origin_version: card.originVersion,
    origin_card_id: card.originCardId,
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
    suspendedAt: row.suspended_at == null ? null : String(row.suspended_at),
    originDeckId: row.origin_deck_id == null ? null : String(row.origin_deck_id),
    originVersion: row.origin_version == null ? null : Number(row.origin_version),
    originCardId: row.origin_card_id == null ? null : String(row.origin_card_id),
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
  // カードより先にデッキを送れるよう、所有者付与とoutbox追加もデッキから行う。
  const decks = await db.decks.filter((item) => !item.ownerId).toArray();
  for (const deck of decks) {
    await saveDeck({ ...deck, ownerId: userId, updatedAt: nowIso() });
  }
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

async function toRemoteRow(item: OutboxRecord, user: User): Promise<Record<string, unknown>> {
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
      card_system: payload.system, subject_id: payload.subjectId,
      origin_shared_deck_id: payload.originSharedDeckId, origin_version: payload.originVersion,
      sort_order: payload.order, new_cards_per_day: payload.newCardsPerDay,
      reviews_per_day: payload.reviewsPerDay, desired_retention: payload.desiredRetention,
      version: payload.version, created_at: payload.createdAt,
      updated_at: payload.updatedAt, deleted_at: payload.deletedAt,
    };
  }
  return payload;
}

function isReviewDelete(item: OutboxRecord): boolean {
  return item.table === "review_events" && item.operation === "delete";
}

const PUSH_CHUNK = 500;

/** 未送信の変更をテーブルごとにまとめて送る。まとめ送りが失敗したときだけ1件ずつ送り直して原因を切り分ける。 */
async function pushOutbox(user: User): Promise<void> {
  if (!supabase) return;
  const client = supabase;
  const pending = (await db.outbox.where("status").anyOf("pending", "failed").sortBy("createdAt"))
    .filter((item) => item.seq != null);
  if (!pending.length) return;
  await db.outbox.where("seq").anyOf(pending.map((item) => item.seq!)).modify((item) => {
    item.status = "syncing"; item.attempts += 1; item.lastError = null;
  });

  // カードより先にデッキを送る
  for (const table of ["decks", "cards", "review_events", "settings"] as const) {
    const items = pending.filter((item) => item.table === table);
    if (!items.length) continue;
    // どの操作もレコード全体の上書きなので、同じレコードは最新の1件だけ送れば足りる
    const latest = [...new Map(items.map((item) => [item.recordId, item])).values()];
    const sent = new Set<string>();
    const failed = new Map<string, string>();
    const fail = (item: OutboxRecord, error: unknown) =>
      failed.set(item.recordId, error instanceof Error ? error.message : String(error));

    const sendOne = async (item: OutboxRecord) => {
      try {
        const { error } = isReviewDelete(item)
          ? await client.from("review_events").delete().eq("id", item.recordId).eq("owner_id", user.id)
          : await client.from(table).upsert(await toRemoteRow(item, user), { onConflict: table === "settings" ? "owner_id,key" : "id" });
        if (error) throw error;
        sent.add(item.recordId);
      } catch (error) {
        fail(item, error);
      }
    };

    const deletes = latest.filter(isReviewDelete);
    const upserts = latest.filter((item) => !isReviewDelete(item));
    for (let i = 0; i < upserts.length; i += PUSH_CHUNK) {
      const chunk = upserts.slice(i, i + PUSH_CHUNK);
      const rows: Record<string, unknown>[] = [];
      const ready: OutboxRecord[] = [];
      await Promise.all(chunk.map(async (item) => {
        try { rows.push(await toRemoteRow(item, user)); ready.push(item); } catch (error) { fail(item, error); }
      }));
      if (!rows.length) continue;
      const { error } = await client.from(table).upsert(rows, { onConflict: table === "settings" ? "owner_id,key" : "id" });
      if (error) { for (const item of ready) await sendOne(item); } else ready.forEach((item) => sent.add(item.recordId));
    }
    for (let i = 0; i < deletes.length; i += PUSH_CHUNK) {
      const chunk = deletes.slice(i, i + PUSH_CHUNK);
      const { error } = await client.from("review_events").delete()
        .in("id", chunk.map((item) => item.recordId)).eq("owner_id", user.id);
      if (error) { for (const item of chunk) await sendOne(item); } else chunk.forEach((item) => sent.add(item.recordId));
    }

    const done = items.filter((item) => sent.has(item.recordId));
    await db.outbox.bulkDelete(done.map((item) => item.seq!));
    for (const item of items.filter((entry) => !sent.has(entry.recordId))) {
      await db.outbox.update(item.seq!, { status: "failed", lastError: failed.get(item.recordId) ?? "送信できませんでした" });
    }
    if (table === "review_events") {
      const syncedAt = nowIso();
      await db.reviewEvents.where("id").anyOf(done.filter((item) => !isReviewDelete(item)).map((item) => item.recordId))
        .modify({ ownerId: user.id, syncedAt });
    }
  }
}

async function pullCards(user: User): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase.from("cards").select("*").eq("owner_id", user.id);
  if (error) throw error;
  const remotes = (data ?? []).map((row) => remoteToCard(row as Record<string, unknown>));
  const ids = remotes.map((card) => card.id);
  const locals = await db.cards.bulkGet(ids);
  const pendingIds = new Set((await db.outbox.where("recordId").anyOf(ids).filter((item) => item.status !== "syncing").toArray())
    .map((item) => item.recordId));
  // DBの時刻表記（+00:00）と端末の表記（Z）が違うので時刻値で比べる
  const sameTime = (a: string, b: string) => Date.parse(a) === Date.parse(b);
  for (const [index, fetched] of remotes.entries()) {
    const local = locals[index];
    // 変化のないカードは画像の再ダウンロードも保存もしない（取り込み済みの画像はdata URL）
    if (local && local.version === fetched.version && sameTime(local.updatedAt, fetched.updatedAt)
      && (!local.image || local.image.startsWith("data:") || local.image.startsWith("http"))) continue;
    const remote = await hydrateRemoteImage(fetched);
    if (local && pendingIds.has(remote.id) && !sameTime(local.updatedAt, remote.updatedAt) && local.version >= remote.version) {
      await saveCard({ ...remote, id: uuid(), front: `${remote.front}（競合コピー）`, version: 1, createdAt: nowIso(), updatedAt: nowIso() }, false);
      continue;
    }
    if (!local || remote.version >= local.version) await saveCard(remote, false);
  }
}

const REVIEW_CURSOR_KEY = "reviewEventsPulledAt";
const REVIEW_PAGE = 1000;

/** 前回取り込んだ位置より後にサーバーへ届いた復習履歴だけを、1000件ずつ全件取る。 */
async function pullNewReviewEvents(user: User): Promise<Record<string, unknown>[]> {
  if (!supabase) return [];
  const cursor = await db.settings.get(REVIEW_CURSOR_KEY);
  // 送信が遅れてコミットされた行を取りこぼさないよう、10分さかのぼって取り直す（既知の行は捨てる）
  const since = typeof cursor?.value === "string" ? new Date(Date.parse(cursor.value) - 10 * 60_000).toISOString() : null;
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += REVIEW_PAGE) {
    let query = supabase.from("review_events").select("*").eq("owner_id", user.id);
    if (since) query = query.gt("server_created_at", since);
    const { data, error } = await query.order("server_created_at").order("id").range(from, from + REVIEW_PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < REVIEW_PAGE) return rows;
  }
}

async function pullSupportingData(user: User): Promise<void> {
  if (!supabase) return;
  const [decksResult, reviewRows, settingsResult] = await Promise.all([
    supabase.from("decks").select("*").eq("owner_id", user.id),
    pullNewReviewEvents(user),
    supabase.from("settings").select("*").eq("owner_id", user.id),
  ]);
  if (decksResult.error) throw decksResult.error;
  if (settingsResult.error) throw settingsResult.error;

  await db.decks.bulkPut((decksResult.data ?? []).map((row) => ({
    id: String(row.id), ownerId: user.id, name: String(row.name), description: String(row.description ?? ""),
    system: row.card_system === "memory" ? "memory" as const : "legacy" as const,
    subjectId: row.subject_id == null ? "metabolism" : String(row.subject_id),
    originSharedDeckId: row.origin_shared_deck_id == null ? null : String(row.origin_shared_deck_id),
    originVersion: row.origin_version == null ? null : Number(row.origin_version),
    order: Number(row.sort_order ?? 0), newCardsPerDay: Number(row.new_cards_per_day ?? 20),
    reviewsPerDay: Number(row.reviews_per_day ?? 200), desiredRetention: Number(row.desired_retention ?? 0.9),
    version: Number(row.version ?? 1), createdAt: String(row.created_at),
    updatedAt: String(row.updated_at), deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
  })));

  const known = await db.reviewEvents.bulkGet(reviewRows.map((row) => String(row.id)));
  const added = reviewRows.filter((_, index) => !known[index]).map((row) => ({
    id: String(row.id), ownerId: user.id, cardId: String(row.card_id), deviceId: String(row.device_id),
    rating: Number(row.rating) as 1 | 2 | 3 | 4, reviewedAt: String(row.reviewed_at),
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms), syncedAt: nowIso(),
  }));
  await db.reviewEvents.bulkPut(added);
  for (const cardId of new Set(added.map((event) => event.cardId))) await rebuildScheduleFromEvents(cardId);
  const newest = reviewRows.at(-1);
  if (newest) await saveSetting({ key: REVIEW_CURSOR_KEY, ownerId: user.id, value: String(newest.server_created_at), updatedAt: nowIso() }, false);

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
  if (!user) return getSyncStatus("同期するにはログインが必要です");
  const binding = assessAccountBinding(user.id);
  if (binding === "conflict") return getSyncStatus("別のアカウントの端末データがあるため同期を停止しました");
  if (binding === "unbound") return getSyncStatus("アカウント同期を初期化しています");

  try {
    await attachOwner(user.id);
    await pushOutbox(user);
    await Promise.all([pullCards(user), pullSupportingData(user)]);
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
  await releaseLocalDataToGuest();
}

/** 別アカウントへ切り替える直前に、非公開の学習データだけを端末から除去する。 */
export async function clearPrivateStudyDataForAccountSwitch(): Promise<void> {
  await clearPracticeSessions();
  const device = await db.settings.get("deviceId");
  await db.transaction(
    "rw",
    [db.cards, db.decks, db.reviewEvents, db.schedules, db.outbox, db.settings, db.writtenAttempts, db.writtenDrafts],
    async () => {
      await db.cards.filter((card) => !card.builtIn).delete();
      await Promise.all([
        db.decks.clear(), db.reviewEvents.clear(), db.schedules.clear(), db.outbox.clear(),
        db.settings.clear(), db.writtenAttempts.clear(), db.writtenDrafts.clear(),
      ]);
      if (device) await db.settings.put(device);
    },
  );
}

/** 退会後はクラウド由来の印を外し、現在の端末データをゲストとして使い続けられるようにする。 */
export async function releaseLocalDataToGuest(): Promise<void> {
  await db.transaction(
    "rw",
    [db.cards, db.decks, db.reviewEvents, db.settings, db.outbox, db.writtenAttempts],
    async () => {
      await db.cards.filter((card) => !card.builtIn).modify({ ownerId: null });
      await db.decks.toCollection().modify({ ownerId: null });
      await db.reviewEvents.toCollection().modify((event) => { event.ownerId = null; event.syncedAt = null; });
      await db.settings.toCollection().modify({ ownerId: null });
      await db.writtenAttempts.toCollection().modify((attempt) => { attempt.syncedAt = null; });
      await db.outbox.clear();
    },
  );
  clearLocalDataOwner();
}

export function startAutomaticSync(): void {
  if (!supabase) return;
  window.addEventListener("online", () => void syncNow());
  supabase.auth.onAuthStateChange(() => {
    window.dispatchEvent(new Event("study:sync-changed"));
  });
  setInterval(() => {
    const owner = getLocalDataOwner();
    if (owner) void syncNow();
  }, 5 * 60 * 1000);
}
