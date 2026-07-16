import type { StudyCard, SyncStatus } from "./types";
import type { StoredSchedule } from "./types";
import type { LeaderboardView } from "./leaderboard";
import type { BoardRow, PostRow } from "./community";
import type { SyncPayload } from "./datasync";

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
      leaderboard: {
        enabled: () => boolean;
        hasJoined: () => boolean;
        savedName: () => string;
        join: (rawName: string, solved: number) => Promise<{ ok: boolean; error?: string }>;
        publish: (solved: number, force?: boolean) => Promise<void>;
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
      };
    };
    __STUDY_CARDS?: StudyCard[];
  }
}

export {};
