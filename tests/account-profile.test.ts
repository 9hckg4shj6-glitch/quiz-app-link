import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userId: "user-a" as string | null,
  rpc: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("../src/account-auth", () => ({
  getCachedAccountState: () => ({ userId: mocks.userId }),
}));
vi.mock("../src/backend", () => ({
  supabase: { rpc: mocks.rpc, auth: { getUser: mocks.getUser } },
}));
vi.mock("../src/db", () => ({ getDeviceId: async () => "11111111-1111-4111-8111-111111111111" }));

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
});

const profile = await import("../src/account-profile");

describe("account public profile", () => {
  beforeEach(() => {
    store.clear();
    mocks.userId = "user-a";
    mocks.rpc.mockReset();
    mocks.getUser.mockReset();
  });

  it("表示名をアカウントごとに分離する", () => {
    profile.setPublicNameLocal("利用者A");
    expect(profile.getPublicName()).toBe("利用者A");

    mocks.userId = "user-b";
    expect(profile.getPublicName()).toBe("");
    profile.setPublicNameLocal("利用者B");

    mocks.userId = "user-a";
    expect(profile.getPublicName()).toBe("利用者A");
  });

  it("サーバーのプロフィール名とランキング参加状態を現在端末へ反映する", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ display_name: "共通名", leaderboard_opt_in: true }],
      error: null,
    });

    await expect(profile.syncAccountIdentity("Google名")).resolves.toEqual({ ok: true });
    expect(profile.getPublicName()).toBe("共通名");
    expect(profile.getLeaderboardOptIn()).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("account_identity_sync", {
      p_device_id: "11111111-1111-4111-8111-111111111111",
      p_name: "Google名",
      p_leaderboard_opt_in: false,
    });
  });

  it("名前変更をログイン中のアカウントへ保存する", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-a" } } });
    mocks.rpc.mockResolvedValue({ data: "新しい名前", error: null });
    await expect(profile.savePublicName(" 新しい名前 ")).resolves.toBe("新しい名前");
    expect(mocks.rpc).toHaveBeenCalledWith("account_profile_set_name", { p_name: "新しい名前" });
  });
});
