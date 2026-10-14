// 管理画面（admin.html）の利用状況のため、表示中は1分ごと（と科目を切り替えたとき）にサーバーへ知らせる。
// 送るのは端末ID・開いている科目ID・前回からの解答数／カード枚数だけ（014_admin_dashboard.sql の usage_ping）。
// Supabase 未設定のときは何もしない。失敗したら数を持ち越して次の回に送る。
import { supabase } from "./backend";
import { getDeviceId } from "./db";

const HEARTBEAT_MS = 60_000;

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
    const { error } = await supabase.rpc("usage_ping", {
      p_device_id: await getDeviceId(), p_subject: subject, p_answers: sent.answers, p_cards: sent.cards,
    });
    if (error) throw error;
  } catch {
    answers += sent.answers;
    cards += sent.cards;
  } finally {
    sending = false;
  }
}

export function startUsagePing(): void {
  void ping();
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
