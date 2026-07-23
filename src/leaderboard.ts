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

// ランキングは科目ごとに分かれている。呼び出し側から現在の科目idを渡す。
const DEFAULT_SUBJECT = "metabolism";
function normSubject(subject?: string | null): string {
  const s = (subject ?? "").trim();
  return s.length ? s.slice(0, 48) : DEFAULT_SUBJECT;
}

// 名前を保存して参加登録し、現在の解答数を送信する。
export async function joinLeaderboard(rawName: string, solved: number, subject?: string): Promise<{ ok: boolean; error?: string }> {
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
    await sendScore(name, solved, subject);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/* サーバー側のマイグレーション（007_leaderboard_subject.sql）がまだ適用されていない環境では、
   p_subject を受け取るRPCが存在しない。その場合は科目なしの旧シグネチャで呼び直し、
   ランキングが「取得できません」になってしまうのを防ぐ。
   （旧RPCで動いている間は、全科目まとめた1本のランキングとして表示される） */
function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || /Could not find the function|does not exist/i.test(error.message ?? "");
}
async function rpcWithSubjectFallback(
  fn: string,
  argsWithSubject: Record<string, unknown>,
  argsWithoutSubject: Record<string, unknown>,
): Promise<unknown> {
  if (!supabase) return null;
  const first = await supabase.rpc(fn, argsWithSubject);
  if (!first.error) return first.data;
  if (!isMissingFunction(first.error)) throw first.error;
  const second = await supabase.rpc(fn, argsWithoutSubject);
  if (second.error) throw second.error;
  return second.data;
}

async function sendScore(name: string, solved: number, subject?: string): Promise<void> {
  if (!supabase) return;
  const deviceId = await getDeviceId();
  const base = { p_device_id: deviceId, p_name: name, p_solved: Math.max(0, Math.floor(solved)) };
  await rpcWithSubjectFallback("publish_score", { ...base, p_subject: normSubject(subject) }, base);
}

let lastPublish = 0;
let lastSubject: string | undefined;

// 演習中に随時呼ぶ。参加済みかつオンラインのときだけ、最短30秒間隔で送信する。
export async function publishScore(solved: number, force = false, subject?: string): Promise<void> {
  if (!supabase || !hasJoined()) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const now = Date.now();
  // 科目を切り替えた直後は間隔をおかずに送る（別科目のスコアなので待つ意味がない）
  if (!force && subject === lastSubject && now - lastPublish < 30_000) return;
  lastPublish = now; lastSubject = subject;
  try {
    await sendScore(getSavedName(), solved, subject);
  } catch {
    lastPublish = 0; // 失敗時は次回すぐ再試行できるように
  }
}

export async function fetchLeaderboard(subject?: string): Promise<LeaderboardView | null> {
  if (!supabase) return null;
  const deviceId = await getDeviceId();
  const p_subject = normSubject(subject);
  const data = await rpcWithSubjectFallback(
    "get_leaderboard",
    { p_device_id: deviceId, p_subject },
    { p_device_id: deviceId },
  );
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
    const mr = await rpcWithSubjectFallback(
      "get_my_rank",
      { p_device_id: deviceId, p_subject },
      { p_device_id: deviceId },
    ).catch(() => null);
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
