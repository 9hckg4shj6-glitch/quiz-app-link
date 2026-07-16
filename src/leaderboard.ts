import { getDeviceId } from "./db";
import { supabase } from "./sync";

// 公開ランキング（グローバル1本）。端末ごとの device_id で識別し、名前は表示ラベル。
// アクセスはすべて security definer の RPC 経由（supabase/migrations/002_leaderboard.sql）。

const NAME_KEY = "lb_name_v1";
const OPTIN_KEY = "lb_optin_v1";
const MAX_NAME = 24;

export interface RankRow {
  rank: number;
  name: string;
  solved: number;
  you: boolean;
}

export interface LeaderboardView {
  rows: RankRow[];
  myRank: number | null;
  mySolved: number | null;
  inTop: boolean;
}

export function leaderboardEnabled(): boolean {
  return Boolean(supabase);
}

export function getSavedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function hasJoined(): boolean {
  try {
    return localStorage.getItem(OPTIN_KEY) === "1" && getSavedName().length > 0;
  } catch {
    return false;
  }
}

export function cleanName(raw: string): string {
  // 制御文字を除去してトリム、24文字まで。漢字・かなはそのまま許可。
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, MAX_NAME);
}

// 名前を保存して参加登録し、現在の解答数を送信する。
export async function joinLeaderboard(rawName: string, solved: number): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "ランキングは現在利用できません" };
  const name = cleanName(rawName);
  if (name.length < 1) return { ok: false, error: "名前を入力してください" };
  try {
    localStorage.setItem(NAME_KEY, name);
    localStorage.setItem(OPTIN_KEY, "1");
  } catch {
    /* localStorage 不可でも送信は試みる */
  }
  try {
    await sendScore(name, solved);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function sendScore(name: string, solved: number): Promise<void> {
  if (!supabase) return;
  const deviceId = await getDeviceId();
  const { error } = await supabase.rpc("publish_score", {
    p_device_id: deviceId,
    p_name: name,
    p_solved: Math.max(0, Math.floor(solved)),
  });
  if (error) throw error;
}

let lastPublish = 0;

// 演習中に随時呼ぶ。参加済みかつオンラインのときだけ、最短30秒間隔で送信する。
export async function publishScore(solved: number, force = false): Promise<void> {
  if (!supabase || !hasJoined()) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const now = Date.now();
  if (!force && now - lastPublish < 30_000) return;
  lastPublish = now;
  try {
    await sendScore(getSavedName(), solved);
  } catch {
    lastPublish = 0; // 失敗時は次回すぐ再試行できるように
  }
}

export async function fetchLeaderboard(): Promise<LeaderboardView | null> {
  if (!supabase) return null;
  const deviceId = await getDeviceId();
  const { data, error } = await supabase.rpc("get_leaderboard", { p_device_id: deviceId });
  if (error) throw error;
  const rows: RankRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    rank: Number(r.rank),
    name: String(r.display_name),
    solved: Number(r.solved_count),
    you: Boolean(r.is_you),
  }));
  const mine = rows.find((r) => r.you);
  if (mine) {
    return { rows, myRank: mine.rank, mySolved: mine.solved, inTop: true };
  }
  if (hasJoined()) {
    const { data: mr } = await supabase.rpc("get_my_rank", { p_device_id: deviceId });
    const row = Array.isArray(mr) ? (mr[0] as Record<string, unknown> | undefined) : null;
    if (row) return { rows, myRank: Number(row.rank), mySolved: Number(row.solved_count), inTop: false };
  }
  return { rows, myRank: null, mySolved: null, inTop: false };
}

export async function leaveLeaderboard(): Promise<void> {
  try {
    localStorage.removeItem(OPTIN_KEY);
  } catch {
    /* noop */
  }
  if (!supabase) return;
  const deviceId = await getDeviceId();
  await supabase.rpc("remove_score", { p_device_id: deviceId });
}
