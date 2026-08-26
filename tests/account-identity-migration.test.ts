import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../supabase/migrations/013_account_identity_unification.sql", import.meta.url),
  "utf8",
);

describe("account identity migration", () => {
  it("ランキング・掲示板・投稿をアカウント所有へ拡張する", () => {
    expect(sql).toContain("alter table public.leaderboard add column if not exists owner_id");
    expect(sql).toContain("alter table public.boards add column if not exists owner_id");
    expect(sql).toContain("alter table public.posts add column if not exists owner_id");
    expect(sql).toContain("account_identity_sync");
  });

  it("端末別の増分カウンターで解答数を合算する", () => {
    expect(sql).toContain("public.leaderboard_device_totals");
    expect(sql).toContain("v_device_solved - v_previous");
    expect(sql).toContain("l.solved_count + v_delta");
  });
});
