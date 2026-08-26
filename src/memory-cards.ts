import { supabase } from "./backend";
import { db, nowIso, saveCard, saveDeck, uuid } from "./db";
import {
  DEFAULT_DESIRED_RETENTION,
  DEFAULT_NEW_CARDS_PER_DAY,
  DEFAULT_REVIEWS_PER_DAY,
  type Deck,
  type StudyCard,
} from "./types";

export interface MemoryCardSubject {
  id: string;
  name: string;
  emoji?: string;
}

interface SharedDeckRow {
  id: string;
  owner_id: string;
  subject_id: string;
  title: string;
  description: string;
  version: number;
  card_count: number;
  published_at: string;
}

interface SharedCardRow {
  id: string;
  shared_deck_id: string;
  origin_card_id: string;
  front: string;
  back: string;
  explanation: string;
  tags: string[];
  position: number;
}

type EditorState =
  | { kind: "deck" }
  | { kind: "card"; cardId: string | null }
  | null;

let rootNode: HTMLElement | null = null;
let activeSubject: MemoryCardSubject | null = null;
let activeTab: "mine" | "public" = "mine";
let selectedDeckId: string | null = null;
let selectedSharedDeckId: string | null = null;
let editor: EditorState = null;
let message = "";
let messageKind: "info" | "error" | "success" = "info";
let sharedDecks: SharedDeckRow[] = [];
let sharedCards: SharedCardRow[] = [];
let studyIndex = 0;
let studyRevealed = false;
let publishInFlight = false;

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

async function memoryDecks(): Promise<Deck[]> {
  if (!activeSubject) return [];
  return db.decks
    .filter((deck) => deck.system === "memory" && deck.subjectId === activeSubject!.id && !deck.deletedAt)
    .sortBy("order");
}

async function cardsFor(deckId: string): Promise<StudyCard[]> {
  const cards = await db.cards.filter((card) => card.deckId === deckId && !card.deletedAt).sortBy("createdAt");
  return cards;
}

function shell(content: string): string {
  const subject = activeSubject!;
  return `
    <div class="memoryCardsShell">
      <div class="memoryCardsHero">
        <div>
          <span class="memoryCardsEyebrow">${esc(subject.emoji || "▧")} ${esc(subject.name)}</span>
          <h2>暗記カード</h2>
          <p>自分専用のデッキを作り、必要なものだけ科目別に共有できます。</p>
        </div>
        <button type="button" class="btn primary" data-memory-action="new-deck">＋ デッキを作成</button>
      </div>
      <div class="memoryCardsTabs" role="tablist" aria-label="暗記カードメニュー">
        <button type="button" role="tab" aria-selected="${activeTab === "mine"}" class="${activeTab === "mine" ? "active" : ""}" data-memory-action="tab-mine">自分のデッキ</button>
        <button type="button" role="tab" aria-selected="${activeTab === "public"}" class="${activeTab === "public" ? "active" : ""}" data-memory-action="tab-public">みんなのデッキ</button>
      </div>
      ${message ? `<div class="memoryCardsMessage ${messageKind}" role="status">${esc(message)}</div>` : ""}
      ${content}
    </div>`;
}

async function renderMine(): Promise<string> {
  if (editor?.kind === "deck") return renderDeckForm();
  if (selectedDeckId) return renderDeckDetail(selectedDeckId);
  const decks = await memoryDecks();
  const counts = new Map<string, number>();
  await Promise.all(decks.map(async (deck) => counts.set(deck.id, (await cardsFor(deck.id)).length)));
  if (!decks.length) {
    return shell(`
      <div class="memoryCardsEmpty">
        <span>🗂️</span><h3>${esc(activeSubject!.name)}のデッキはまだありません</h3>
        <p>まずデッキを作り、その中に暗記カードを追加しましょう。</p>
        <button type="button" class="btn primary" data-memory-action="new-deck">最初のデッキを作る</button>
      </div>`);
  }
  return shell(`<div class="memoryDeckGrid">${decks.map((deck) => `
    <article class="memoryDeckCard">
      <button type="button" class="memoryDeckOpen" data-memory-action="open-deck" data-deck-id="${esc(deck.id)}">
        <span class="memoryDeckIcon">🗂️</span>
        <span><strong>${esc(deck.name)}</strong><small>${esc(deck.description || "説明なし")}</small></span>
        <b>${counts.get(deck.id) ?? 0}枚</b>
      </button>
      ${deck.originSharedDeckId ? `<span class="memoryOrigin">みんなのデッキから追加</span>` : ""}
    </article>`).join("")}</div>`);
}

function renderDeckForm(): string {
  return shell(`
    <form class="memoryEditor" id="memoryDeckForm">
      <div class="memoryEditorHead"><div><small>NEW DECK</small><h3>新しいデッキ</h3></div><button type="button" class="btn ghost small" data-memory-action="cancel-editor">キャンセル</button></div>
      <label>デッキ名<input name="name" maxlength="80" required placeholder="例：代謝経路の重要語句"></label>
      <label>説明<textarea name="description" maxlength="500" rows="3" placeholder="このデッキで覚える内容"></textarea></label>
      <div class="memoryEditorNote">このデッキは「${esc(activeSubject!.name)}」専用として保存されます。</div>
      <button type="submit" class="btn primary">デッキを保存</button>
    </form>`);
}

async function renderDeckDetail(deckId: string): Promise<string> {
  const deck = await db.decks.get(deckId);
  if (!deck || deck.deletedAt || deck.system !== "memory") {
    selectedDeckId = null;
    return renderMine();
  }
  const cards = await cardsFor(deckId);
  if (editor?.kind === "card") {
    const cardEditor = editor;
    const card = cardEditor.cardId ? cards.find((item) => item.id === cardEditor.cardId) : null;
    return shell(renderCardForm(deck, card ?? null));
  }
  if (studyIndex >= 0 && studyIndex < cards.length && rootNode?.dataset.studyMode === "true") {
    return shell(renderStudy(deck, cards));
  }
  return shell(`
    <div class="memoryDeckDetail">
      <div class="memoryDeckDetailHead">
        <button type="button" class="btn ghost small" data-memory-action="back-decks">← デッキ一覧</button>
        <div class="memoryDeckActions">
          ${deck.originSharedDeckId
            ? `<span class="memoryOrigin">公開デッキから追加したコピー</span>`
            : `<button type="button" class="btn ghost small" data-memory-action="publish-deck" ${publishInFlight ? "disabled" : ""}>${publishInFlight ? "公開処理中…" : "自分のデッキを公開する"}</button>`}
          <button type="button" class="btn danger small" data-memory-action="delete-deck">削除</button>
        </div>
      </div>
      <div class="memoryDeckTitle"><div><span>MY DECK</span><h3>${esc(deck.name)}</h3><p>${esc(deck.description || "説明なし")}</p></div><strong>${cards.length}枚</strong></div>
      <div class="memoryDeckActionRow">
        <button type="button" class="btn primary" data-memory-action="new-card">＋ カードを作成</button>
        <button type="button" class="btn ghost" data-memory-action="study-deck" ${cards.length ? "" : "disabled"}>カードをめくる</button>
      </div>
      ${cards.length ? `<div class="memoryCardList">${cards.map((card, index) => `
        <article class="memoryCardRow">
          <span class="memoryCardNumber">${index + 1}</span>
          <button type="button" class="memoryCardBody" data-memory-action="edit-card" data-card-id="${esc(card.id)}"><strong>${esc(card.front)}</strong><small>${esc(card.back)}</small></button>
          <button type="button" class="memoryCardDelete" aria-label="カードを削除" data-memory-action="delete-card" data-card-id="${esc(card.id)}">✕</button>
        </article>`).join("")}</div>` : `<div class="memoryCardsEmpty compact"><p>カードはまだありません。</p></div>`}
    </div>`);
}

function renderCardForm(deck: Deck, card: StudyCard | null): string {
  return `
    <form class="memoryEditor" id="memoryCardForm" data-card-id="${esc(card?.id || "")}">
      <div class="memoryEditorHead"><div><small>${card ? "EDIT CARD" : "NEW CARD"}</small><h3>${card ? "カードを編集" : "カードを作成"}</h3><p>${esc(deck.name)}</p></div><button type="button" class="btn ghost small" data-memory-action="cancel-editor">キャンセル</button></div>
      <label>表（質問・用語）<textarea name="front" maxlength="2000" rows="3" required>${esc(card?.front || "")}</textarea></label>
      <label>裏（答え）<textarea name="back" maxlength="4000" rows="4" required>${esc(card?.back || "")}</textarea></label>
      <label>補足・解説<textarea name="explanation" maxlength="4000" rows="3">${esc(card?.explanation || "")}</textarea></label>
      <label>タグ（カンマ区切り）<input name="tags" maxlength="300" value="${esc(card?.tags.join(", ") || "")}" placeholder="重要, 試験頻出"></label>
      <button type="submit" class="btn primary">カードを保存</button>
    </form>`;
}

function renderStudy(deck: Deck, cards: StudyCard[]): string {
  const card = cards[studyIndex];
  return `
    <div class="memoryStudy">
      <div class="memoryDeckDetailHead"><button type="button" class="btn ghost small" data-memory-action="stop-study">← ${esc(deck.name)}</button><span>${studyIndex + 1} / ${cards.length}</span></div>
      <button type="button" class="memoryStudyCard ${studyRevealed ? "revealed" : ""}" data-memory-action="reveal-card">
        <small>${studyRevealed ? "答え" : "質問"}</small>
        <strong>${esc(studyRevealed ? card.back : card.front)}</strong>
        ${studyRevealed && card.explanation ? `<p>${esc(card.explanation)}</p>` : ""}
        <span>${studyRevealed ? "もう一度押すと質問へ戻ります" : "押して答えを見る"}</span>
      </button>
      <div class="memoryStudyControls"><button type="button" class="btn ghost" data-memory-action="previous-card" ${studyIndex === 0 ? "disabled" : ""}>← 前へ</button><button type="button" class="btn primary" data-memory-action="next-card">${studyIndex === cards.length - 1 ? "終了" : "次へ →"}</button></div>
    </div>`;
}

async function loadSharedDecks(): Promise<void> {
  if (!activeSubject || !supabase) {
    sharedDecks = [];
    return;
  }
  const { data, error } = await supabase
    .from("shared_memory_decks")
    .select("id,owner_id,subject_id,title,description,version,card_count,published_at")
    .eq("subject_id", activeSubject.id)
    .eq("status", "published")
    .is("deleted_at", null)
    .order("published_at", { ascending: false });
  if (error) throw error;
  sharedDecks = (data ?? []) as SharedDeckRow[];
}

async function loadSharedCards(deckId: string): Promise<void> {
  sharedCards = [];
  if (!supabase) return;
  const { data, error } = await supabase
    .from("shared_memory_cards")
    .select("id,shared_deck_id,origin_card_id,front,back,explanation,tags,position")
    .eq("shared_deck_id", deckId)
    .order("position");
  if (error) throw error;
  sharedCards = (data ?? []) as SharedCardRow[];
}

async function renderPublic(): Promise<string> {
  if (!supabase) {
    return shell(`<div class="memoryCardsEmpty"><span>☁️</span><h3>共有機能は準備中です</h3><p>Supabaseの接続設定後に「みんなのデッキ」を利用できます。自分のデッキは端末内で利用できます。</p></div>`);
  }
  if (selectedSharedDeckId) {
    const deck = sharedDecks.find((item) => item.id === selectedSharedDeckId);
    if (!deck) selectedSharedDeckId = null;
    else return shell(`
      <div class="memoryDeckDetail">
        <div class="memoryDeckDetailHead"><button type="button" class="btn ghost small" data-memory-action="back-public">← みんなのデッキ</button><span>公開版 v${deck.version}</span></div>
        <div class="memoryDeckTitle"><div><span>SHARED DECK</span><h3>${esc(deck.title)}</h3><p>${esc(deck.description || "説明なし")}</p></div><strong>${deck.card_count}枚</strong></div>
        <div class="memoryDeckActionRow"><button type="button" class="btn primary" data-memory-action="import-shared">自分のデッキに追加</button></div>
        <div class="memoryCardList">${sharedCards.map((card, index) => `<article class="memoryCardRow preview"><span class="memoryCardNumber">${index + 1}</span><span class="memoryCardBody"><strong>${esc(card.front)}</strong><small>${esc(card.back)}</small></span></article>`).join("")}</div>
      </div>`);
  }
  return shell(sharedDecks.length ? `<div class="memoryDeckGrid">${sharedDecks.map((deck) => `
    <article class="memoryDeckCard shared">
      <button type="button" class="memoryDeckOpen" data-memory-action="open-shared" data-shared-id="${esc(deck.id)}">
        <span class="memoryDeckIcon">🌐</span><span><strong>${esc(deck.title)}</strong><small>${esc(deck.description || "説明なし")}</small></span><b>${deck.card_count}枚</b>
      </button>
    </article>`).join("")}</div>` : `<div class="memoryCardsEmpty"><span>🌱</span><h3>${esc(activeSubject!.name)}の公開デッキはまだありません</h3><p>自分のデッキを作成し、最初の共有者になれます。</p></div>`);
}

async function repaint(): Promise<void> {
  if (!rootNode || !activeSubject) return;
  rootNode.innerHTML = activeTab === "mine" ? await renderMine() : await renderPublic();
  rootNode.querySelector("#memoryDeckForm")?.addEventListener("submit", (event) => void saveDeckForm(event));
  rootNode.querySelector("#memoryCardForm")?.addEventListener("submit", (event) => void saveCardForm(event));
}

async function saveDeckForm(event: Event): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const name = String(data.get("name") || "").trim();
  if (!name || !activeSubject) return;
  const timestamp = nowIso();
  await saveDeck({
    id: uuid(), ownerId: null, system: "memory", subjectId: activeSubject.id,
    originSharedDeckId: null, originVersion: null, name,
    description: String(data.get("description") || "").trim(), order: await db.decks.count(),
    newCardsPerDay: DEFAULT_NEW_CARDS_PER_DAY, reviewsPerDay: DEFAULT_REVIEWS_PER_DAY,
    desiredRetention: DEFAULT_DESIRED_RETENTION, version: 1,
    createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
  });
  editor = null;
  setMessage(`「${name}」を作成しました。`, "success");
  await repaint();
}

function emptyCard(deckId: string): StudyCard {
  const timestamp = nowIso();
  return {
    id: uuid(), ownerId: null, builtIn: false, kind: "basic", deckId,
    front: "", back: "", choices: [], correctChoiceIndex: null, explanation: "",
    field: activeSubject?.name || "", source: "暗記カード", tags: [], image: null, imageAlt: "",
    version: 1, suspendedAt: null, originDeckId: null, originVersion: null, originCardId: null,
    createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
  };
}

async function saveCardForm(event: Event): Promise<void> {
  event.preventDefault();
  if (!selectedDeckId) return;
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const cardId = form.dataset.cardId;
  const current = cardId ? await db.cards.get(cardId) : emptyCard(selectedDeckId);
  if (!current) return;
  const next: StudyCard = {
    ...current,
    front: String(data.get("front") || "").trim(),
    back: String(data.get("back") || "").trim(),
    explanation: String(data.get("explanation") || "").trim(),
    tags: String(data.get("tags") || "").split(",").map((item) => item.trim()).filter(Boolean),
    version: current.version + (cardId ? 1 : 0), updatedAt: nowIso(),
  };
  if (!next.front || !next.back) return;
  await saveCard(next);
  editor = null;
  setMessage(cardId ? "カードを更新しました。" : "カードを追加しました。", "success");
  await repaint();
}

async function publishSelectedDeck(): Promise<void> {
  if (!selectedDeckId || !activeSubject || publishInFlight) return;
  if (!supabase) {
    setMessage("共有機能の接続設定がありません。自分のデッキはそのまま利用できます。", "error");
    return repaint();
  }
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    setMessage("デッキを公開するには「設定・データ」からログインしてください。", "error");
    return repaint();
  }
  const deck = await db.decks.get(selectedDeckId);
  const cards = await cardsFor(selectedDeckId);
  if (!deck || !cards.length) {
    setMessage("公開するにはカードを1枚以上追加してください。", "error");
    return repaint();
  }
  publishInFlight = true;
  setMessage("公開処理中です…");
  await repaint();
  try {
    const { data: version, error } = await supabase.rpc("publish_memory_deck", {
      p_deck_id: deck.id,
      p_subject_id: activeSubject.id,
      p_title: deck.name,
      p_description: deck.description,
      p_cards: cards.map((card) => ({
        origin_card_id: card.id,
        front: card.front,
        back: card.back,
        explanation: card.explanation,
        tags: card.tags,
      })),
    });
    if (error) throw error;
    setMessage(`「${deck.name}」をみんなのデッキへ公開しました（v${Number(version)}）。`, "success");
  } finally {
    publishInFlight = false;
  }
  await repaint();
}

async function importSelectedSharedDeck(): Promise<void> {
  if (!selectedSharedDeckId || !activeSubject) return;
  const shared = sharedDecks.find((item) => item.id === selectedSharedDeckId);
  if (!shared) return;
  const duplicate = await db.decks.filter((deck) => deck.originSharedDeckId === shared.id && !deck.deletedAt).first();
  if (duplicate) {
    setMessage("この公開デッキはすでに自分のデッキへ追加されています。", "error");
    return repaint();
  }
  if (sharedCards.length !== shared.card_count) {
    setMessage("公開デッキのカードを完全に取得できませんでした。もう一度開き直してください。", "error");
    return repaint();
  }
  const timestamp = nowIso();
  const localDeckId = uuid();
  await db.transaction("rw", db.decks, db.cards, db.outbox, async () => {
    await saveDeck({
      id: localDeckId, ownerId: null, system: "memory", subjectId: activeSubject!.id,
      originSharedDeckId: shared.id, originVersion: shared.version,
      name: shared.title, description: shared.description, order: await db.decks.count(),
      newCardsPerDay: DEFAULT_NEW_CARDS_PER_DAY, reviewsPerDay: DEFAULT_REVIEWS_PER_DAY,
      desiredRetention: DEFAULT_DESIRED_RETENTION, version: 1,
      createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
    });
    for (const row of sharedCards) {
      await saveCard({
        id: uuid(), ownerId: null, builtIn: false, kind: "basic", deckId: localDeckId,
        front: row.front, back: row.back, choices: [], correctChoiceIndex: null,
        explanation: row.explanation, field: activeSubject!.name, source: `みんなのデッキ: ${shared.title}`,
        tags: row.tags, image: null, imageAlt: "", version: 1, suspendedAt: null,
        originDeckId: shared.id, originVersion: shared.version, originCardId: row.origin_card_id,
        createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
      });
    }
  });
  activeTab = "mine";
  selectedSharedDeckId = null;
  selectedDeckId = localDeckId;
  setMessage(`「${shared.title}」を自分のデッキへ追加しました。`, "success");
  await repaint();
}

async function handleAction(target: HTMLElement): Promise<void> {
  const action = target.dataset.memoryAction;
  message = "";
  if (action === "tab-mine") { activeTab = "mine"; selectedSharedDeckId = null; editor = null; }
  if (action === "tab-public") {
    activeTab = "public"; selectedDeckId = null; editor = null;
    try { await loadSharedDecks(); } catch (error) { setMessage(`共有デッキを取得できません: ${error instanceof Error ? error.message : String(error)}`, "error"); }
  }
  if (action === "new-deck") { activeTab = "mine"; selectedDeckId = null; editor = { kind: "deck" }; }
  if (action === "cancel-editor") editor = null;
  if (action === "open-deck") selectedDeckId = target.dataset.deckId || null;
  if (action === "back-decks") { selectedDeckId = null; editor = null; }
  if (action === "new-card") editor = { kind: "card", cardId: null };
  if (action === "edit-card") editor = { kind: "card", cardId: target.dataset.cardId || null };
  if (action === "delete-card" && target.dataset.cardId && confirm("このカードを削除しますか？")) {
    const card = await db.cards.get(target.dataset.cardId);
    if (card) await saveCard({ ...card, deletedAt: nowIso(), updatedAt: nowIso(), version: card.version + 1 });
  }
  if (action === "delete-deck" && selectedDeckId && confirm("このデッキと中のカードを削除しますか？")) {
    const deck = await db.decks.get(selectedDeckId);
    if (deck) {
      for (const card of await cardsFor(deck.id)) await saveCard({ ...card, deletedAt: nowIso(), updatedAt: nowIso(), version: card.version + 1 });
      await saveDeck({ ...deck, deletedAt: nowIso(), updatedAt: nowIso(), version: deck.version + 1 });
      selectedDeckId = null;
      setMessage("デッキを削除しました。", "success");
    }
  }
  if (action === "publish-deck") {
    if (!confirm(`「${(await db.decks.get(selectedDeckId || ""))?.name || "このデッキ"}」を同じ科目のみんなのデッキへ公開しますか？`)) return;
    try { await publishSelectedDeck(); } catch (error) { setMessage(`公開できませんでした: ${error instanceof Error ? error.message : String(error)}`, "error"); await repaint(); }
    return;
  }
  if (action === "open-shared" && target.dataset.sharedId) {
    const sharedDeckId = target.dataset.sharedId;
    try {
      await loadSharedCards(sharedDeckId);
      selectedSharedDeckId = sharedDeckId;
    } catch (error) {
      selectedSharedDeckId = null;
      setMessage(`カードを取得できません: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }
  if (action === "back-public") selectedSharedDeckId = null;
  if (action === "import-shared") { await importSelectedSharedDeck(); return; }
  if (action === "study-deck" && rootNode) { rootNode.dataset.studyMode = "true"; studyIndex = 0; studyRevealed = false; }
  if (action === "stop-study" && rootNode) rootNode.dataset.studyMode = "false";
  if (action === "reveal-card") studyRevealed = !studyRevealed;
  if (action === "previous-card") { studyIndex = Math.max(0, studyIndex - 1); studyRevealed = false; }
  if (action === "next-card" && selectedDeckId) {
    const cards = await cardsFor(selectedDeckId);
    if (studyIndex >= cards.length - 1) { if (rootNode) rootNode.dataset.studyMode = "false"; studyIndex = 0; }
    else { studyIndex += 1; studyRevealed = false; }
  }
  await repaint();
}

export async function renderMemoryCards(root: HTMLElement, subject: MemoryCardSubject): Promise<void> {
  rootNode = root;
  if (activeSubject?.id !== subject.id) {
    activeSubject = subject;
    activeTab = "mine";
    selectedDeckId = null;
    selectedSharedDeckId = null;
    editor = null;
    message = "";
    root.dataset.studyMode = "false";
  } else {
    activeSubject = subject;
  }
  if (!root.dataset.memoryBound) {
    root.dataset.memoryBound = "true";
    root.addEventListener("click", (event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-memory-action]") : null;
      if (target) void handleAction(target);
    });
  }
  await repaint();
}
