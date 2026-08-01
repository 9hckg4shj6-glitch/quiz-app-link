import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

describe("account sync UI orchestration", () => {
  it("存在しない旧コードを破棄してアカウント同期を継続する", () => {
    expect(html).toContain("if(claimed.missing)");
    expect(html).toContain("ds.unlink(); shouldMigrateLegacy=false;");
  });

  it("自動同期後も現在画面を再描画する", () => {
    expect(html).toContain("refreshCurrentScreen();");
    expect(html).toContain("if(!silent) toast(migratedLegacy");
  });
});
