import { getCachedAccountState } from "./account-auth";
import { supabase } from "./backend";
import { getDeviceId } from "./db";

const NAME_KEY = "account_public_name_v1";
const OPTIN_KEY = "account_leaderboard_optin_v1";
const LEGACY_MIGRATED_KEY = "account_public_profile_migrated_v1";
const LEGACY_NAME_KEYS = ["lb_name_v1", "cm_name_v1"];
const LEGACY_OPTIN_KEY = "lb_optin_v1";
const MAX_NAME = 24;

function scopedKey(base: string): string {
  const userId = getCachedAccountState().userId;
  return userId ? `${base}:${userId}` : base;
}

function read(key: string): string {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
}

function write(key: string, value: string | null): void {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* noop */ }
}

export function cleanPublicName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, MAX_NAME);
}

function legacyName(): string {
  for (const key of LEGACY_NAME_KEYS) {
    const value = cleanPublicName(read(key));
    if (value) return value;
  }
  return "";
}

export function getPublicName(): string {
  const own = cleanPublicName(read(scopedKey(NAME_KEY)));
  if (getCachedAccountState().userId) return own;
  return own || legacyName();
}

export function setPublicNameLocal(raw: string): string {
  const name = cleanPublicName(raw);
  if (!name) return "";
  write(scopedKey(NAME_KEY), name);
  // 旧画面・ログアウト中の互換表示にも同じ名前を反映する。
  for (const key of LEGACY_NAME_KEYS) write(key, name);
  return name;
}

export function getLeaderboardOptIn(): boolean {
  const scoped = read(scopedKey(OPTIN_KEY));
  if (scoped) return scoped === "1";
  if (getCachedAccountState().userId && read(LEGACY_MIGRATED_KEY) === "1") return false;
  return read(LEGACY_OPTIN_KEY) === "1";
}

export function setLeaderboardOptInLocal(enabled: boolean): void {
  write(scopedKey(OPTIN_KEY), enabled ? "1" : "0");
  write(LEGACY_OPTIN_KEY, enabled ? "1" : null);
}

function firstRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return (data[0] as Record<string, unknown> | undefined) ?? null;
  return data && typeof data === "object" ? data as Record<string, unknown> : null;
}

/**
 * 現在の端末IDで作られた旧ランキング・投稿をログイン中のアカウントへ引き取り、
 * アカウント共通の表示名とランキング参加状態をこの端末へ反映する。
 */
export async function syncAccountIdentity(fallbackName = ""): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "アカウント同期は現在利用できません" };
  const deviceId = await getDeviceId();
  const legacy = read(LEGACY_MIGRATED_KEY) === "1" ? "" : legacyName();
  const preferredName = getPublicName() || legacy || cleanPublicName(fallbackName);
  const { data, error } = await supabase.rpc("account_identity_sync", {
    p_device_id: deviceId,
    p_name: preferredName || null,
    p_leaderboard_opt_in: getLeaderboardOptIn(),
  });
  if (error) return { ok: false, error: error.message };
  const row = firstRow(data);
  if (row) {
    const name = cleanPublicName(String(row.display_name ?? ""));
    if (name) setPublicNameLocal(name);
    setLeaderboardOptInLocal(Boolean(row.leaderboard_opt_in));
    write(LEGACY_MIGRATED_KEY, "1");
  }
  return { ok: true };
}

export async function savePublicName(raw: string): Promise<string> {
  const name = setPublicNameLocal(raw);
  if (!name) throw new Error("名前を入力してください");
  if (!supabase) return name;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return name;
  const { error } = await supabase.rpc("account_profile_set_name", { p_name: name });
  if (error) throw error;
  return name;
}
