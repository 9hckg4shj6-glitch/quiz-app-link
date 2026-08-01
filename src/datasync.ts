import { supabase } from "./backend";

// 端末間データ同期（同期コード方式）。
// 統合は index.html 側の mergeProgress/mergeMeta（最大値・和集合）で行うため、
// pull → merge → push の順に動かせばどちらの端末の記録も失われない。
// アクセスはすべて security definer の RPC 経由（supabase/migrations/006_sync.sql）。

const CODE_KEY = "sync_code_v1";
const LAST_KEY = "sync_last_v1";

export const NOT_READY = "NOT_READY";

export type SyncPayload = Record<string, unknown>;

function rpcError(error: { code?: string; message?: string }): Error {
  const message = error.message ?? "";
  if (error.code === "PGRST202" || /Could not find the function/i.test(message)) {
    return new Error(NOT_READY);
  }
  if (/SYNC_CODE_CLAIMED/i.test(message)) return new Error("この同期コードは別のアカウントへ移行済みです");
  if (/SYNC_CODE_RETIRED/i.test(message)) return new Error("この同期コードはアカウントへ移行済みです。ログインしてください");
  if (/AUTH_REQUIRED/i.test(message)) return new Error("ログインが必要です");
  return new Error(message || "通信に失敗しました");
}

export function syncEnabled(): boolean {
  return Boolean(supabase);
}

export function getSyncCode(): string {
  try {
    return localStorage.getItem(CODE_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeCode(code: string): void {
  try {
    localStorage.setItem(CODE_KEY, code);
  } catch {
    /* noop */
  }
}

export function isLinked(): boolean {
  return getSyncCode().length > 0;
}

export function getLastSyncedAt(): string {
  try {
    return localStorage.getItem(LAST_KEY) ?? "";
  } catch {
    return "";
  }
}

function markSynced(): void {
  try {
    localStorage.setItem(LAST_KEY, new Date().toISOString());
  } catch {
    /* noop */
  }
}

// 入力ゆれ（小文字・ハイフン・空白）を吸収する
export function normalizeCode(raw: string): string {
  return (raw || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

// 表示用に 5文字ずつ区切る（ABCDE-FGHIJ）
export function formatCode(code: string): string {
  const c = normalizeCode(code);
  return c.length > 5 ? `${c.slice(0, 5)}-${c.slice(5)}` : c;
}

export function unlink(): void {
  try {
    localStorage.removeItem(CODE_KEY);
    localStorage.removeItem(LAST_KEY);
  } catch {
    /* noop */
  }
}

// この端末で同期を開始し、新しいコードを発行する
export async function createCode(payload: SyncPayload): Promise<{ ok: boolean; code?: string; error?: string }> {
  if (!supabase) return { ok: false, error: "同期は現在利用できません" };
  const { data, error } = await supabase.rpc("sync_create", { p_payload: payload });
  if (error) return { ok: false, error: rpcError(error).message };
  const code = String(data);
  storeCode(code);
  markSynced();
  return { ok: true, code };
}

export async function pull(code: string): Promise<{ ok: boolean; payload?: SyncPayload; error?: string }> {
  if (!supabase) return { ok: false, error: "同期は現在利用できません" };
  const { data, error } = await supabase.rpc("sync_pull", { p_key: normalizeCode(code) });
  if (error) return { ok: false, error: rpcError(error).message };
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return { ok: false, error: "この同期コードは見つかりません" };
  return { ok: true, payload: (row.payload ?? {}) as SyncPayload };
}

export async function push(code: string, payload: SyncPayload): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "同期は現在利用できません" };
  const { error } = await supabase.rpc("sync_push", { p_key: normalizeCode(code), p_payload: payload });
  if (error) return { ok: false, error: rpcError(error).message };
  markSynced();
  return { ok: true };
}

// 別端末のコードにこの端末をつなぐ。中身の統合は呼び出し側が行う。
export async function link(code: string): Promise<{ ok: boolean; payload?: SyncPayload; error?: string }> {
  const normalized = normalizeCode(code);
  if (normalized.length < 10) return { ok: false, error: "同期コードは10文字です" };
  const result = await pull(normalized);
  if (!result.ok) return result;
  storeCode(normalized);
  markSynced();
  return result;
}

export async function deleteRemote(code: string): Promise<void> {
  if (!supabase) return;
  await supabase.rpc("sync_delete", { p_key: normalizeCode(code) });
  await supabase.rpc("sync_written_attempts_delete_all", { p_key: normalizeCode(code) });
}

/* ============================================================
   記述問題の答案履歴の差分同期（仕様書 §11.4）
   ------------------------------------------------------------
   1MBスナップショット（sync_data.payload）とは別の行として持ち、
   (server_updated_at, attempt_id) のカーソルで差分だけを往復させる。
   採点済み（graded）だけを送り、draft と未採点の submitted は送らない。
   ============================================================ */

const PUSH_LIMIT = 100;
const PUSH_BYTES = 512 * 1024;

export interface WrittenCursor {
  after: string | null;
  afterId: string | null;
}

function cursorKey(code: string): string {
  // 同期コードごとにカーソルを分ける。コードを変えたら最初から取り直す
  return `sync_written_cursor_${normalizeCode(code)}`;
}

export function getWrittenCursor(code: string): WrittenCursor {
  try {
    const raw = localStorage.getItem(cursorKey(code));
    if (!raw) return { after: null, afterId: null };
    const parsed = JSON.parse(raw) as Partial<WrittenCursor>;
    return { after: parsed.after ?? null, afterId: parsed.afterId ?? null };
  } catch {
    return { after: null, afterId: null };
  }
}

export function setWrittenCursor(code: string, cursor: WrittenCursor): void {
  try {
    localStorage.setItem(cursorKey(code), JSON.stringify(cursor));
  } catch {
    /* noop */
  }
}

export async function pullWrittenAttempts(
  code: string,
  cursor: WrittenCursor,
  limit = 100,
): Promise<{ ok: boolean; rows?: unknown[]; cursor?: WrittenCursor; error?: string }> {
  if (!supabase) return { ok: false, error: "同期は現在利用できません" };
  const { data, error } = await supabase.rpc("sync_written_attempts_pull", {
    p_key: normalizeCode(code),
    p_after: cursor.after,
    p_after_id: cursor.afterId,
    p_limit: limit,
  });
  if (error) return { ok: false, error: rpcError(error).message };
  const list = Array.isArray(data) ? data : [];
  const rows = list.map((row) => (row as { payload?: unknown }).payload);
  const last = list[list.length - 1] as { server_updated_at?: string; attempt_id?: string } | undefined;
  return {
    ok: true,
    rows,
    cursor: last
      ? { after: last.server_updated_at ?? cursor.after, afterId: last.attempt_id ?? cursor.afterId }
      : cursor,
  };
}

/** 100件・512KB以下に分けて送る。成功した attempt の id を返す */
export async function pushWrittenAttempts(
  code: string,
  attempts: Array<Record<string, unknown>>,
): Promise<{ ok: boolean; sentIds: string[]; error?: string }> {
  if (!supabase) return { ok: false, sentIds: [], error: "同期は現在利用できません" };
  const sentIds: string[] = [];
  let batch: Array<Record<string, unknown>> = [];
  let bytes = 0;

  const flush = async (): Promise<string | null> => {
    if (!batch.length) return null;
    const { error } = await supabase!.rpc("sync_written_attempts_push", {
      p_key: normalizeCode(code),
      p_attempts: batch,
    });
    if (error) return rpcError(error).message;
    for (const row of batch) sentIds.push(String(row.id));
    batch = [];
    bytes = 0;
    return null;
  };

  for (const attempt of attempts) {
    const size = JSON.stringify(attempt).length;
    // 1件だけで上限を超える答案（巨大な描画）は送らずに飛ばす。次回も同じ判定になる
    if (size > PUSH_BYTES) continue;
    if (batch.length >= PUSH_LIMIT || bytes + size > PUSH_BYTES) {
      const failed = await flush();
      if (failed) return { ok: false, sentIds, error: failed };
    }
    batch.push(attempt);
    bytes += size;
  }
  const failed = await flush();
  if (failed) return { ok: false, sentIds, error: failed };
  markSynced();
  return { ok: true, sentIds };
}

/* ============================================================
   アカウント単位の学習記録同期
   ============================================================ */

export interface AccountSnapshot {
  payload: SyncPayload;
  version: number;
  updatedAt: string | null;
}

export async function pullAccountSnapshot(): Promise<{ ok: boolean; snapshot?: AccountSnapshot; error?: string }> {
  if (!supabase) return { ok: false, error: "同期は現在利用できません" };
  const { data, error } = await supabase.rpc("account_sync_pull");
  if (error) return { ok: false, error: rpcError(error).message };
  const row = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined;
  return {
    ok: true,
    snapshot: row
      ? {
          payload: (row.payload ?? {}) as SyncPayload,
          version: Number(row.version ?? 0),
          updatedAt: row.updated_at == null ? null : String(row.updated_at),
        }
      : { payload: {}, version: 0, updatedAt: null },
  };
}

export async function pushAccountSnapshot(
  payload: SyncPayload,
  expectedVersion: number,
): Promise<{ ok: boolean; version?: number; conflict?: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "同期は現在利用できません" };
  const { data, error } = await supabase.rpc("account_sync_push", {
    p_payload: payload,
    p_expected_version: expectedVersion,
  });
  if (error) return { ok: false, error: rpcError(error).message };
  const row = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined;
  if (!row) return { ok: false, error: "同期結果を確認できませんでした" };
  if (Boolean(row.ok)) markSynced();
  return {
    ok: Boolean(row.ok),
    version: Number(row.version ?? expectedVersion),
    conflict: Boolean(row.conflict),
    error: row.conflict ? "別の端末で更新されたため再統合します" : undefined,
  };
}

export async function claimSyncCode(
  code: string,
): Promise<{ ok: boolean; payload?: SyncPayload; retired?: boolean; missing?: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "同期は現在利用できません" };
  const { data, error } = await supabase.rpc("claim_sync_code", { p_key: normalizeCode(code) });
  if (error) return { ok: false, error: rpcError(error).message };
  const row = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined;
  // 端末にコードだけが残り、サーバー行が既に存在しない場合がある。
  // この状態はアカウント同期を永久に止めてはいけないため、呼び出し側が
  // 古いローカルコードを破棄して通常のアカウント同期へ進めるよう明示する。
  if (!row) return { ok: false, missing: true, error: "この同期コードは見つかりません" };
  return { ok: true, payload: (row.payload ?? {}) as SyncPayload, retired: Boolean(row.retired) };
}

export async function completeSyncCodeMigration(code: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "同期は現在利用できません" };
  const { error } = await supabase.rpc("complete_sync_code_migration", { p_key: normalizeCode(code) });
  if (error) return { ok: false, error: rpcError(error).message };
  markSynced();
  return { ok: true };
}

function accountCursorKey(userId: string): string {
  return `account_written_cursor_${userId}`;
}

export function getAccountWrittenCursor(userId: string): WrittenCursor {
  try {
    const raw = localStorage.getItem(accountCursorKey(userId));
    if (!raw) return { after: null, afterId: null };
    const value = JSON.parse(raw) as Partial<WrittenCursor>;
    return { after: value.after ?? null, afterId: value.afterId ?? null };
  } catch { return { after: null, afterId: null }; }
}

export function setAccountWrittenCursor(userId: string, cursor: WrittenCursor): void {
  try { localStorage.setItem(accountCursorKey(userId), JSON.stringify(cursor)); } catch { /* noop */ }
}

export async function pullAccountWrittenAttempts(
  cursor: WrittenCursor,
  limit = 100,
): Promise<{ ok: boolean; rows?: unknown[]; cursor?: WrittenCursor; error?: string }> {
  if (!supabase) return { ok: false, error: "同期は現在利用できません" };
  const { data, error } = await supabase.rpc("account_written_attempts_pull", {
    p_after: cursor.after,
    p_after_id: cursor.afterId,
    p_limit: limit,
  });
  if (error) return { ok: false, error: rpcError(error).message };
  const list = Array.isArray(data) ? data : [];
  const rows = list.map((row) => (row as { payload?: unknown }).payload);
  const last = list[list.length - 1] as { server_updated_at?: string; attempt_id?: string } | undefined;
  return {
    ok: true,
    rows,
    cursor: last
      ? { after: last.server_updated_at ?? cursor.after, afterId: last.attempt_id ?? cursor.afterId }
      : cursor,
  };
}

export async function pushAccountWrittenAttempts(
  attempts: Array<Record<string, unknown>>,
): Promise<{ ok: boolean; sentIds: string[]; error?: string }> {
  if (!supabase) return { ok: false, sentIds: [], error: "同期は現在利用できません" };
  const sentIds: string[] = [];
  let batch: Array<Record<string, unknown>> = [];
  let bytes = 0;
  const flush = async (): Promise<string | null> => {
    if (!batch.length) return null;
    const { error } = await supabase!.rpc("account_written_attempts_push", { p_attempts: batch });
    if (error) return rpcError(error).message;
    for (const row of batch) sentIds.push(String(row.id));
    batch = [];
    bytes = 0;
    return null;
  };
  for (const attempt of attempts) {
    const size = JSON.stringify(attempt).length;
    if (size > PUSH_BYTES) continue;
    if (batch.length >= PUSH_LIMIT || bytes + size > PUSH_BYTES) {
      const failed = await flush();
      if (failed) return { ok: false, sentIds, error: failed };
    }
    batch.push(attempt);
    bytes += size;
  }
  const failed = await flush();
  if (failed) return { ok: false, sentIds, error: failed };
  markSynced();
  return { ok: true, sentIds };
}
