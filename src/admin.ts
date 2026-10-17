// 管理画面。Supabase Auth でログインした管理者にだけ、サーバー（get_admin_dashboard）が利用状況を返す。
// このページのプログラムは公開されているが、管理者以外にはサーバーがデータを返さない（014_admin_dashboard.sql）。
// アプリ本体と同じオリジンなので、ログイン状態はアプリのログインと混ざらないようこのページ用の鍵で保存する。
import { createClient, type Session } from "@supabase/supabase-js";
import "./admin.css";

// メールのリンクから戻ったときの URL（#type=recovery や #error_code=…）。クライアントが消す前に読んでおく。
const linkHash = new URLSearchParams(location.hash.slice(1));
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabase = url && key
  ? createClient(url, key, { auth: { persistSession: true, storageKey: "quiz-admin-auth", autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

interface SubjectRow { subject: string; online: number; today: number; d7: number; d30: number; total: number; answers_today: number; answers_d7: number; cards_today: number; cards_d7: number; }
interface UserSubject { subject: string; last_day: string; answers: number; cards: number; }
interface User { id: string; device_id: string; blocked: boolean; name: string | null; account: boolean; subject: string | null; online: boolean; last_seen: string; first_seen: string; app_version?: string | null; answers_today: number; answers: number; subjects: UserSubject[]; }
interface Dashboard {
  online: number;
  active: { h1: number; today: number; d7: number; total: number; new_today: number; new_d7: number };
  subjects: SubjectRow[];
  daily: { day: string; subject: string; users: number }[];
  daily_total: { day: string; users: number }[];
  hourly: { at: string; online: number }[];
  peak_daily: { day: string; online: number }[];
  peak: { online: number; at: string } | null;
  sampled_since: string | null;
  users: User[];
  server_now: string;
}

// 科目の名前・絵文字・並び順は、アプリと同じ subjects.js（admin.html が先に読む）から取る。
const MANIFEST = ((window as unknown as { SUBJECTS?: { id: string; name?: string; emoji?: string }[] }).SUBJECTS ?? []);
const subjectLabel = (id: string): string => { const s = MANIFEST.find(m => m.id === id); return s ? `${s.emoji ?? ""} ${s.name ?? id}`.trim() : id; };
const subjectEmoji = (id: string): string => MANIFEST.find(m => m.id === id)?.emoji ?? "📘";

const REFRESH_MS = 20000;

const root = document.querySelector<HTMLElement>("#admin")!;
let session: Session | null = null;
let data: Dashboard | null = null;
let loadError = "";
let loading = false;
let loginError = "";
let busy = false;
let filter: "online" | "today" | "d7" | "all" | "blocked" = "today";
let subjectFilter = "";
let query = "";

const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const num = (n: number): string => n.toLocaleString("ja-JP");
const tokyo = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", ...opts });
const fmtTime = tokyo({ month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtHour = tokyo({ hour: "numeric" });
const fmtDay = tokyo({ month: "numeric", day: "numeric", weekday: "short" });
const dayKey = (t: Date): string => tokyo({ year: "numeric", month: "2-digit", day: "2-digit" }).format(t).replace(/\//g, "-");
// 今日から n 日前までの日（日本時間）を古い順に。
const lastDays = (n: number): Date[] => {
  const today = new Date(`${dayKey(new Date())}T12:00:00+09:00`);
  return Array.from({ length: n }, (_, i) => new Date(today.getTime() - (n - 1 - i) * 86400000));
};

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 120) return "いま";
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}日前`;
  return fmtTime.format(new Date(iso));
}

// ---------- ログイン・新規登録・パスワード再設定 ----------
// 登録は誰でもできるが、データを返すのはメール確認済みで admin_users に載ったアカウントだけ（014_admin_dashboard.sql）。
// 再設定：メールのリンクでこのページへ戻ると一時的にログインした状態になるので、新しいパスワードを決めてもらう。
type Mode = "login" | "signup" | "forgot" | "recovery";
let mode: Mode = linkHash.get("type") === "recovery" ? "recovery" : linkHash.has("error_code") ? "forgot" : "login";
let notice = "";
let lastEmail = "";
if (linkHash.has("error_code")) loginError = "メールのリンクが無効か、有効期限が切れています。もう一度メールを送ってください。";
// 確認・再設定のメールのリンクはこのページへ戻す（Supabase の Redirect URLs にこのページの URL が必要）。
const pageUrl = location.href.split(/[?#]/)[0];

function renderLogin(): void {
  const title = { login: "ログイン", signup: "管理者アカウントの作成", forgot: "パスワードの再設定", recovery: "新しいパスワードの設定" }[mode];
  const lead = {
    login: "",
    signup: "登録後に届く確認メールのリンクを開いてから、ログインしてください。",
    forgot: "登録したメールアドレスに、パスワードを設定し直すためのリンクを送ります。",
    recovery: "新しいパスワードを決めてください。設定するとそのままログインします。",
  }[mode];
  const newPassword = mode === "signup" || mode === "recovery";
  root.innerHTML = `<section class="login card">
    <h1>${title}</h1>
    ${lead ? `<p class="muted">${lead}</p>` : ""}
    <form id="login-form" novalidate>
      ${mode === "recovery" ? "" : `<label class="field"><span>メールアドレス</span><input name="email" type="email" autocomplete="username" value="${esc(lastEmail)}" required /></label>`}
      ${mode === "forgot" ? "" : `<label class="field"><span>${mode === "recovery" ? "新しいパスワード" : "パスワード"}${newPassword ? "（8文字以上）" : ""}</span><input name="password" type="password" autocomplete="${newPassword ? "new-password" : "current-password"}" required /></label>`}
      ${newPassword ? '<label class="field"><span>パスワード（確認）</span><input name="password2" type="password" autocomplete="new-password" required /></label>' : ""}
      <div role="status" class="error">${esc(loginError)}</div>
      ${notice ? `<p class="notice" role="status">${esc(notice)}</p>` : ""}
      <button class="btn primary" ${busy ? "disabled" : ""}>${{ login: "ログイン", signup: "アカウントを作成", forgot: "再設定のメールを送る", recovery: "パスワードを設定" }[mode]}</button>
    </form>
    <div class="login-links">${(mode === "login"
      ? [["forgot", "パスワードを忘れた・設定していない"], ["signup", "管理者アカウントを作成する"]]
      : mode === "recovery" ? [] : [["login", "ログインに戻る"]]).map(([m, label]) => `<button class="link" data-mode="${m}">${label}</button>`).join("")}</div>
  </section>`;
}

const authMessage = (m: string): string =>
  /invalid login credentials/i.test(m) ? "メールアドレスかパスワードが違います。Googleで作ったアカウントなどパスワードが無い場合は「パスワードを忘れた・設定していない」から設定してください。"
  : /email not confirmed/i.test(m) ? "メールアドレスの確認がまだです。届いた確認メールのリンクを開いてください。"
  : /already registered|already exists/i.test(m) ? "このメールアドレスは登録済みです。パスワードが分からなければ「パスワードを忘れた・設定していない」から設定してください。"
  : /auth session missing|session.*(expired|missing)/i.test(m) ? "再設定のリンクの有効期限が切れています。もう一度メールを送ってください。"
  : /different from the old/i.test(m) ? "以前と同じパスワードは使えません。"
  : /password/i.test(m) ? "パスワードが条件を満たしていません。8文字以上の、推測されにくいものにしてください。"
  : /signups? (not allowed|are disabled)|disabled/i.test(m) ? "新規登録が無効になっています（Supabase の Authentication → Providers → Email で有効にできます）。"
  : /rate limit|too many/i.test(m) ? "試行が多すぎます。しばらく待ってからやり直してください。"
  : "うまくいきませんでした。通信を確認して、もう一度お試しください。";

async function submitLogin(form: HTMLFormElement): Promise<void> {
  if (!supabase) return;
  const f = new FormData(form);
  const email = String(f.get("email") ?? lastEmail).trim().toLowerCase(), password = String(f.get("password") ?? "");
  const newPassword = mode === "signup" || mode === "recovery";
  lastEmail = email; loginError = ""; notice = "";
  if ((mode !== "recovery" && !email) || (mode !== "forgot" && !password)) { loginError = mode === "forgot" ? "メールアドレスを入力してください。" : "メールアドレスとパスワードを入力してください。"; renderLogin(); return; }
  if (newPassword && password.length < 8) { loginError = "パスワードは8文字以上にしてください。"; renderLogin(); return; }
  if (newPassword && password !== String(f.get("password2") ?? "")) { loginError = "確認用のパスワードが一致しません。"; renderLogin(); return; }
  busy = true; renderLogin();
  try {
    if (mode === "signup") {
      const { data: d, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: pageUrl } });
      if (error) throw error;
      // 確認済みのメールで登録し直すと、エラーにならず identities が空で返る。
      if (d.user && !d.user.identities?.length) throw new Error("already registered");
      session = d.session;
      if (!session) { mode = "login"; notice = "確認メールを送りました。メールのリンクを開いてから、ここでログインしてください。"; }
    } else if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: pageUrl });
      if (error) throw error;
      // 登録の有無は伝えない（Supabase も区別しない）。
      notice = "登録されているメールアドレスなら、再設定のメールを送りました。メールのリンクを開いてください。";
    } else if (mode === "recovery") {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      mode = "login";
      session = (await supabase.auth.getSession()).data.session;
    } else {
      const { data: d, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      session = d.session;
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    loginError = authMessage(m);
    if (mode === "recovery" && /session/i.test(m)) mode = "forgot";
  }
  finally { busy = false; }
  if (session && mode !== "recovery") void load(); else renderLogin();
}

// ---------- 集計の取得 ----------
async function load(): Promise<void> {
  if (!supabase || loading || !session || mode === "recovery") return;
  loading = true;
  if (!data) root.innerHTML = '<p class="loading">読み込み中…</p>';
  try {
    const { data: d, error } = await supabase.rpc("get_admin_dashboard");
    if (error) throw new Error(error.message);
    data = d as Dashboard; loadError = "";
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    loadError = /ADMIN_ONLY/.test(m) ? "ADMIN_ONLY"
      : /get_admin_dashboard|could not find the function/i.test(m) ? "サーバーの準備がまだです。supabase/migrations/014_admin_dashboard.sql を SQL Editor で適用してください。"
      : "最新の状況を取得できませんでした。前回の値を表示しています。";
  } finally { loading = false; }
  render();
}

// ---------- 描画 ----------
const tile = (label: string, value: number, note = "", big = false, unit = ""): string =>
  `<div class="tile ${big ? "big" : ""}"><span>${label}</span><strong>${num(value)}${unit ? `<em>${unit}</em>` : ""}</strong>${note ? `<small>${note}</small>` : ""}</div>`;

// 1系列の棒グラフ。棒より広い列全体にツールチップを付け、表でも読めるようにする。
function bars(id: string, title: string, rows: { label: string; tip: string; value: number; tick: boolean }[], unit: string): string {
  const max = Math.max(1, ...rows.map(r => r.value));
  const top = Math.max(1, Math.ceil(max / (max > 10 ? 5 : 1)) * (max > 10 ? 5 : 1));
  return `<figure class="chart" id="${id}">
    <figcaption>${title}</figcaption>
    <div class="plot" role="img" aria-label="${esc(title)}。最大 ${num(max)}${unit}">
      <span class="y-top">${num(top)}</span><span class="y-zero">0</span>
      <div class="cols">${rows.map(r => `<div class="col" data-tip="${esc(`${r.tip}：${num(r.value)}${unit}`)}"><i style="height:${(100 * r.value / top).toFixed(1)}%" class="${r.value ? "" : "zero"}"></i><b>${r.tick ? esc(r.label) : ""}</b></div>`).join("")}</div>
    </div>
    <details><summary>表で見る</summary><table><thead><tr><th>時刻</th><th>最大同時人数</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.tip)}</td><td>${num(r.value)}${unit}</td></tr>`).join("")}</tbody></table></details>
  </figure>`;
}

function hourlyRows(d: Dashboard) {
  const by = new Map(d.hourly.map(h => [Date.parse(h.at), h.online]));
  const now = new Date(d.server_now); now.setUTCMinutes(0, 0, 0);
  return Array.from({ length: 24 }, (_, i) => {
    const t = new Date(now.getTime() - (23 - i) * 3600000);
    const h = Number(fmtHour.format(t).replace(/\D/g, ""));
    return { label: `${h}時`, tip: `${fmtDay.format(t)} ${h}時台`, value: by.get(t.getTime()) ?? 0, tick: h % 3 === 0 };
  });
}
function dailyRows(d: Dashboard) {
  const by = new Map(d.peak_daily.map(x => [x.day, x.online]));
  return lastDays(14).map(t => ({ label: tokyo({ day: "numeric" }).format(t), tip: fmtDay.format(t), value: by.get(dayKey(t)) ?? 0, tick: true }));
}

// 科目の行。マニフェストの科目は利用ゼロでも出し、7日の利用者が多い順に並べる（同数はマニフェスト順）。
function subjectRows(d: Dashboard): SubjectRow[] {
  const by = new Map(d.subjects.map(s => [s.subject, s]));
  const zero = (subject: string): SubjectRow => ({ subject, online: 0, today: 0, d7: 0, d30: 0, total: 0, answers_today: 0, answers_d7: 0, cards_today: 0, cards_d7: 0 });
  const ids = [...MANIFEST.map(m => m.id), ...d.subjects.map(s => s.subject).filter(id => !MANIFEST.some(m => m.id === id))];
  return ids.map(id => by.get(id) ?? zero(id)).sort((a, b) => b.d7 - a.d7 || b.today - a.today || b.total - a.total);
}

function renderSubjects(rows: SubjectRow[]): string {
  const max = Math.max(1, ...rows.map(r => r.d7));
  return `<div class="table-wrap"><table class="subjects">
    <thead><tr><th>科目</th><th>いま</th><th>今日</th><th>直近7日</th><th>直近30日</th><th>累計</th><th>今日の解答</th><th>7日の解答</th><th>7日のカード</th></tr></thead>
    <tbody>${rows.map(r => `<tr class="${r.total ? "" : "zero"}" data-subject="${esc(r.subject)}">
      <td><button class="subj-name" data-subject="${esc(r.subject)}" title="この科目の利用者を一覧で見る">${esc(subjectLabel(r.subject))}</button></td>
      <td class="${r.online ? "online-n" : ""}">${num(r.online)}</td>
      <td>${num(r.today)}</td>
      <td><span class="hbar" aria-hidden="true"><i style="width:${(100 * r.d7 / max).toFixed(1)}%"></i></span>${num(r.d7)}</td>
      <td>${num(r.d30)}</td><td>${num(r.total)}</td>
      <td>${num(r.answers_today)}</td><td>${num(r.answers_d7)}</td><td>${num(r.cards_d7)}</td></tr>`).join("")}</tbody>
  </table></div>`;
}

// 科目×日の利用者。色の濃さは表全体の最大に対する割合。
function renderHeat(d: Dashboard, rows: SubjectRow[]): string {
  const days = lastDays(14), keys = days.map(dayKey);
  const by = new Map(d.daily.map(x => [`${x.subject}|${x.day}`, x.users]));
  const totals = new Map(d.daily_total.map(x => [x.day, x.users]));
  const used = rows.filter(r => keys.some(k => by.has(`${r.subject}|${k}`)));
  if (!used.length) return '<p class="empty">過去14日の記録はまだありません。</p>';
  const max = Math.max(1, ...d.daily.map(x => x.users));
  const cell = (n: number, tip: string): string => {
    if (!n) return `<td class="z" title="${esc(tip)}：0人">·</td>`;
    const p = Math.round(15 + 70 * n / max);
    return `<td title="${esc(`${tip}：${n}人`)}" style="background:color-mix(in srgb, var(--bar) ${p}%, var(--surface-2));${p > 50 ? "color:#fff;font-weight:600" : ""}">${num(n)}</td>`;
  };
  const weekday = (t: Date): string => tokyo({ weekday: "short" }).format(t);
  return `<div class="table-wrap"><table class="heat">
    <thead><tr><th></th>${days.map(t => `<th class="${/[土日]/.test(weekday(t)) ? "we" : ""}">${esc(tokyo({ month: "numeric", day: "numeric" }).format(t))}<br>${esc(weekday(t))}</th>`).join("")}</tr></thead>
    <tbody>${used.map(r => `<tr><th scope="row">${esc(subjectLabel(r.subject))}</th>${days.map((t, i) => cell(by.get(`${r.subject}|${keys[i]}`) ?? 0, `${subjectLabel(r.subject)} ${fmtDay.format(t)}`)).join("")}</tr>`).join("")}
      <tr class="sum"><th scope="row">合計（重複なし）</th>${keys.map((k, i) => `<td title="${esc(fmtDay.format(days[i]))}">${num(totals.get(k) ?? 0)}</td>`).join("")}</tr>
    </tbody></table></div>`;
}

// 期間と科目で絞る。オンラインは「いまその科目を開いている」、それ以外は「期間内にその科目を使った」。
function filteredUsers(d: Dashboard): User[] {
  const todayStart = Date.parse(`${dayKey(new Date())}T00:00:00+09:00`), weekAgo = Date.now() - 7 * 86400000;
  const fromDay = filter === "today" ? dayKey(new Date()) : filter === "d7" ? dayKey(lastDays(7)[0]) : "";
  const q = query.trim().toLowerCase();
  return d.users.filter(u =>
    (filter === "all" || (filter === "blocked" ? u.blocked : filter === "online" ? u.online : filter === "today" ? Date.parse(u.last_seen) >= todayStart : Date.parse(u.last_seen) >= weekAgo))
    && (!subjectFilter || (filter === "online" ? u.subject === subjectFilter : u.subjects.some(s => s.subject === subjectFilter && s.last_day >= fromDay)))
    && (!q || (u.name ?? "").toLowerCase().includes(q) || u.id.includes(q)));
}
function renderUsers(d: Dashboard): string {
  const list = filteredUsers(d);
  const shown = list.slice(0, 500);
  const rows = shown.map(u => `<tr>
      <td class="name"><strong>${u.name ? esc(u.name) : '<span class="muted">名前なし</span>'}${u.account ? '<span class="badge">アカウント</span>' : ""}${u.blocked ? '<span class="badge stop">停止中</span>' : ""}</strong><small>${esc(u.id)}</small></td>
      <td><span class="state ${u.online ? "on" : ""}"><i></i>${u.online ? (u.subject ? esc(subjectLabel(u.subject)) : "科目えらび") : "オフライン"}</span></td>
      <td data-label="最終利用">${esc(ago(u.last_seen))}</td>
      <td data-label="初回">${esc(fmtTime.format(new Date(u.first_seen)))}</td>
      <td data-label="版">${u.app_version === __APP_VERSION__ ? `<span class="muted">${esc(u.app_version)}</span>` : `<span class="badge stop">古い${u.app_version ? ` ${esc(u.app_version)}` : ""}</span>`}</td>
      <td data-label="使った科目"><span class="subj-list">${u.subjects.map(s => `<span title="${esc(`${subjectLabel(s.subject)}：解答${s.answers}問・カード${s.cards}枚・最終${s.last_day}`)}">${esc(subjectEmoji(s.subject))}</span>`).join("") || "—"}</span></td>
      <td data-label="今日の解答" class="n">${num(u.answers_today)}</td>
      <td data-label="累計の解答" class="n">${num(u.answers)}</td>
      <td>${u.device_id ? `<button class="btn small ${u.blocked ? "" : "danger"}" data-block="${esc(u.device_id)}" data-name="${esc(u.name ?? u.id)}" data-blocked="${u.blocked}">${u.blocked ? "停止を解除" : "利用を停止"}</button>` : ""}</td></tr>`).join("");
  // 版はこの管理画面と同じビルドなら最新。版を送らない旧版の端末は空なので「古い」になる（018_app_version.sql）。
  const latest = list.filter(u => u.app_version === __APP_VERSION__).length;
  return `<p class="muted users-count">${num(list.length)}人（最新版 ${num(latest)}人）${list.length > shown.length ? `（先頭${shown.length}人を表示）` : ""}</p>
    ${shown.length ? `<div class="table-wrap"><table class="users"><thead><tr><th>名前</th><th>状態</th><th>最終利用</th><th>初回</th><th>版</th><th>使った科目</th><th class="n">今日の解答</th><th class="n">累計の解答</th><th>利用</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<p class="empty">該当する利用者はいません。</p>'}`;
}

function render(): void {
  if (!supabase) { root.innerHTML = '<p class="loading">サーバーの設定がありません。</p>'; return; }
  if (!session || mode === "recovery") { renderLogin(); return; }
  if (loadError === "ADMIN_ONLY") {
    root.innerHTML = `<section class="login card"><h1>管理者として登録されていません</h1><p class="muted">ログインはできています。Supabase の SQL Editor で次の1行を実行してから、「再読み込み」を押してください。</p><pre class="sql">insert into public.admin_users(email) values('${esc((session.user.email ?? "").toLowerCase())}');</pre><div class="top-actions"><button class="btn primary" data-act="refresh">再読み込み</button><button class="btn ghost" data-act="logout">ログアウト</button></div></section>`;
    return;
  }
  const d = data;
  if (!d) { root.innerHTML = `<p class="loading">${esc(loadError || "読み込み中…")}</p>`; return; }
  const focused = document.activeElement?.id === "user-search";
  const rows = subjectRows(d);
  const answersToday = rows.reduce((n, r) => n + r.answers_today, 0), cardsToday = rows.reduce((n, r) => n + r.cards_today, 0);
  root.innerHTML = `<header class="top">
      <div><p class="eyebrow">ADMIN</p><h1>基礎医学演習アプリ 管理</h1></div>
      <div class="top-actions"><small class="muted">${loading ? "更新中…" : `${esc(fmtTime.format(new Date(d.server_now)))} 時点 · 20秒ごとに更新`}</small><button class="btn" data-act="refresh">更新</button><button class="btn ghost" data-act="logout">ログアウト</button></div>
    </header>
    ${loadError ? `<p class="error" role="status">${esc(loadError)}</p>` : ""}
    <section class="tiles now">
      ${tile("いまオンライン", d.online, "直近2分にアプリを表示", true)}
      ${tile("今日の利用", d.active.today, `うち初めて ${num(d.active.new_today)}`)}
      ${tile("直近7日の利用", d.active.d7, `うち初めて ${num(d.active.new_d7)}`)}
      ${tile("今日の解答", answersToday, `カード ${num(cardsToday)}枚`, false, "問")}
    </section>
    <section class="card"><h2>科目ごとの利用者</h2>
      ${renderSubjects(rows)}
      <p class="muted">利用者はその科目を開いた端末の数です（1人が複数の科目を開けば、それぞれに数えます）。行を押すと、その科目の利用者を下の一覧で表示します。</p>
    </section>
    <section class="card"><h2>科目別・日ごとの利用者（過去14日）</h2>
      ${renderHeat(d, rows)}
      <p class="muted">色が濃いほど多い。合計は、その日にどれかの科目を開いた端末の数（重複なし）です。</p>
    </section>
    <section class="card"><h2>最大同時人数</h2>
      <p class="muted">${d.peak ? `記録上の最大：<b>${num(d.peak.online)}人</b>（${esc(fmtTime.format(new Date(d.peak.at)))}）` : "まだ記録がありません。"}${d.sampled_since ? ` · ${esc(fmtTime.format(new Date(d.sampled_since)))}から記録` : ""} · アプリを開いている端末が1分ごとに記録します</p>
      <div class="charts">${bars("hourly", "過去24時間（1時間ごとの最大）", hourlyRows(d), "人")}${bars("daily", "過去14日（1日ごとの最大）", dailyRows(d), "人")}</div>
    </section>
    <section class="card" id="users-card"><h2>利用者一覧</h2>
      <div class="user-tools">
        <div class="chips" role="group" aria-label="期間">${(["online", "today", "d7", "all", "blocked"] as const).map(f => `<button class="chip ${filter === f ? "on" : ""}" data-filter="${f}" aria-pressed="${filter === f}">${{ online: "オンライン", today: "今日", d7: "7日以内", all: "すべて", blocked: "停止中" }[f]}</button>`).join("")}</div>
        <select id="user-subject" aria-label="科目"><option value="">すべての科目</option>${rows.map(r => `<option value="${esc(r.subject)}" ${r.subject === subjectFilter ? "selected" : ""}>${esc(subjectLabel(r.subject))}</option>`).join("")}</select>
        <input id="user-search" type="search" placeholder="名前・端末IDで検索" value="${esc(query)}" />
      </div>
      <div id="users">${renderUsers(d)}</div>
      <p class="muted">名前はアカウントの表示名か、ランキングに参加したときの名前です。この端末で登録していなくても、同じアカウントでログインしたことのある別の端末で登録した名前を出します（どれもなければ「名前なし」）。1台の端末を1人として数えるため、スマホとPCを使い分ける人は2人と数えます。「利用を停止」した端末は、次にアプリを開いたとき（開いている端末は1分以内）に「利用は停止されています」の画面になり、操作できなくなります。その端末がアカウントにログインしていれば、そのアカウントも別の端末で止まります。ただし、ゲストが端末のサイトデータを消すと、新しい端末として使えてしまいます。この記録は管理画面の公開（2026年10月）以降のものです。</p>
    </section>
    <div class="tip" id="tip" role="tooltip" hidden></div>`;
  if (focused) { const s = document.querySelector<HTMLInputElement>("#user-search"); s?.focus(); s?.setSelectionRange(s.value.length, s.value.length); }
}

// ---------- 操作 ----------
async function setBlocked(deviceId: string, blocked: boolean, name: string): Promise<void> {
  if (!supabase) return;
  const ask = blocked
    ? `「${name}」の端末のアプリ利用を停止しますか？\nこの端末（とログイン中のアカウント）では、アプリを開けなくなります。`
    : `「${name}」の端末の停止を解除しますか？`;
  if (!confirm(ask)) return;
  const { error } = await supabase.rpc("admin_set_device_blocked", { p_device_id: deviceId, p_blocked: blocked });
  if (error) {
    alert(/admin_set_device_blocked|could not find the function/i.test(error.message)
      ? "サーバーの準備がまだです。supabase/migrations/015_device_block.sql を SQL Editor で適用してください。"
      : "変更できませんでした。通信を確認して、もう一度お試しください。");
    return;
  }
  await load();
}

root.addEventListener("submit", e => {
  const form = e.target as HTMLFormElement;
  if (form.id === "login-form") { e.preventDefault(); void submitLogin(form); }
});
root.addEventListener("click", async e => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act],[data-filter],[data-subject],[data-mode],[data-block]");
  if (!el) return;
  if (el.dataset.block) { void setBlocked(el.dataset.block, el.dataset.blocked !== "true", el.dataset.name ?? ""); return; }
  if (el.dataset.mode) { mode = el.dataset.mode as Mode; loginError = ""; notice = ""; renderLogin(); return; }
  if (el.dataset.filter) { filter = el.dataset.filter as typeof filter; render(); return; }
  if (el.dataset.subject) {
    subjectFilter = el.dataset.subject;
    render();
    document.querySelector("#users-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const act = el.dataset.act;
  if (act === "refresh") void load();
  else if (act === "logout") { await supabase?.auth.signOut(); session = null; data = null; loadError = ""; renderLogin(); }
});
root.addEventListener("input", e => {
  const el = e.target as HTMLInputElement;
  if (el.id === "user-search" && data) { query = el.value; document.querySelector("#users")!.innerHTML = renderUsers(data); }
});
root.addEventListener("change", e => {
  const el = e.target as HTMLSelectElement;
  if (el.id === "user-subject" && data) { subjectFilter = el.value; document.querySelector("#users")!.innerHTML = renderUsers(data); }
});
// グラフの列にツールチップ。
root.addEventListener("pointermove", e => {
  const tip = document.querySelector<HTMLElement>("#tip");
  if (!tip) return;
  const col = (e.target as HTMLElement).closest<HTMLElement>(".col");
  if (!col) { tip.hidden = true; return; }
  tip.textContent = col.dataset.tip ?? ""; tip.hidden = false;
  const r = col.getBoundingClientRect();
  tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2))}px`;
  tip.style.top = `${r.top + window.scrollY - tip.offsetHeight - 8}px`;
});
root.addEventListener("pointerleave", () => { const tip = document.querySelector<HTMLElement>("#tip"); if (tip) tip.hidden = true; });

if (supabase) {
  setInterval(() => { if (session && document.visibilityState === "visible") void load(); }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (session && document.visibilityState === "visible") void load(); });
  supabase.auth.onAuthStateChange((event, s) => {
    session = s;
    if (event === "PASSWORD_RECOVERY") { mode = "recovery"; loginError = ""; renderLogin(); }
    else if (!s) { data = null; renderLogin(); }
  });
  void (async () => {
    session = (await supabase.auth.getSession()).data.session;
    if (session && mode !== "recovery") void load(); else renderLogin();
  })();
} else render();
