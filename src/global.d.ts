import type { StudyCard, SyncStatus } from "./types";
import type { StoredSchedule } from "./types";

declare global {
  interface Window {
    QUIZ_DATA?: Array<Record<string, unknown>>;
    TERM_CARDS?: Array<Record<string, unknown>>;
    __CUSTOM_TERM_CARDS?: Array<Record<string, unknown>>;
    __legacyAppRefresh?: () => void;
    STUDY_CORE?: {
      scheduleReview: (progress: Record<string, unknown>, rating: 1 | 2 | 3 | 4, cardId: string) => Record<string, unknown>;
      refreshCustomCards: () => Promise<void>;
      saveLegacyProgress: (progress: Record<string, unknown>) => void;
      openCardManager: () => Promise<void>;
      syncNow: () => Promise<SyncStatus>;
      undoLastReview: (cardId: string) => Promise<StoredSchedule | null>;
    };
    __STUDY_CARDS?: StudyCard[];
  }
}

export {};
