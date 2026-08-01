import { describe, expect, it } from "vitest";
import { assessAccountBinding, getOAuthRedirectUrl, translateAuthError } from "../src/account-auth";

describe("account auth helpers", () => {
  it("GitHub Pages のベースパスをOAuth戻り先にする", () => {
    expect(getOAuthRedirectUrl("https://example.github.io", "/quiz-app-link/"))
      .toBe("https://example.github.io/quiz-app-link/");
  });

  it("localhost のルートをOAuth戻り先にする", () => {
    expect(getOAuthRedirectUrl("http://localhost:5173", "/"))
      .toBe("http://localhost:5173/");
  });

  it("端末所有者が無い・同じ・異なる状態を区別する", () => {
    expect(assessAccountBinding("user-a", null)).toBe("unbound");
    expect(assessAccountBinding("user-a", "user-a")).toBe("same");
    expect(assessAccountBinding("user-a", "user-b")).toBe("conflict");
  });

  it("代表的なOAuthエラーを利用者向け日本語へ変換する", () => {
    expect(translateAuthError("Provider not enabled")).toContain("有効化");
    expect(translateAuthError("access_denied")).toContain("キャンセル");
    expect(translateAuthError("Identity already linked")).toContain("別のアカウント");
  });
});
