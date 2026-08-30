import type { AccountState, StudyCard, SyncStatus, WrittenAttempt, WrittenDraft } from "./types";
import type { StoredSchedule } from "./types";
import type { SaveAttemptInput } from "./written";
import type { LeaderboardView } from "./leaderboard";
import type { BoardRow, PostRow } from "./community";
import type { SyncPayload } from "./datasync";
import type { CardHomeSnapshot } from "./card-home";

declare global {
  interface Window {
    QUIZ_DATA?: Array<Record<string, unknown>>;
    TERM_CARDS?: Array<Record<string, unknown>>;
    __CUSTOM_TERM_CARDS?: Array<Record<string, unknown>>;
    /** 科目に同梱する公式の暗記デッキ（subjects.js の memoryDecks で読み込む）。 */
    MEMORY_DECKS?: Array<{
      id: string;
      subjectId: string;
      folder?: string;
      title: string;
      description?: string;
      cards: Array<{ id: string; front: string; back: string; explanation?: string; tags?: string[] }>;
    }>;
    __legacyAppRefresh?: () => void;
    STUDY_CORE?: {
      ui: {
        learningDestination: (mode: unknown) => "cardsView" | "inputView";
        primaryNavKey: (screenId: string) => "home" | "learn" | "practice" | "questions" | "search" | "review" | null;
      };
      scheduleReview: (progress: Record<string, unknown>, rating: 1 | 2 | 3 | 4, cardId: string) => Record<string, unknown>;
      refreshCustomCards: () => Promise<void>;
      saveLegacyProgress: (progress: Record<string, unknown>) => void;
      openCardManager: () => Promise<void>;
      cardHome: {
        snapshot: () => Promise<CardHomeSnapshot>;
      };
      memoryCards: {
        render: (root: HTMLElement, subject: { id: string; name: string; emoji?: string }) => Promise<void>;
      };
      syncNow: () => Promise<SyncStatus>;
      account: {
        state: () => AccountState;
        refresh: () => Promise<AccountState>;
        consumeCallback: () => Promise<string | null>;
        signIn: (provider: "google") => Promise<void>;
        link: (provider: "google") => Promise<void>;
        syncStatus: () => Promise<SyncStatus>;
        setMigrating: (active: boolean) => AccountState;
        entryChoice: () => "login" | "guest" | null;
        chooseEntry: (choice: "login" | "guest") => void;
        signOut: () => Promise<void>;
        deleteAccount: () => Promise<void>;
        bindCurrent: () => Promise<AccountState>;
        syncIdentity: (fallbackName?: string) => Promise<{ ok: boolean; error?: string }>;
        resolveSwitch: (action: "replace" | "cancel") => Promise<AccountState>;
      };
      undoLastReview: (cardId: string) => Promise<StoredSchedule | null>;
      memory: {
        retrievability: (progress: Record<string, unknown>, atMs?: number) => number | null;
        curve: (progress: Record<string, unknown>, dayOffsets: number[]) => (number | null)[];
        examGain: (progress: Record<string, unknown>, examMs: number) => number;
      };
      leaderboard: {
        enabled: () => boolean;
        hasJoined: () => boolean;
        savedName: () => string;
        join: (rawName: string, solved: number, subject?: string, deviceSolved?: number) => Promise<{ ok: boolean; error?: string }>;
        publish: (solved: number, force?: boolean, subject?: string, deviceSolved?: number) => Promise<void>;
        fetch: () => Promise<LeaderboardView | null>;
        leave: () => Promise<void>;
      };
      community: {
        enabled: () => boolean;
        getName: () => string;
        setName: (raw: string) => string;
        hasName: () => boolean;
        listBoards: () => Promise<BoardRow[]>;
        createBoard: (title: string, description: string) => Promise<{ ok: boolean; id?: string; error?: string }>;
        deleteMyBoard: (boardId: string) => Promise<void>;
        listPosts: (boardId: string) => Promise<PostRow[]>;
        createPost: (boardId: string, body: string) => Promise<{ ok: boolean; error?: string }>;
        deleteMyPost: (postId: string) => Promise<void>;
        reportPost: (postId: string) => Promise<void>;
        reportBoard: (boardId: string) => Promise<void>;
        isAdminMode: () => boolean;
        enableAdmin: (token: string) => Promise<boolean>;
        disableAdmin: () => void;
        adminDeletePost: (postId: string) => Promise<void>;
        adminDeleteBoard: (boardId: string) => Promise<void>;
        unreadCount: () => number;
        refreshUnread: () => Promise<number>;
        markBoardSeen: (boardId: string, postCount: number) => void;
        markAllSeen: () => void;
        seenCountFor: (boardId: string) => number;
      };
      writtenAttempts: {
        saveAttempt: (input: SaveAttemptInput) => Promise<WrittenAttempt>;
        updateAttempt: (
          id: string,
          patch: { selectedRubricIds?: string[]; earnedPoints?: number | null; rating?: 1 | 2 | 3 | 4 | null; status?: "submitted" | "graded" },
        ) => Promise<WrittenAttempt | null>;
        getAttempt: (id: string) => Promise<WrittenAttempt | null>;
        listByQuestion: (questionId: string) => Promise<WrittenAttempt[]>;
        listPendingExamAttempts: () => Promise<WrittenAttempt[]>;
        saveDraft: (input: {
          subjectId: string;
          questionId: string;
          examSessionId?: string | null;
          mode?: "practice" | "exam";
          answers: Record<string, unknown>;
        }) => Promise<void>;
        getDraft: (questionId: string, examSessionId?: string | null) => Promise<WrittenDraft | null>;
        deleteDraft: (questionId: string, examSessionId?: string | null) => Promise<void>;
        deleteDraftsForSession: (examSessionId: string) => Promise<void>;
        exportAll: () => Promise<WrittenAttempt[]>;
        importMany: (rows: unknown[], options?: { replace?: boolean }) => Promise<{ imported: number; skipped: number }>;
        deleteAll: () => Promise<void>;
      };
      datasync: {
        enabled: () => boolean;
        getCode: () => string;
        isLinked: () => boolean;
        lastSyncedAt: () => string;
        formatCode: (code: string) => string;
        normalizeCode: (raw: string) => string;
        createCode: (payload: SyncPayload) => Promise<{ ok: boolean; code?: string; error?: string }>;
        link: (code: string) => Promise<{ ok: boolean; payload?: SyncPayload; error?: string }>;
        pull: (code: string) => Promise<{ ok: boolean; payload?: SyncPayload; error?: string }>;
        push: (code: string, payload: SyncPayload) => Promise<{ ok: boolean; error?: string }>;
        unlink: () => void;
        deleteRemote: (code: string) => Promise<void>;
        /** 記述問題の答案履歴だけを差分同期する（1MBスナップショットとは独立） */
        syncWritten: (code: string) => Promise<{ ok: boolean; pulled: number; pushed: number; error?: string }>;
        pullAccount: () => Promise<{ ok: boolean; snapshot?: { payload: SyncPayload; version: number; updatedAt: string | null }; error?: string }>;
        pushAccount: (payload: SyncPayload, expectedVersion: number) => Promise<{ ok: boolean; version?: number; conflict?: boolean; error?: string }>;
        claimCode: (code: string) => Promise<{ ok: boolean; payload?: SyncPayload; retired?: boolean; missing?: boolean; error?: string }>;
        completeCodeMigration: (code: string) => Promise<{ ok: boolean; error?: string }>;
        importWrittenFromCode: (code: string) => Promise<{ ok: boolean; pulled: number; error?: string }>;
        syncAccountWritten: (userId: string) => Promise<{ ok: boolean; pulled: number; pushed: number; error?: string }>;
        syncAccountSnapshot: (
          getLocalPayload: () => SyncPayload,
          mergeRemotePayload: (payload: SyncPayload) => void,
        ) => Promise<{ ok: boolean; attempts: number; error?: string }>;
        syncAccountData: (
          legacyCode: string,
          operations: {
            claimLegacyCode: (code: string) => Promise<{ ok: boolean; payload?: SyncPayload; missing?: boolean; error?: string }>;
            mergeLegacyPayload: (payload: SyncPayload) => void;
            importLegacyWritten: (code: string) => Promise<{ ok: boolean; error?: string }>;
            syncIdentity?: () => Promise<{ ok: boolean; error?: string }>;
            syncSnapshot: () => Promise<{ ok: boolean; error?: string }>;
            syncWritten: () => Promise<{ ok: boolean; error?: string }>;
            syncCards: () => Promise<{ error?: string | null }>;
            completeLegacyMigration: (code: string) => Promise<{ ok: boolean; error?: string }>;
            unlinkLegacyCode: () => void;
          },
        ) => Promise<{
          ok: boolean;
          migratedLegacy: boolean;
          legacyPending: boolean;
          error?: string;
          legacyError?: string;
        }>;
      };
    };
    __STUDY_CARDS?: StudyCard[];
  }
}

export {};
