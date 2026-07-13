import "./modern.css";
import { registerSW } from "virtual:pwa-register";
import { installCardManager, openCardManager } from "./card-manager";
import { migrateLegacyStorage, mirrorCustomCardsToLegacy } from "./migration";
import { mirrorSchedulesToLegacy, queueLegacyStateSave, reconcileLegacyAfterSync } from "./legacy-bridge";
import { scheduleReview, undoLastReview } from "./fsrs";
import { startAutomaticSync, syncNow } from "./sync";
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
};

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    const banner = document.querySelector<HTMLElement>("#updateBanner");
    banner?.classList.remove("hidden");
    document.querySelector<HTMLElement>("#updateYes")?.addEventListener("click", () => void updateSW(true), { once: true });
    document.querySelector<HTMLElement>("#updateNo")?.addEventListener("click", () => banner?.classList.add("hidden"), { once: true });
  },
});

void bootstrap().catch((error) => {
  console.error("学習データ基盤の初期化に失敗しました", error);
  document.documentElement.dataset.studyInitError = "1";
});
