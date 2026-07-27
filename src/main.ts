import "./modern.css";
import { registerSW } from "virtual:pwa-register";
import { installCardManager, openCardManager } from "./card-manager";
import { migrateLegacyStorage, mirrorCustomCardsToLegacy } from "./migration";
import { mirrorSchedulesToLegacy, queueLegacyStateSave, reconcileLegacyAfterSync } from "./legacy-bridge";
import { examGain, retrievabilityAt, retrievabilityCurve, scheduleReview, undoLastReview } from "./fsrs";
import { startAutomaticSync, syncNow } from "./sync";
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
  deleteRemote,
  formatCode,
  getLastSyncedAt,
  getSyncCode,
  isLinked,
  link,
  normalizeCode,
  pull,
  push,
  syncEnabled,
  unlink,
} from "./datasync";
import type { LegacyProgress, ReviewRating } from "./types";

async function bootstrap(): Promise<void> {
  await migrateLegacyStorage();
  await mirrorCustomCardsToLegacy();
  await mirrorSchedulesToLegacy(); // ホームの復習予定を Dexie/FSRS と一致させる
  await installCardManager();
  startAutomaticSync();
}

// 同期完了ごとに、取り込んだ復習予定・学習状態を旧UI(localStorage)へ反映する
window.addEventListener("study:sync-changed", () => void reconcileLegacyAfterSync());

window.STUDY_CORE = {
  scheduleReview: (progress, rating, cardId) => scheduleReview(cardId, progress as LegacyProgress, rating as ReviewRating) as Record<string, unknown>,
  refreshCustomCards: mirrorCustomCardsToLegacy,
  saveLegacyProgress: (progress) => queueLegacyStateSave(progress as Record<string, LegacyProgress>),
  openCardManager,
  syncNow,
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
