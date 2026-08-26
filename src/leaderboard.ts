import { getDeviceId } from "./db";
import { supabase } from "./backend";
import {
  cleanPublicName,
  getLeaderboardOptIn,
  getPublicName,
  savePublicName,
  setLeaderboardOptInLocal,
} from "./account-profile";

// ゲストは端末ID、ログイン中はGoogleアカウントで識別する公開ランキング。
// アカウント利用時の名前・参加状態は全端末で共通になる。


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
  return getPublicName();
}

export function hasJoined(): boolean {
  return getLeaderboardOptIn() && getSavedName().length > 0;
}

export function cleanName(raw: string): string {
  return cleanPublicName(raw);
}

// ランキングは科目ごとに分かれている。呼び出し側から現在の科目idを渡す。
const DEFAULT_SUBJECT = "metabolism";
function normSubject(subject?: string | null): string {
  const s = (subject ?? "").trim();
  return s.length ? s.slice(0, 48) : DEFAULT_SUBJECT;
}

// 名前を保存して参加登録し、現在の解答数を送信する。
export async function joinLeaderboard(rawName: string, solved: number, subject?: string, deviceSolved = solved): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "ランキングは現在利用できません" };
  const name = cleanName(rawName);
  if (name.length < 1) return { ok: false, error: "名前を入力してください" };
  try {
    await savePublicName(name);
    setLeaderboardOptInLocal(true);
    await sendScore(name, solved, subject, deviceSolved);
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
  argsWithDeviceCount: Record<string, unknown>,
  argsWithSubject: Record<string, unknown>,
  argsWithoutSubject: Record<string, unknown>,
): Promise<unknown> {
  if (!supabase) return null;
  const first = await supabase.rpc(fn, argsWithDeviceCount);
  if (!first.error) return first.data;
  if (!isMissingFunction(first.error)) throw first.error;
  const second = await supabase.rpc(fn, argsWithSubject);
  if (!second.error) return second.data;
  if (!isMissingFunction(second.error)) throw second.error;
  const third = await supabase.rpc(fn, argsWithoutSubject);
  if (third.error) throw third.error;
  return third.data;
}

async function sendScore(name: string, solved: number, subject?: string, deviceSolved = solved): Promise<void> {
  if (!supabase) return;
  const deviceId = await getDeviceId();
  const base = { p_device_id: deviceId, p_name: name, p_solved: Math.max(0, Math.floor(solved)) };
  const withSubject = { ...base, p_subject: normSubject(subject) };
  await rpcWithSubjectFallback(
    "publish_score",
    { ...withSubject, p_device_solved: Math.max(0, Math.floor(deviceSolved)) },
    withSubject,
    base,
  );
}

let lastPublish = 0;
let lastSubject: string | undefined;

// 演習中に随時呼ぶ。参加済みかつオンラインのときだけ、最短30秒間隔で送信する。
export async function publishScore(solved: number, force = false, subject?: string, deviceSolved = solved): Promise<void> {
  if (!supabase || !hasJoined()) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const now = Date.now();
  // 科目を切り替えた直後は間隔をおかずに送る（別科目のスコアなので待つ意味がない）
  if (!force && subject === lastSubject && now - lastPublish < 30_000) return;
  lastPublish = now; lastSubject = subject;
  try {
    await sendScore(getSavedName(), solved, subject, deviceSolved);
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
      { p_device_id: deviceId, p_subject },
      { p_device_id: deviceId },
    ).catch(() => null);
    const row = Array.isArray(mr) ? (mr[0] as Record<string, unknown> | undefined) : null;
    if (row) return { rows, myRank: Number(row.rank), mySolved: Number(row.solved_count), inTop: false };
  }
  return { rows, myRank: null, mySolved: null, inTop: false };
}

export async function leaveLeaderboard(): Promise<void> {
  setLeaderboardOptInLocal(false);
  if (!supabase) return;
  const deviceId = await getDeviceId();
  await supabase.rpc("remove_score", { p_device_id: deviceId });
}
