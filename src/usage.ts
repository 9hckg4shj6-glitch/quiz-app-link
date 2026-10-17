// 管理画面（admin.html）の利用状況のため、表示中は1分ごと（と科目を切り替えたとき）にサーバーへ知らせる。
// 送るのは端末ID・開いている科目ID・前回からの解答数／カード枚数だけ（014_admin_dashboard.sql の usage_ping）。
// ほかに、開いたときに1回だけアプリの版を送る（018_app_version.sql の set_device_version）。
// Supabase 未設定のときは何もしない。失敗したら数を持ち越して次の回に送る。
// 管理画面で停止された端末には blocked=true が返るので、全面の「停止中」画面で操作できなくする（015_device_block.sql）。
// オフラインで開いても止まるよう、停止中は端末に印を残す。解除が返ったら印を消して開き直す。
import { supabase } from "./backend";
import { getDeviceId } from "./db";

const HEARTBEAT_MS = 60_000;
const BLOCKED_KEY = "quizBlocked_v1";

function showBlocked(): void {
  if (document.getElementById("app-blocked")) return;
  for (const el of Array.from(document.body.children)) el.setAttribute("inert", "");
  const screen = document.createElement("div");
  screen.id = "app-blocked";
  screen.setAttribute("role", "alertdialog");
  screen.setAttribute("aria-modal", "true");
  screen.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:Canvas;color:CanvasText;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans',sans-serif";
  screen.innerHTML = '<div><h1 style="font-size:20px;margin:0 0 12px">このアプリの利用は停止されています</h1><p style="margin:0;opacity:.7;font-size:14px;line-height:1.7">心当たりがない場合は、アプリの管理者に連絡してください。</p></div>';
  document.body.append(screen);
}

function applyBlocked(blocked: boolean): void {
  let was = false;
  try {
    was = localStorage.getItem(BLOCKED_KEY) === "1";
    if (blocked) localStorage.setItem(BLOCKED_KEY, "1"); else localStorage.removeItem(BLOCKED_KEY);
  } catch { /* 保存できなくても、この表示中は止める */ }
  if (blocked) showBlocked();
  else if (was || document.getElementById("app-blocked")) location.reload();
}

try { if (localStorage.getItem(BLOCKED_KEY) === "1") showBlocked(); } catch { /* noop */ }

// 旧UI（index.html）より先に科目が選ばれていた場合に備え、最後に選んだ科目から始める。
let subject: string | null = (() => { try { return localStorage.getItem("quizSubject_v1"); } catch { return null; } })();
let answers = 0;
let cards = 0;
let sending = false;

async function ping(): Promise<void> {
  if (!supabase || sending) return;
  // 裏にいる間は送らない。ただし未送信の数があれば、隠れた瞬間に1回だけ送る。
  if (document.visibilityState !== "visible" && !answers && !cards) return;
  sending = true;
  const sent = { answers, cards };
  answers = 0;
  cards = 0;
  try {
    const { data, error } = await supabase.rpc("usage_ping", {
      p_device_id: await getDeviceId(), p_subject: subject, p_answers: sent.answers, p_cards: sent.cards,
    });
    if (error) throw error;
    applyBlocked((data as { blocked?: boolean } | null)?.blocked === true);
  } catch {
    answers += sent.answers;
    cards += sent.cards;
  } finally {
    sending = false;
  }
}

export function startUsagePing(): void {
  void ping();
  // 古い版のまま残っている端末を管理画面で見分けるため、開くたびに版を1回知らせる
  // （018_app_version.sql。未適用・通信失敗でも利用状況の記録には影響しない）。
  if (supabase) {
    const client = supabase;
    void getDeviceId()
      .then((deviceId) => client.rpc("set_device_version", { p_device_id: deviceId, p_version: __APP_VERSION__ }))
      .catch(() => { /* noop */ });
  }
  setInterval(() => void ping(), HEARTBEAT_MS);
  document.addEventListener("visibilitychange", () => void ping());
}

export function setUsageSubject(id: string | null): void {
  if (id === subject) return;
  subject = id;
  void ping();
}

export function countUsage(kind: "answer" | "card"): void {
  if (kind === "answer") answers++;
  else cards++;
}
