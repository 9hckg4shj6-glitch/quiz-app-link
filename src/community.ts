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

export async function reportPost(postId: string): Promise<void> {
  if (!supabase) return;
  await supabase.rpc("report_post", { p_post_id: postId });
}

export async function reportBoard(boardId: string): Promise<void> {
  if (!supabase) return;
  await supabase.rpc("report_board", { p_board_id: boardId });
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
