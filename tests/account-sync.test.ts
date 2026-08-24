import { describe, expect, it, vi } from "vitest";
import { syncAccountData, syncSnapshotWithRetry } from "../src/account-sync";
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

describe("account sync orchestration", () => {
  function operations(overrides: Partial<Parameters<typeof syncAccountData>[1]> = {}) {
    return {
      claimLegacyCode: vi.fn().mockResolvedValue({ ok: true, payload: { progress: { old: 1 } } }),
      mergeLegacyPayload: vi.fn(),
      importLegacyWritten: vi.fn().mockResolvedValue({ ok: true }),
      syncSnapshot: vi.fn().mockResolvedValue({ ok: true }),
      syncWritten: vi.fn().mockResolvedValue({ ok: true }),
      syncCards: vi.fn().mockResolvedValue({ error: null }),
      completeLegacyMigration: vi.fn().mockResolvedValue({ ok: true }),
      unlinkLegacyCode: vi.fn(),
      ...overrides,
    };
  }

  it("旧コードの取得に失敗してもGoogleアカウント本体は同期する", async () => {
    const ops = operations({
      claimLegacyCode: vi.fn().mockResolvedValue({ ok: false, error: "旧コードの取得エラー" }),
    });

    await expect(syncAccountData("ABCDEFGHIJ", ops)).resolves.toEqual({
      ok: true,
      migratedLegacy: false,
      legacyPending: true,
      legacyError: "旧コードの取得エラー",
    });
    expect(ops.syncSnapshot).toHaveBeenCalledTimes(1);
    expect(ops.syncWritten).toHaveBeenCalledTimes(1);
    expect(ops.syncCards).toHaveBeenCalledTimes(1);
    expect(ops.unlinkLegacyCode).not.toHaveBeenCalled();
  });

  it("旧コード処理が例外になってもGoogleアカウント本体は同期する", async () => {
    const ops = operations({
      claimLegacyCode: vi.fn().mockRejectedValue(new Error("旧コード通信例外")),
    });

    await expect(syncAccountData("ABCDEFGHIJ", ops)).resolves.toMatchObject({
      ok: true,
      legacyPending: true,
      legacyError: "旧コード通信例外",
    });
    expect(ops.syncSnapshot).toHaveBeenCalledTimes(1);
    expect(ops.syncWritten).toHaveBeenCalledTimes(1);
    expect(ops.syncCards).toHaveBeenCalledTimes(1);
  });

  it("存在しない旧コードだけを端末から外して通常同期を続ける", async () => {
    const ops = operations({
      claimLegacyCode: vi.fn().mockResolvedValue({ ok: false, missing: true, error: "見つかりません" }),
    });

    await expect(syncAccountData("ABCDEFGHIJ", ops)).resolves.toMatchObject({
      ok: true,
      migratedLegacy: false,
      legacyPending: false,
    });
    expect(ops.unlinkLegacyCode).toHaveBeenCalledTimes(1);
    expect(ops.syncSnapshot).toHaveBeenCalledTimes(1);
  });

  it("旧コードはアカウント本体への保存確認後にだけ移行完了にする", async () => {
    const ops = operations();

    await expect(syncAccountData("ABCDEFGHIJ", ops)).resolves.toEqual({
      ok: true,
      migratedLegacy: true,
      legacyPending: false,
      legacyError: undefined,
    });
    expect(ops.mergeLegacyPayload).toHaveBeenCalledWith({ progress: { old: 1 } });
    expect(ops.completeLegacyMigration).toHaveBeenCalledWith("ABCDEFGHIJ");
    expect(ops.unlinkLegacyCode).toHaveBeenCalledTimes(1);
  });

  it("アカウント本体の同期失敗時は旧コードを移行完了にしない", async () => {
    const ops = operations({
      syncSnapshot: vi.fn().mockResolvedValue({ ok: false, error: "スナップショット失敗" }),
    });

    await expect(syncAccountData("ABCDEFGHIJ", ops)).resolves.toMatchObject({
      ok: false,
      error: "スナップショット失敗",
      migratedLegacy: false,
    });
    expect(ops.completeLegacyMigration).not.toHaveBeenCalled();
    expect(ops.unlinkLegacyCode).not.toHaveBeenCalled();
  });
});
