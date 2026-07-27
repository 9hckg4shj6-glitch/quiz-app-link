export type CardKind = "basic" | "multiple-choice" | "term";
export type ReviewRating = 1 | 2 | 3 | 4;

/* ============================================================
   問題データ（public/subjects/<id>/questions.js）の形
   ------------------------------------------------------------
   選択問題は歴史的に type を持たない。type:"constructed" が付いた
   ものだけ記述問題として扱う（後方互換のため既存データは無変更）。
   仕様: IMMUNOLOGY_WRITTEN_QUESTION_IMPLEMENTATION_PLAN.md §5
   ※ index.html（素のJS）と scripts/validate-content.mjs が
      実際の読み手なので、ここは形の唯一の記述として置いている。
   ============================================================ */

export type QuestionType = "choice" | "constructed";
export type ConstructedPartKind = "short-text" | "long-text" | "numeric" | "drawing";

export interface SlideReference {
  deck: string;
  name: string;
  pages: number[];
}

export interface BaseResponsePart {
  id: string;
  kind: ConstructedPartKind;
  label: string;
  prompt?: string;
  /** 省略時は true */
  required?: boolean;
}

export interface ShortTextPart extends BaseResponsePart {
  kind: "short-text";
  /** 正規化後の完全一致でのみ仮正解。同義語はここに明示的に列挙する */
  acceptedAnswers: string[];
  placeholder?: string;
}

export interface LongTextPart extends BaseResponsePart {
  kind: "long-text";
  /** 「指定語句」。出現の有無を色分けするだけで、正誤は決めない */
  requiredTerms?: string[];
  placeholder?: string;
  /** 省略時 6 */
  rows?: number;
}

export interface NumericPart extends BaseResponsePart {
  kind: "numeric";
  expectedValue: number;
  absoluteTolerance?: number;
  relativeTolerance?: number;
  acceptedUnits: string[];
  placeholder?: string;
}

export interface DrawingPart extends BaseResponsePart {
  kind: "drawing";
  /** 既存図への描き込み問題で使う下敷き */
  backgroundImage?: string | null;
  backgroundImageAlt?: string;
  modelImage: string;
  modelImageAlt: string;
  /** 幅 / 高さ。省略時 4 / 3 */
  aspectRatio?: number;
  /** 「紙に描く」を許すか。免疫編では true */
  paperAllowed?: boolean;
}

export type ResponsePart = ShortTextPart | LongTextPart | NumericPart | DrawingPart;

export type RubricAutoCheck =
  | { kind: "short-match"; partId: string }
  | { kind: "numeric-match"; partId: string }
  | { kind: "terms-present"; partId: string; terms: string[]; mode: "all" | "any" };

export interface RubricCriterion {
  id: string;
  partIds: string[];
  text: string;
  points: number;
  /** 初期チェックの補助。学習者が必ず修正できる。作図は自動判定しない */
  autoCheck?: RubricAutoCheck;
}

export interface ConstructedQuestion {
  id: string;
  type: "constructed";
  year: string;
  category: string;
  field: string;
  question: string;
  points: number;
  responseParts: ResponsePart[];
  rubric: RubricCriterion[];
  /** 公式の採点細目か、学習用に分解したものか。画面に明示する */
  rubricSource: "official" | "derived";
  modelAnswer: string;
  explanation: string;
  image?: string | null;
  imageAlt?: string;
  explainImage?: string | null;
  explainImageAlt?: string;
  slideRefs?: SlideReference[] | null;
}

export interface StudyCard {
  id: string;
  ownerId: string | null;
  builtIn: boolean;
  kind: CardKind;
  deckId: string;
  front: string;
  back: string;
  choices: string[];
  correctChoiceIndex: number | null;
  explanation: string;
  field: string;
  source: string;
  tags: string[];
  image: string | null;
  imageAlt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Deck {
  id: string;
  ownerId: string | null;
  name: string;
  description: string;
  order: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ReviewEvent {
  id: string;
  ownerId: string | null;
  cardId: string;
  deviceId: string;
  rating: ReviewRating;
  reviewedAt: string;
  durationMs: number | null;
  syncedAt: string | null;
}

export interface StoredSchedule {
  cardId: string;
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: string | null;
  updatedAt: string;
}

export type SyncTable = "cards" | "decks" | "review_events" | "settings";

export interface OutboxRecord {
  seq?: number;
  operationId: string;
  table: SyncTable;
  recordId: string;
  operation: "upsert" | "delete";
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  status: "pending" | "syncing" | "failed";
  lastError: string | null;
}

export interface SettingRecord {
  key: string;
  ownerId: string | null;
  value: unknown;
  updatedAt: string;
}

export interface LegacyProgress {
  seen?: number;
  correct?: number;
  wrong?: number;
  streak?: number;
  weak?: boolean;
  bookmarked?: boolean;
  reps?: number;
  interval?: number;
  ease?: number;
  due?: string;
  lastReviewed?: string;
  lastWrong?: string;
  fsrs?: StoredSchedule;
}

export interface SyncStatus {
  enabled: boolean;
  online: boolean;
  userEmail: string | null;
  pending: number;
  lastSyncedAt: string | null;
  error: string | null;
}
