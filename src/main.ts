import "./modern.css";
import { registerSW } from "virtual:pwa-register";
import { installCardManager, openCardManager } from "./card-manager";
import { migrateLegacyStorage, mirrorCustomCardsToLegacy } from "./migration";
import { mirrorSchedulesToLegacy, queueLegacyStateSave, reconcileLegacyAfterSync } from "./legacy-bridge";
import { examGain, retrievabilityAt, retrievabilityCurve, scheduleReview, undoLastReview } from "./fsrs";
import {
  clearPrivateStudyDataForAccountSwitch,
  deleteAccount,
  getSyncStatus,
  startAutomaticSync,
  syncNow,
} from "./sync";
import {
  bindCurrentAccount,
  consumeAuthCallbackMessage,
  getCachedAccountState,
  linkProvider,
  refreshAccountState,
  resolveAccountSwitch,
  setAccountMigrationState,
  signInWithProvider,
  signOutAccount,
  startAccountAuth,
} from "./account-auth";
import {
  fetchLeaderboard,
  getSavedName,
  hasJoined,
  joinLeaderboard,
  leaderboardEnabled,
  leaveLeaderboard,
  publishScore,
} from "./leaderboard";
import {
  adminDeleteBoard,
  adminDeletePost,
  communityEnabled,
  createBoard,
  createPost,
  deleteMyBoard,
  deleteMyPost,
  disableAdmin,
  enableAdmin,
  getName,
  hasName,
  isAdminMode,
  listBoards,
  listPosts,
  markAllSeen,
  markBoardSeen,
  refreshUnread,
  seenCountFor,
  unreadCount,
  reportBoard,
  reportPost,
  setName,
} from "./community";
import {
  createCode,
  claimSyncCode,
  completeSyncCodeMigration,
  deleteRemote,
  formatCode,
  getLastSyncedAt,
  getAccountWrittenCursor,
  getSyncCode,
  getWrittenCursor,
  isLinked,
  link,
  normalizeCode,
  pull,
  pullAccountSnapshot,
  pullAccountWrittenAttempts,
  pullWrittenAttempts,
  push,
  pushAccountSnapshot,
  pushAccountWrittenAttempts,
  pushWrittenAttempts,
  setWrittenCursor,
  setAccountWrittenCursor,
  syncEnabled,
  unlink,
} from "./datasync";
import {
  deleteAll as deleteAllWritten,
  deleteDraft,
  deleteDraftsForSession,
  exportAll as exportWrittenAttempts,
  getAttempt,
  getDraft,
  importMany as importWrittenAttempts,
  listByQuestion,
  listPendingExamAttempts,
  listUnsynced as listUnsyncedWritten,
  markSynced as markWrittenSynced,
  saveAttempt,
  saveDraft,
  updateAttempt,
  upsertFromRemote as upsertWrittenFromRemote,
} from "./written";
import { learningDestination, primaryNavKey } from "./navigation";
import { syncAccountData, syncSnapshotWithRetry } from "./account-sync";
import { getAccountEntryChoice, saveAccountEntryChoice } from "./account-choice";
import { getCardHomeSnapshot } from "./card-home";
import { renderMemoryCards } from "./memory-cards";
import { syncAccountIdentity } from "./account-profile";
import type { LegacyProgress, ReviewRating } from "./types";

async function bootstrap(): Promise<void> {
  await migrateLegacyStorage();
  await mirrorCustomCardsToLegacy();
  await mirrorSchedulesToLegacy(); // ホームの復習予定を Dexie/FSRS と一致させる
  await installCardManager();
  startAccountAuth();
  startAutomaticSync();
}

// 同期完了ごとに、取り込んだ復習予定・学習状態を旧UI(localStorage)へ反映する
window.addEventListener("study:sync-changed", () => void reconcileLegacyAfterSync());

/**
 * 記述問題の答案履歴だけを差分同期する（仕様書 §11.4）。
 * pull（カーソルから0件になるまで）→ ローカルへupsert → 未送信分をpush、の順。
 * 既存の progress/meta スナップショットとは独立に動く。
 */
async function syncWrittenAttempts(code: string): Promise<{ ok: boolean; pulled: number; pushed: number; error?: string }> {
  let pulled = 0;
  let cursor = getWrittenCursor(code);
  for (let page = 0; page < 10_000; page += 1) {
    const result = await pullWrittenAttempts(code, cursor);
    if (!result.ok) return { ok: false, pulled, pushed: 0, error: result.error };
    const rows = result.rows ?? [];
    if (result.cursor) cursor = result.cursor;
    if (!rows.length) break;
    pulled += await upsertWrittenFromRemote(rows);
    setWrittenCursor(code, cursor);
    if (rows.length < 100) break;
  }
  setWrittenCursor(code, cursor);

  const unsynced = await listUnsyncedWritten();
  if (!unsynced.length) return { ok: true, pulled, pushed: 0 };
  const pushResult = await pushWrittenAttempts(code, unsynced as unknown as Array<Record<string, unknown>>);
  await markWrittenSynced(pushResult.sentIds);
  if (!pushResult.ok) return { ok: false, pulled, pushed: pushResult.sentIds.length, error: pushResult.error };
  return { ok: true, pulled, pushed: pushResult.sentIds.length };
}

/** 旧コードの答案をローカルへ取り込むだけ。アカウントへ保存できるまでコード側は変更しない。 */
async function importWrittenAttemptsFromCode(code: string): Promise<{ ok: boolean; pulled: number; error?: string }> {
  let pulled = 0;
  let cursor = { after: null as string | null, afterId: null as string | null };
  for (let page = 0; page < 10_000; page += 1) {
    const result = await pullWrittenAttempts(code, cursor);
    if (!result.ok) return { ok: false, pulled, error: result.error };
    const rows = result.rows ?? [];
    if (result.cursor) cursor = result.cursor;
    if (!rows.length) break;
    pulled += await upsertWrittenFromRemote(rows);
    if (rows.length < 100) break;
  }
  return { ok: true, pulled };
}

async function syncAccountWrittenAttempts(userId: string): Promise<{ ok: boolean; pulled: number; pushed: number; error?: string }> {
  let pulled = 0;
  let cursor = getAccountWrittenCursor(userId);
  for (let page = 0; page < 10_000; page += 1) {
    const result = await pullAccountWrittenAttempts(cursor);
    if (!result.ok) return { ok: false, pulled, pushed: 0, error: result.error };
    const rows = result.rows ?? [];
    if (result.cursor) cursor = result.cursor;
    if (!rows.length) break;
    pulled += await upsertWrittenFromRemote(rows);
    setAccountWrittenCursor(userId, cursor);
    if (rows.length < 100) break;
  }
  setAccountWrittenCursor(userId, cursor);
  const unsynced = await listUnsyncedWritten();
  if (!unsynced.length) return { ok: true, pulled, pushed: 0 };
  const pushed = await pushAccountWrittenAttempts(unsynced as unknown as Array<Record<string, unknown>>);
  await markWrittenSynced(pushed.sentIds);
  if (!pushed.ok) return { ok: false, pulled, pushed: pushed.sentIds.length, error: pushed.error };
  return { ok: true, pulled, pushed: pushed.sentIds.length };
}

window.STUDY_CORE = {
  ui: {
    learningDestination,
    primaryNavKey,
  },
  scheduleReview: (progress, rating, cardId) => scheduleReview(cardId, progress as LegacyProgress, rating as ReviewRating) as Record<string, unknown>,
  refreshCustomCards: mirrorCustomCardsToLegacy,
  saveLegacyProgress: (progress) => queueLegacyStateSave(progress as Record<string, LegacyProgress>),
  openCardManager,
  cardHome: {
    snapshot: getCardHomeSnapshot,
  },
  memoryCards: {
    render: renderMemoryCards,
  },
  syncNow,
  account: {
    state: getCachedAccountState,
    refresh: refreshAccountState,
    consumeCallback: consumeAuthCallbackMessage,
    signIn: signInWithProvider,
    link: linkProvider,
    syncStatus: getSyncStatus,
    setMigrating: setAccountMigrationState,
    entryChoice: getAccountEntryChoice,
    chooseEntry: saveAccountEntryChoice,
    signOut: signOutAccount,
    deleteAccount,
    bindCurrent: bindCurrentAccount,
    syncIdentity: syncAccountIdentity,
    resolveSwitch: async (action: "replace" | "cancel") => {
      if (action === "replace") await clearPrivateStudyDataForAccountSwitch();
      return resolveAccountSwitch(action);
    },
  },
  undoLastReview,
  memory: {
    retrievability: (progress, atMs) =>
      retrievabilityAt(progress as LegacyProgress, atMs == null ? new Date() : new Date(atMs)),
    curve: (progress, dayOffsets) => retrievabilityCurve(progress as LegacyProgress, dayOffsets),
    examGain: (progress, examMs) => examGain(progress as LegacyProgress, new Date(examMs)),
  },
  leaderboard: {
    enabled: leaderboardEnabled,
    hasJoined,
    savedName: getSavedName,
    join: joinLeaderboard,
    publish: publishScore,
    fetch: fetchLeaderboard,
    leave: leaveLeaderboard,
  },
  community: {
    enabled: communityEnabled,
    getName,
    setName,
    hasName,
    listBoards,
    createBoard,
    deleteMyBoard,
    listPosts,
    createPost,
    deleteMyPost,
    reportPost,
    reportBoard,
    isAdminMode,
    enableAdmin,
    disableAdmin,
    adminDeletePost,
    adminDeleteBoard,
    unreadCount,
    refreshUnread,
    markBoardSeen,
    markAllSeen,
    seenCountFor,
  },
  // 記述問題の答案履歴。index.html は Dexie を直接触らず、ここだけを使う（仕様書 §10.4）
  writtenAttempts: {
    saveAttempt,
    updateAttempt,
    getAttempt,
    listByQuestion,
    listPendingExamAttempts,
    saveDraft,
    getDraft,
    deleteDraft,
    deleteDraftsForSession,
    exportAll: exportWrittenAttempts,
    importMany: importWrittenAttempts,
    deleteAll: deleteAllWritten,
  },
  datasync: {
    enabled: syncEnabled,
    getCode: getSyncCode,
    isLinked,
    lastSyncedAt: getLastSyncedAt,
    formatCode,
    normalizeCode,
    createCode,
    link,
    pull,
    push,
    unlink,
    deleteRemote,
    syncWritten: syncWrittenAttempts,
    pullAccount: pullAccountSnapshot,
    pushAccount: pushAccountSnapshot,
    claimCode: claimSyncCode,
    completeCodeMigration: completeSyncCodeMigration,
    importWrittenFromCode: importWrittenAttemptsFromCode,
    syncAccountWritten: syncAccountWrittenAttempts,
    syncAccountSnapshot: syncSnapshotWithRetry,
    syncAccountData,
  },
};

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    // 短時間に何度も叩かないよう最低30秒はあける（タブ切り替えのたびに走るため）。
    const MIN_GAP = 30 * 1000;
    let lastCheck = Date.now();
    const check = () => {
      if (!navigator.onLine) return;
      const now = Date.now();
      if (now - lastCheck < MIN_GAP) return;
      lastCheck = now;
      void registration.update();
    };
    // 開きっぱなしのPWAも更新を取りこぼさないよう、オンライン時に定期確認する。
    window.setInterval(check, 60 * 60 * 1000);
    // スマホでは「ホームに戻す→また開く」がほとんどで、その場合ページは再読み込み
    // されない。定期確認だけだと最大1時間、古い内容（更新履歴など）が出たままになるので、
    // 画面がふたたび見えたときと、回線が戻ったときにも確認する。
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
    window.addEventListener("online", check);
  },
  onRegisterError(error) {
    console.error("アプリの自動更新を登録できませんでした", error);
  },
});

void bootstrap().catch((error) => {
  console.error("学習データ基盤の初期化に失敗しました", error);
  document.documentElement.dataset.studyInitError = "1";
});
