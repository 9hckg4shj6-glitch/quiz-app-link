import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

describe("account sync UI orchestration", () => {
  it("旧コード移行とアカウント本体の同期を独立して実行する", () => {
    expect(html).toContain("ds.syncAccountData(legacyCode");
    expect(html).toContain("if(result.legacyPending)");
  });

  it("自動同期後も現在画面を再描画する", () => {
    expect(html).toContain("refreshCurrentScreen();");
    expect(html).toContain("else toast(result.migratedLegacy");
  });
});
