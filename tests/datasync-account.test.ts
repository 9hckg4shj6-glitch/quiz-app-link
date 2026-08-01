import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("../src/backend", () => ({ supabase: { rpc } }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("legacy sync-code migration fallback", () => {
  it("端末にだけ残った同期コードをmissingとして区別する", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const { claimSyncCode } = await import("../src/datasync");

    await expect(claimSyncCode("ABCDE-FGHIJ")).resolves.toEqual({
      ok: false,
      missing: true,
      error: "この同期コードは見つかりません",
    });
    expect(rpc).toHaveBeenCalledWith("claim_sync_code", { p_key: "ABCDEFGHIJ" });
  });

  it("別アカウント取得済みエラーはmissingにせず同期を止める", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "SYNC_CODE_CLAIMED" } });
    const { claimSyncCode } = await import("../src/datasync");

    await expect(claimSyncCode("ABCDEFGHIJ")).resolves.toEqual({
      ok: false,
      error: "この同期コードは別のアカウントへ移行済みです",
    });
  });
});
