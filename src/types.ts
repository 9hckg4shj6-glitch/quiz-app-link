export type CardKind = "basic" | "multiple-choice" | "term";
export type ReviewRating = 1 | 2 | 3 | 4;

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
