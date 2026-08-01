import { describe, expect, it, vi } from "vitest";
import { syncSnapshotWithRetry } from "../src/account-sync";
import type { SyncPayload } from "../src/datasync";

describe("account snapshot CAS sync", () => {
  it("競合時に再取得・再統合してから再送する", async () => {
    let local: SyncPayload = { progress: { local: 1 } };
    const pull = vi.fn()
      .mockResolvedValueOnce({ ok: true, snapshot: { payload: { progress: { remoteA: 1 } }, version: 4, updatedAt: null } })
      .mockResolvedValueOnce({ ok: true, snapshot: { payload: { progress: { remoteB: 1 } }, version: 5, updatedAt: null } });
    const push = vi.fn()
      .mockResolvedValueOnce({ ok: false, version: 5, conflict: true })
      .mockResolvedValueOnce({ ok: true, version: 6, conflict: false });

    const result = await syncSnapshotWithRetry(
      () => local,
      (remote) => {
        local = {
          progress: {
            ...((local.progress as Record<string, number>) ?? {}),
            ...((remote.progress as Record<string, number>) ?? {}),
          },
        };
      },
      { pull, push },
    );

    expect(result).toEqual({ ok: true, attempts: 2 });
    expect(push).toHaveBeenNthCalledWith(1, { progress: { local: 1, remoteA: 1 } }, 4);
    expect(push).toHaveBeenNthCalledWith(2, { progress: { local: 1, remoteA: 1, remoteB: 1 } }, 5);
  });

  it("競合以外のエラーは再試行しない", async () => {
    const pull = vi.fn().mockResolvedValue({ ok: true, snapshot: { payload: {}, version: 1, updatedAt: null } });
    const push = vi.fn().mockResolvedValue({ ok: false, conflict: false, error: "権限エラー" });
    const result = await syncSnapshotWithRetry(() => ({}), () => {}, { pull, push });
    expect(result).toEqual({ ok: false, attempts: 1, error: "権限エラー" });
    expect(pull).toHaveBeenCalledTimes(1);
  });
});
