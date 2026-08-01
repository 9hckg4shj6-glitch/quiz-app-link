import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  getUser: vi.fn(),
  signInWithOAuth: vi.fn(),
  linkIdentity: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
}));

vi.mock("../src/backend", () => ({ supabase: { auth: authMock } }));

function guestResult() {
  return { data: { user: null }, error: null };
}

function userResult(email = "learner@example.com") {
  return {
    data: {
      user: {
        id: "user-1",
        email,
        identities: [{ provider: "email" }],
        user_metadata: { full_name: "Learner" },
      },
    },
    error: null,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("VITE_SOCIAL_AUTH_ENABLED", "true");
  vi.stubGlobal("location", { origin: "http://localhost:5173", search: "", hash: "" });
  vi.stubGlobal("history", { state: null, replaceState: vi.fn() });
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(),
  });
  vi.stubGlobal("sessionStorage", {
    getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(),
  });
  authMock.getUser.mockResolvedValue(guestResult());
  authMock.signInWithOAuth.mockResolvedValue({ error: null });
  authMock.linkIdentity.mockResolvedValue({ error: null });
  authMock.signOut.mockResolvedValue({ error: null });
});

describe("account authentication flow", () => {
  it.each(["google", "apple"] as const)("%s OAuthを正しいlocalhost戻り先で開始する", async (provider) => {
    const account = await import("../src/account-auth");
    await account.signInWithProvider(provider);
    expect(authMock.signInWithOAuth).toHaveBeenCalledWith({
      provider,
      options: { redirectTo: "http://localhost:5173/" },
    });
    expect(sessionStorage.setItem).toHaveBeenCalledWith("auth_pending_provider_v1", provider);
  });

  it("既存メールOTPセッションをログイン済みとして復元する", async () => {
    authMock.getUser.mockResolvedValue(userResult());
    const account = await import("../src/account-auth");
    const state = await account.refreshAccountState();
    expect(state).toMatchObject({
      status: "authenticated", userId: "user-1", email: "learner@example.com", providers: ["email"],
    });
  });

  it("Apple非公開メールでも現在のユーザーへ手動連携する", async () => {
    authMock.getUser.mockResolvedValue(userResult("abc123@privaterelay.appleid.com"));
    const account = await import("../src/account-auth");
    await account.linkProvider("apple");
    expect(authMock.linkIdentity).toHaveBeenCalledWith({
      provider: "apple",
      options: { redirectTo: "http://localhost:5173/" },
    });
  });

  it("OAuth拒否を日本語で通知し、認証パラメーターをURLから除去する", async () => {
    vi.stubGlobal("location", { origin: "http://localhost:5173", search: "?error=access_denied", hash: "" });
    const account = await import("../src/account-auth");
    await expect(account.consumeAuthCallbackMessage()).resolves.toContain("キャンセル");
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "http://localhost:5173/");
  });

  it("メールOTPの復帰URLも認証コードを除去する", async () => {
    authMock.getUser.mockResolvedValue(userResult());
    vi.stubGlobal("location", { origin: "http://localhost:5173", search: "?code=pkce-code", hash: "" });
    const account = await import("../src/account-auth");
    await expect(account.consumeAuthCallbackMessage()).resolves.toBe("メールでログインしました");
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "http://localhost:5173/");
  });

  it("ログアウト時は端末所有者を消さず、Supabaseセッションだけ終了する", async () => {
    const account = await import("../src/account-auth");
    await account.signOutAccount();
    expect(authMock.signOut).toHaveBeenCalledTimes(1);
    expect(localStorage.removeItem).not.toHaveBeenCalledWith("local_data_owner_v1");
  });

  it("別アカウントを取り消すと新しいセッションをログアウトする", async () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) => key === "local_data_owner_v1" ? "old-user" : null);
    authMock.getUser.mockResolvedValue(userResult());
    authMock.signOut.mockImplementation(async () => {
      authMock.getUser.mockResolvedValue(guestResult());
      return { error: null };
    });
    const account = await import("../src/account-auth");
    await account.refreshAccountState();
    const state = await account.resolveAccountSwitch("cancel");
    expect(authMock.signOut).toHaveBeenCalledTimes(1);
    expect(state.status).toBe("guest");
  });

  it("別アカウントへの置換を選ぶと端末所有者を新しいユーザーへ変更する", async () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) => key === "local_data_owner_v1" ? "old-user" : null);
    authMock.getUser.mockResolvedValue(userResult());
    const account = await import("../src/account-auth");
    await account.refreshAccountState();
    await account.resolveAccountSwitch("replace");
    expect(localStorage.setItem).toHaveBeenCalledWith("local_data_owner_v1", "user-1");
  });
});
