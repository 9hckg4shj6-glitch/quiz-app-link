import { supabase } from "./sync";

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
}
