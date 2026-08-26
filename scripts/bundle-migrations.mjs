// supabase/migrations/*.sql を番号順に1ファイルへまとめる。
// Supabase SQL Editorはスクリプト全体を1トランザクションで実行するため、
// 貼り付けを1回にすると「途中まで適用」が起きない。
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "supabase", "migrations");
const out = join(process.cwd(), "supabase", "apply-all.generated.sql");
const files = readdirSync(dir).filter((name) => /^\d{3}_.*\.sql$/.test(name)).sort();

const body = files
  .map((name) => `-- ===== ${name} =====\n${readFileSync(join(dir, name), "utf8").trim()}\n`)
  .join("\n");

writeFileSync(out, `-- 自動生成: npm run db:bundle\n-- Supabase SQL Editorへ全文を貼り付けて1回実行する。\n-- 各マイグレーションは再実行しても壊れない（適用済みでもそのまま流してよい）。\n\n${body}`);
console.log(`${files.length}件を ${out} へ出力しました`);
