import { getDeviceId } from "./db";
import { getSavedName as getRankName } from "./leaderboard";
import { supabase } from "./sync";

// コミュニティ（掲示板）。全公開・誰でも掲示板を作成できる。
// 識別は端末ごとの device_id。アクセスはすべて security definer の RPC 経由
// （supabase/migrations/003_community.sql）。

const NAME_KEY = "cm_name_v1";
const ADMIN_KEY = "cm_admin_v1";
const MAX_NAME = 24;

export interface BoardRow {
  id: string;
  title: string;
  description: string;
  author: string;
  postCount: number;
  lastPostAt: string;
  isMine: boolean;
}

export interface PostRow {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  isMine: boolean;
}

export function communityEnabled(): boolean {
  return Boolean(supabase);
}

// マイグレーション(003_community.sql)未適用でRPCが存在しない場合を、通信エラーと区別する。
// 呼び出し側はこれを見て「準備中」を表示する。
export const NOT_READY = "NOT_READY";

function rpcError(error: { code?: string; message?: string }): Error {
  const message = error.message ?? "";
  if (error.code === "PGRST202" || /Could not find the function/i.test(message)) {
    return new Error(NOT_READY);
  }
  return new Error(message || "通信に失敗しました");
}

export function cleanName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, MAX_NAME);
}

// コミュニティ名。未設定ならランキング登録名を初期値として使う（変更は独立して保存）。
export function getName(): string {
  try {
    const own = localStorage.getItem(NAME_KEY);
    if (own && own.length > 0) return own;
  } catch {
    /* noop */
  }
  return getRankName();
}

export function setName(raw: string): string {
  const name = cleanName(raw);
  if (name.length < 1) return "";
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* noop */
  }
  return name;
}

export function hasName(): boolean {
  return getName().length > 0;
}

/* ---------- 新着の検出 ----------
   掲示板ごとに「読んだ時点の投稿数」を控えておき、現在の投稿数との差を新着とする。
   list_boards が post_count を返すので、専用のRPCは要らない。 */

const SEEN_KEY = "cm_seen_v1"; // {boardId: 読んだ時点の投稿数}
const LAST_KEY = "cm_last_v1"; // {boardId: 直近に取得した投稿数}

function readMap(key: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(key);
    const obj = raw ? (JSON.parse(raw) as unknown) : null;
    return obj && typeof obj === "object" ? (obj as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeMap(key: string, value: Record<string, number>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* noop */
  }
}

// ホームで即座に表示するための同期版（通信しない）
export function unreadCount(): number {
  const last = readMap(LAST_KEY);
  const seen = readMap(SEEN_KEY);
  let n = 0;
  for (const [id, count] of Object.entries(last)) n += Math.max(0, count - (seen[id] ?? 0));
  return n;
}

// 通信して新着数を更新する。掲示板一覧を取得するだけなので専用RPCは不要。
export async function refreshUnread(): Promise<number> {
  if (!supabase) return 0;
  if (typeof navigator !== "undefined" && !navigator.onLine) return unreadCount();
  try {
    const boards = await listBoards();
    const last: Record<string, number> = {};
    for (const b of boards) last[b.id] = b.postCount;
    writeMap(LAST_KEY, last);
    // 削除された掲示板の既読情報は捨てる（localStorageの肥大化を防ぐ）
    const seen = readMap(SEEN_KEY);
    const pruned: Record<string, number> = {};
    for (const id of Object.keys(last)) if (seen[id] != null) pruned[id] = seen[id];
    writeMap(SEEN_KEY, pruned);
  } catch {
    /* オフライン等は前回値のまま */
  }
  return unreadCount();
}

// 掲示板を開いて読んだ時点で既読にする
export function markBoardSeen(boardId: string, postCount: number): void {
  const seen = readMap(SEEN_KEY);
  seen[boardId] = Math.max(seen[boardId] ?? 0, postCount);
  writeMap(SEEN_KEY, seen);
  // 実際の投稿数が一覧の値より新しいこともあるので、最新側にも反映しておく
  const last = readMap(LAST_KEY);
  if ((last[boardId] ?? 0) < postCount) {
    last[boardId] = postCount;
    writeMap(LAST_KEY, last);
  }
}

// その掲示板で既読になっている投稿数（一覧の「新着N」表示に使う）
export function seenCountFor(boardId: string): number {
  return readMap(SEEN_KEY)[boardId] ?? 0;
}

// 一覧に出ている分をまとめて既読にする
export function markAllSeen(): void {
  writeMap(SEEN_KEY, readMap(LAST_KEY));
}

/* ---------- 管理者 ---------- */

export function getAdminToken(): string {
  try {
    return localStorage.getItem(ADMIN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function isAdminMode(): boolean {
  return getAdminToken().length > 0;
}

export async function enableAdmin(token: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("is_admin", { p_token: token });
  if (error || data !== true) return false;
  try {
    localStorage.setItem(ADMIN_KEY, token);
  } catch {
    /* noop */
  }
  return true;
}

export function disableAdmin(): void {
  try {
    localStorage.removeItem(ADMIN_KEY);
  } catch {
    /* noop */
  }
}

/* ---------- 掲示板 ---------- */

export async function listBoards(): Promise<BoardRow[]> {
  if (!supabase) return [];
  const deviceId = await getDeviceId();
  const { data, error } = await supabase.rpc("list_boards", { p_device_id: deviceId });
  if (error) throw rpcError(error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    title: String(r.title),
    description: String(r.description ?? ""),
    author: String(r.author),
    postCount: Number(r.post_count ?? 0),
    lastPostAt: String(r.last_post_at),
    isMine: Boolean(r.is_mine),
  }));
}

export async function createBoard(title: string, description: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!supabase) return { ok: false, error: "コミュニティは現在利用できません" };
  const name = getName();
  if (!name) return { ok: false, error: "名前を登録してください" };
  const deviceId = await getDeviceId();
  const { data, error } = await supabase.rpc("create_board", {
    p_device_id: deviceId,
    p_name: name,
    p_title: title,
    p_description: description,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: String(data) };
}

export async function deleteMyBoard(boardId: string): Promise<void> {
  if (!supabase) return;
  const deviceId = await getDeviceId();
  const { error } = await supabase.rpc("delete_my_board", { p_device_id: deviceId, p_board_id: boardId });
  if (error) throw error;
}

/* ---------- 書き込み ---------- */

export async function listPosts(boardId: string): Promise<PostRow[]> {
  if (!supabase) return [];
  const deviceId = await getDeviceId();
  const { data, error } = await supabase.rpc("list_posts", { p_device_id: deviceId, p_board_id: boardId });
  if (error) throw rpcError(error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    author: String(r.author),
    body: String(r.body),
    createdAt: String(r.created_at),
    isMine: Boolean(r.is_mine),
  }));
}

export async function createPost(boardId: string, body: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "コミュニティは現在利用できません" };
  const name = getName();
  if (!name) return { ok: false, error: "名前を登録してください" };
  const deviceId = await getDeviceId();
  const { error } = await supabase.rpc("create_post", {
    p_device_id: deviceId,
    p_name: name,
    p_board_id: boardId,
    p_body: body,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteMyPost(postId: string): Promise<void> {
  if (!supabase) return;
  const deviceId = await getDeviceId();
  const { error } = await supabase.rpc("delete_my_post", { p_device_id: deviceId, p_post_id: postId });
  if (error) throw error;
}

// 通報は端末ごとに1回だけ数える（同一端末の連打で他人の投稿を隠せないようにするため）
export async function reportPost(postId: string): Promise<void> {
  if (!supabase) return;
  const deviceId = await getDeviceId();
  const { error } = await supabase.rpc("report_post", { p_device_id: deviceId, p_post_id: postId });
  if (error) throw rpcError(error);
}

export async function reportBoard(boardId: string): Promise<void> {
  if (!supabase) return;
  const deviceId = await getDeviceId();
  const { error } = await supabase.rpc("report_board", { p_device_id: deviceId, p_board_id: boardId });
  if (error) throw rpcError(error);
}

/* ---------- 管理者削除 ---------- */

export async function adminDeletePost(postId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc("admin_delete_post", { p_token: getAdminToken(), p_post_id: postId });
  if (error) throw error;
}

export async function adminDeleteBoard(boardId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc("admin_delete_board", { p_token: getAdminToken(), p_board_id: boardId });
  if (error) throw error;
}
