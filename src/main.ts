import "./modern.css";
import { registerSW } from "virtual:pwa-register";
import { installCardManager, openCardManager } from "./card-manager";
import { migrateLegacyStorage, mirrorCustomCardsToLegacy } from "./migration";
import { mirrorSchedulesToLegacy, queueLegacyStateSave, reconcileLegacyAfterSync } from "./legacy-bridge";
import { scheduleReview, undoLastReview } from "./fsrs";
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
  leaderboard: {
    enabled: leaderboardEnabled,
    hasJoined,
    savedName: getSavedName,
    join: joinLeaderboard,
    publish: publishScore,
    fetch: fetchLeaderboard,
    leave: leaveLeaderboard,
  },
};

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    // 開きっぱなしのPWAも更新を取りこぼさないよう、オンライン時に定期確認する。
    window.setInterval(() => {
      if (navigator.onLine) void registration.update();
    }, 60 * 60 * 1000);
  },
  onRegisterError(error) {
    console.error("アプリの自動更新を登録できませんでした", error);
  },
});

void bootstrap().catch((error) => {
  console.error("学習データ基盤の初期化に失敗しました", error);
  document.documentElement.dataset.studyInitError = "1";
});
