import { pullAccountSnapshot, pushAccountSnapshot, type SyncPayload } from "./datasync";

export interface SnapshotTransport {
  pull: typeof pullAccountSnapshot;
  push: typeof pushAccountSnapshot;
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
