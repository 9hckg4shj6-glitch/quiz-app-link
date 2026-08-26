import { supabase } from "./backend";
import { getDeviceId } from "./db";
import { getName, hasName, setName } from "./community";

// PDFの溜まり場。科目をまたいで資料PDFを持ち寄り、各自がダウンロードする。
// 識別は端末ごとの device_id ＋ 表示名（掲示板と同じ。ログイン不要）。
// メタデータは security definer の RPC 経由（supabase/migrations/012_pdf_shelf.sql）、
// ファイル本体は非公開バケット pdf-shelf に置き、短時間の署名付きURLで取り出す。

const BUCKET = "pdf-shelf";
const MAX_BYTES = 20 * 1024 * 1024; // バケット側の file_size_limit と揃える
const QUOTA_BYTES = 1024 * 1024 * 1024; // 無料枠の目安
const SIGNED_URL_SECONDS = 300;

// 012 未適用でRPCが存在しない場合を、通信エラーと区別する（community.ts と同じ扱い）。
const NOT_READY = "NOT_READY";

const LICENSES = [
  { value: "own", label: "自分で作成した資料" },
  { value: "permitted", label: "配布の許可を得ている" },
  { value: "public_domain", label: "配布が自由な資料（公的資料・パブリックドメイン等）" },
] as const;

export interface PdfShelfSubject {
  id: string;
  name: string;
  emoji?: string;
}

interface PdfRow {
  id: string;
  title: string;
  description: string;
  author: string;
  subject_id: string;
  lecture: string;
  year: number | null;
  tags: string[];
  license: string;
  source: string;
  byte_size: number;
  download_count: number;
  created_at: string;
  is_mine: boolean;
}

interface Draft {
  title: string;
  description: string;
  subjectId: string;
  lecture: string;
  year: string;
  tags: string;
  license: string;
  source: string;
}

const emptyDraft = (): Draft => ({
  title: "",
  description: "",
  subjectId: "",
  lecture: "",
  year: "",
  tags: "",
  license: "own",
  source: "",
});

let rootNode: HTMLElement | null = null;
let subjects: PdfShelfSubject[] = [];
let rows: PdfRow[] = [];
let stats = { fileCount: 0, totalBytes: 0 };
let filterSubject: string | null = null;
let query = "";
let uploadOpen = false;
let draft: Draft = emptyDraft();
let pickedFile: File | null = null;
let busy = false;
let loaded = false;
let notReady = false;
let message = "";
let messageKind: "info" | "error" | "success" = "info";

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setMessage(next: string, kind: typeof messageKind = "info"): void {
  message = next;
  messageKind = kind;
}

function rpcError(error: { code?: string; message?: string }): Error {
  const text = error.message ?? "";
  if (error.code === "PGRST202" || /Could not find the function/i.test(text)) return new Error(NOT_READY);
  return new Error(text || "通信に失敗しました");
}

export function pdfShelfEnabled(): boolean {
  return Boolean(supabase);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function subjectLabel(id: string): string {
  const found = subjects.find((subject) => subject.id === id);
  if (!found) return id === "other" || !id ? "その他" : id;
  return `${found.emoji ? `${found.emoji} ` : ""}${found.name}`;
}

function licenseLabel(value: string): string {
  return LICENSES.find((entry) => entry.value === value)?.label ?? value;
}

/* ---------- サーバー ---------- */

async function sha256Hex(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function loadList(): Promise<void> {
  if (!supabase) return;
  const deviceId = await getDeviceId();
  const list = await supabase.rpc("list_pdfs", {
    p_device_id: deviceId,
    p_subject_id: filterSubject,
    p_query: query.trim() || null,
  });
  if (list.error) throw rpcError(list.error);
  rows = (list.data ?? []) as PdfRow[];
  const usage = await supabase.rpc("pdf_shelf_stats");
  if (!usage.error) {
    const row = (usage.data as Array<{ file_count: number; total_bytes: number }> | null)?.[0];
    stats = { fileCount: row?.file_count ?? 0, totalBytes: Number(row?.total_bytes ?? 0) };
  }
  loaded = true;
}

// 署名付きURLの発行はここだけ。将来 Edge Function 経由へ移すときはこの関数を差し替える。
async function signedUrlFor(id: string): Promise<string> {
  if (!supabase) throw new Error("通信できません");
  const deviceId = await getDeviceId();
  const path = await supabase.rpc("pdf_download_path", { p_device_id: deviceId, p_id: id });
  if (path.error) throw rpcError(path.error);
  const signed = await supabase.storage.from(BUCKET).createSignedUrl(String(path.data), SIGNED_URL_SECONDS);
  if (signed.error || !signed.data) throw new Error(signed.error?.message || "ダウンロードURLを作成できませんでした");
  return signed.data.signedUrl;
}

async function uploadPdf(): Promise<void> {
  if (!supabase) throw new Error("通信できません");
  const file = pickedFile;
  if (!file) throw new Error("PDFファイルを選んでください");
  if (file.size > MAX_BYTES) throw new Error(`ファイルが大きすぎます（上限 ${formatBytes(MAX_BYTES)}）`);
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (String.fromCharCode(...head) !== "%PDF-") throw new Error("PDFファイルではないようです");
  if (!draft.title.trim()) throw new Error("タイトルを入力してください");
  if (!hasName()) throw new Error("表示名を設定してください");

  const deviceId = await getDeviceId();
  const sha256 = await sha256Hex(file);
  const created = await supabase.rpc("create_pdf_entry", {
    p_device_id: deviceId,
    p_name: getName(),
    p_title: draft.title,
    p_description: draft.description,
    p_subject_id: draft.subjectId || "other",
    p_lecture: draft.lecture,
    p_year: draft.year ? Number(draft.year) : null,
    p_tags: draft.tags.split(/[,、\s]+/).filter((tag) => tag.length > 0),
    p_license: draft.license,
    p_source: draft.source,
    p_sha256: sha256,
  });
  if (created.error) throw rpcError(created.error);
  const id = String(created.data);

  const upload = await supabase.storage
    .from(BUCKET)
    .upload(`${id}.pdf`, file, { contentType: "application/pdf" });
  if (upload.error) {
    await supabase.rpc("cancel_pdf_entry", { p_device_id: deviceId, p_id: id });
    throw new Error(upload.error.message || "アップロードに失敗しました");
  }

  const finished = await supabase.rpc("finish_pdf_upload", {
    p_device_id: deviceId,
    p_id: id,
    p_byte_size: file.size,
  });
  if (finished.error) throw rpcError(finished.error);
}

/* ---------- 描画 ---------- */

function heroHtml(): string {
  const used = stats.totalBytes;
  const percent = Math.min(100, Math.round((used / QUOTA_BYTES) * 100));
  return `
    <div class="pdfShelfHero">
      <div>
        <span class="pdfShelfEyebrow">みんなの資料</span>
        <h2>PDFの溜まり場</h2>
        <p>科目をまたいで資料PDFを持ち寄る場所です。誰でもアップロードでき、誰でもダウンロードできます。</p>
      </div>
      <div class="pdfShelfQuota">
        <b>${esc(stats.fileCount)}</b><span>件 / ${esc(formatBytes(used))}</span>
        <i style="--pdf-fill:${percent}%"></i>
        <small>保存容量の ${esc(percent)}%</small>
      </div>
    </div>
    <div class="pdfShelfNotice">
      <b>アップロードの前に</b>
      <p>第三者の著作物（教科書、配布資料、過去問など）を権利者の許可なく公開しないでください。権利区分の申告が必要です。問題のある資料は通報から非公開にできます。削除の依頼は、この画面の通報かコミュニティの掲示板から連絡してください。</p>
    </div>`;
}

function filterHtml(): string {
  const tabs = [{ id: null as string | null, label: "すべて" }, ...subjects.map((s) => ({ id: s.id, label: `${s.emoji ? `${s.emoji} ` : ""}${s.name}` })), { id: "other", label: "その他" }];
  return `
    <div class="pdfShelfBar">
      <div class="pdfShelfTabs" role="tablist" aria-label="科目でしぼりこむ">
        ${tabs
          .map(
            (tab) => `<button type="button" role="tab" aria-selected="${filterSubject === tab.id}"
              class="${filterSubject === tab.id ? "active" : ""}"
              data-pdf-action="filter" data-subject="${esc(tab.id ?? "")}">${esc(tab.label)}</button>`,
          )
          .join("")}
      </div>
      <form class="pdfShelfSearch" data-pdf-action="search">
        <input type="search" name="q" value="${esc(query)}" placeholder="タイトル・授業名・タグで検索" aria-label="PDFを検索">
        <button type="submit" class="btn ghost small">検索</button>
      </form>
    </div>`;
}

function uploadHtml(): string {
  if (!uploadOpen) {
    return `<div class="pdfShelfActions"><button type="button" class="btn primary" data-pdf-action="open-upload">＋ PDFをアップロード</button></div>`;
  }
  return `
    <form class="pdfShelfForm" data-pdf-action="submit">
      <div class="pdfShelfFormHead">
        <h3>PDFをアップロード</h3>
        <button type="button" class="btn ghost small" data-pdf-action="close-upload">閉じる</button>
      </div>
      <label>表示名（投稿者として一覧に出ます）
        <input name="author" value="${esc(getName())}" maxlength="24" placeholder="例：さとう" required>
      </label>
      <label>PDFファイル（${esc(formatBytes(MAX_BYTES))}まで）
        <input type="file" accept="application/pdf,.pdf" data-pdf-file required>
      </label>
      <div class="pdfShelfPicked" data-pdf-picked>${pickedFile ? esc(`${pickedFile.name}（${formatBytes(pickedFile.size)}）`) : ""}</div>
      <label>タイトル
        <input name="title" value="${esc(draft.title)}" maxlength="80" placeholder="例：第5回 解糖系のまとめ" required>
      </label>
      <label>説明（任意）
        <textarea name="description" rows="3" maxlength="500" placeholder="どんな資料か、どこまで載っているか">${esc(draft.description)}</textarea>
      </label>
      <div class="pdfShelfFormRow">
        <label>科目
          <select name="subjectId">
            ${subjects.map((s) => `<option value="${esc(s.id)}" ${draft.subjectId === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}
            <option value="other" ${draft.subjectId === "other" ? "selected" : ""}>その他</option>
          </select>
        </label>
        <label>授業名・回（任意）
          <input name="lecture" value="${esc(draft.lecture)}" maxlength="40" placeholder="例：第5回">
        </label>
        <label>年度（任意）
          <input name="year" value="${esc(draft.year)}" inputmode="numeric" maxlength="4" placeholder="例：2026">
        </label>
      </div>
      <label>タグ（任意・カンマ区切り、8個まで）
        <input name="tags" value="${esc(draft.tags)}" maxlength="120" placeholder="例：まとめ, 図解, 期末">
      </label>
      <label>権利区分（必須）
        <select name="license" required>
          ${LICENSES.map((entry) => `<option value="${entry.value}" ${draft.license === entry.value ? "selected" : ""}>${esc(entry.label)}</option>`).join("")}
        </select>
      </label>
      <label>出典（任意・引用元や作成者）
        <input name="source" value="${esc(draft.source)}" maxlength="200" placeholder="例：自作 / ○○先生の許可あり">
      </label>
      <button type="submit" class="btn primary" ${busy ? "disabled" : ""}>${busy ? "アップロード中…" : "アップロードする"}</button>
    </form>`;
}

function rowHtml(row: PdfRow): string {
  const meta = [subjectLabel(row.subject_id), row.lecture, row.year ? `${row.year}年度` : ""].filter(Boolean);
  return `
    <article class="pdfShelfItem">
      <div class="pdfShelfItemHead">
        <span class="pdfShelfIcon">PDF</span>
        <div class="pdfShelfItemBody">
          <strong>${esc(row.title)}</strong>
          <small>${esc(meta.join(" ・ "))}</small>
        </div>
        <button type="button" class="btn primary small" data-pdf-action="download" data-id="${esc(row.id)}">ダウンロード</button>
      </div>
      ${row.description ? `<p class="pdfShelfDesc">${esc(row.description)}</p>` : ""}
      ${row.tags.length ? `<div class="pdfShelfTags">${row.tags.map((tag) => `<span>${esc(tag)}</span>`).join("")}</div>` : ""}
      <div class="pdfShelfItemFoot">
        <span>${esc(row.author)} ・ ${esc(formatDate(row.created_at))} ・ ${esc(formatBytes(row.byte_size))} ・ ${esc(row.download_count)}回</span>
        <span class="pdfShelfLicense" title="${esc(row.source || licenseLabel(row.license))}">${esc(licenseLabel(row.license))}</span>
        ${
          row.is_mine
            ? `<button type="button" class="pdfShelfLink" data-pdf-action="delete" data-id="${esc(row.id)}">削除</button>`
            : `<button type="button" class="pdfShelfLink" data-pdf-action="report" data-id="${esc(row.id)}">通報</button>`
        }
      </div>
    </article>`;
}

function listHtml(): string {
  if (!loaded) return `<div class="pdfShelfEmpty compact"><p>読み込み中…</p></div>`;
  if (rows.length === 0) {
    return `<div class="pdfShelfEmpty">
      <span>▤</span>
      <h3>まだPDFがありません</h3>
      <p>最初の1件をアップロードすると、ここに並びます。</p>
    </div>`;
  }
  return `<div class="pdfShelfList">${rows.map(rowHtml).join("")}</div>`;
}

function repaint(): void {
  const root = rootNode;
  if (!root) return;
  if (!supabase) {
    root.innerHTML = `<div class="panel"><b>PDFの溜まり場</b><p>現在準備中です（サーバー設定の完了後に利用できます）。</p></div>`;
    return;
  }
  if (notReady) {
    root.innerHTML = `<div class="panel"><b>PDFの溜まり場</b><p>現在準備中です（サーバー側の更新が済むと利用できます）。</p></div>`;
    return;
  }
  root.innerHTML = `
    <div class="pdfShelfShell">
      ${heroHtml()}
      ${message ? `<div class="pdfShelfMessage ${messageKind}">${esc(message)}</div>` : ""}
      ${uploadHtml()}
      ${filterHtml()}
      ${listHtml()}
    </div>`;
}

async function refresh(): Promise<void> {
  try {
    await loadList();
    notReady = false;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text === NOT_READY) {
      notReady = true;
    } else {
      loaded = true;
      setMessage(text, "error");
    }
  }
  repaint();
}

async function handleAction(target: HTMLElement): Promise<void> {
  const action = target.dataset.pdfAction;
  const id = target.dataset.id ?? "";
  if (action === "open-upload") {
    uploadOpen = true;
    setMessage("");
    repaint();
    return;
  }
  if (action === "close-upload") {
    uploadOpen = false;
    pickedFile = null;
    repaint();
    return;
  }
  if (action === "filter") {
    filterSubject = target.dataset.subject || null;
    loaded = false;
    repaint();
    await refresh();
    return;
  }
  if (action === "download") {
    try {
      const url = await signedUrlFor(id);
      window.open(url, "_blank", "noopener");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), "error");
      repaint();
    }
    return;
  }
  if (action === "delete") {
    if (!window.confirm("このPDFを削除しますか？")) return;
    const deviceId = await getDeviceId();
    const result = await supabase!.rpc("delete_my_pdf", { p_device_id: deviceId, p_id: id });
    if (result.error) setMessage(rpcError(result.error).message, "error");
    else setMessage("削除しました", "success");
    await refresh();
    return;
  }
  if (action === "report") {
    if (!window.confirm("このPDFを通報しますか？（3件で一覧から消えます）")) return;
    const deviceId = await getDeviceId();
    const result = await supabase!.rpc("report_pdf", { p_device_id: deviceId, p_id: id });
    if (result.error) setMessage(rpcError(result.error).message, "error");
    else setMessage("通報しました。ご協力ありがとうございます。", "success");
    await refresh();
  }
}

function readDraft(form: HTMLFormElement): void {
  const data = new FormData(form);
  const text = (key: string): string => String(data.get(key) ?? "");
  draft = {
    title: text("title"),
    description: text("description"),
    subjectId: text("subjectId"),
    lecture: text("lecture"),
    year: text("year"),
    tags: text("tags"),
    license: text("license") || "own",
    source: text("source"),
  };
  setName(text("author"));
}

async function handleSubmit(form: HTMLFormElement): Promise<void> {
  if (busy) return;
  readDraft(form);
  busy = true;
  setMessage("アップロードしています…");
  repaint();
  try {
    await uploadPdf();
    uploadOpen = false;
    pickedFile = null;
    draft = emptyDraft();
    setMessage("アップロードしました", "success");
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    setMessage(text === NOT_READY ? "サーバー側の更新が済んでいません" : text, "error");
  } finally {
    busy = false;
  }
  await refresh();
}

export async function renderPdfShelf(root: HTMLElement, list: PdfShelfSubject[]): Promise<void> {
  rootNode = root;
  subjects = list;
  if (!draft.subjectId) draft.subjectId = list[0]?.id ?? "other";
  if (!root.dataset.pdfBound) {
    root.dataset.pdfBound = "true";
    root.addEventListener("click", (event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("button[data-pdf-action]") : null;
      if (target) void handleAction(target);
    });
    root.addEventListener("submit", (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      event.preventDefault();
      if (form.dataset.pdfAction === "search") {
        query = String(new FormData(form).get("q") ?? "");
        loaded = false;
        repaint();
        void refresh();
        return;
      }
      if (form.dataset.pdfAction === "submit") void handleSubmit(form);
    });
    root.addEventListener("change", (event) => {
      const input = event.target;
      if (input instanceof HTMLInputElement && input.dataset.pdfFile !== undefined) {
        pickedFile = input.files?.[0] ?? null;
        // ファイル入力は再描画で消えてしまうので、選択の表示だけその場で書き換える。
        const label = rootNode?.querySelector("[data-pdf-picked]");
        if (label) label.textContent = pickedFile ? `${pickedFile.name}（${formatBytes(pickedFile.size)}）` : "";
      }
    });
  }
  loaded = false;
  repaint();
  await refresh();
}
