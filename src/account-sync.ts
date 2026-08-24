import { pullAccountSnapshot, pushAccountSnapshot, type SyncPayload } from "./datasync";

export interface SnapshotTransport {
  pull: typeof pullAccountSnapshot;
  push: typeof pushAccountSnapshot;
}

interface SyncStepResult {
  ok: boolean;
  error?: string;
}

interface LegacyClaimResult extends SyncStepResult {
  payload?: SyncPayload;
  missing?: boolean;
}

export interface AccountSyncOperations {
  claimLegacyCode: (code: string) => Promise<LegacyClaimResult>;
  mergeLegacyPayload: (payload: SyncPayload) => void;
  importLegacyWritten: (code: string) => Promise<SyncStepResult>;
  syncSnapshot: () => Promise<SyncStepResult>;
  syncWritten: () => Promise<SyncStepResult>;
  syncCards: () => Promise<{ error?: string | null }>;
  completeLegacyMigration: (code: string) => Promise<SyncStepResult>;
  unlinkLegacyCode: () => void;
}

export interface AccountDataSyncResult {
  ok: boolean;
  migratedLegacy: boolean;
  legacyPending: boolean;
  error?: string;
  legacyError?: string;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function syncSnapshotWithRetry(
  getLocalPayload: () => SyncPayload,
  mergeRemotePayload: (payload: SyncPayload) => void,
  transport: SnapshotTransport = { pull: pullAccountSnapshot, push: pushAccountSnapshot },
  maxAttempts = 3,
): Promise<{ ok: boolean; attempts: number; error?: string }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const pulled = await transport.pull();
    if (!pulled.ok || !pulled.snapshot) {
      return { ok: false, attempts: attempt, error: pulled.error ?? "同期データを取得できませんでした" };
    }
    mergeRemotePayload(pulled.snapshot.payload);
    const pushed = await transport.push(getLocalPayload(), pulled.snapshot.version);
    if (pushed.ok) return { ok: true, attempts: attempt };
    if (!pushed.conflict) return { ok: false, attempts: attempt, error: pushed.error ?? "同期に失敗しました" };
  }
  return { ok: false, attempts: maxAttempts, error: "別の端末との更新競合を解消できませんでした。もう一度お試しください" };
}

/**
 * 旧同期コードの移行と、Googleアカウント本体の同期を調停する。
 *
 * 旧コードは任意の互換機能なので、その取得や答案移行だけが失敗しても
 * アカウントのスナップショット・答案・カード同期は止めない。コードは
 * 端末に残して次回再試行し、本体同期まで成功した場合だけ移行完了にする。
 */
export async function syncAccountData(
  legacyCode: string,
  operations: AccountSyncOperations,
): Promise<AccountDataSyncResult> {
  let legacyReadyToComplete = false;
  let legacyPending = false;
  let legacyError: string | undefined;

  if (legacyCode) {
    try {
      const claimed = await operations.claimLegacyCode(legacyCode);
      if (!claimed.ok) {
        if (claimed.missing) {
          // サーバーに存在しないコードは再試行しても復旧しない。
          operations.unlinkLegacyCode();
        } else {
          legacyPending = true;
          legacyError = claimed.error ?? "旧同期コードを取得できませんでした";
        }
      } else {
        operations.mergeLegacyPayload(claimed.payload ?? {});
        const imported = await operations.importLegacyWritten(legacyCode);
        if (imported.ok) {
          legacyReadyToComplete = true;
        } else {
          legacyPending = true;
          legacyError = imported.error ?? "旧同期コードの答案を取り込めませんでした";
        }
      }
    } catch (error) {
      legacyPending = true;
      legacyError = errorMessage(error, "旧同期コードを取り込めませんでした");
    }
  }

  const snapshot = await operations.syncSnapshot();
  if (!snapshot.ok) {
    return {
      ok: false, migratedLegacy: false, legacyPending,
      error: snapshot.error ?? "学習記録を同期できませんでした", legacyError,
    };
  }

  const written = await operations.syncWritten();
  if (!written.ok) {
    return {
      ok: false, migratedLegacy: false, legacyPending,
      error: written.error ?? "答案を同期できませんでした", legacyError,
    };
  }

  const cards = await operations.syncCards();
  if (cards.error) {
    return {
      ok: false, migratedLegacy: false, legacyPending,
      error: cards.error, legacyError,
    };
  }

  let migratedLegacy = false;
  if (legacyCode && legacyReadyToComplete) {
    try {
      const completed = await operations.completeLegacyMigration(legacyCode);
      if (completed.ok) {
        operations.unlinkLegacyCode();
        migratedLegacy = true;
      } else {
        legacyPending = true;
        legacyError = completed.error ?? "旧同期コードの移行を完了できませんでした";
      }
    } catch (error) {
      legacyPending = true;
      legacyError = errorMessage(error, "旧同期コードの移行を完了できませんでした");
    }
  }

  return { ok: true, migratedLegacy, legacyPending, legacyError };
}
