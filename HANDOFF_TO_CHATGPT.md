# 引き継ぎメモ（ChatGPT宛）: 暗記カードの「デッキ公開」が失敗する件

作成日: 2026-08-26 / 前任: Claude Code
対象リポジトリ: `~/アルゴリズム学習/問題演習アプリ`（GitHub: `9hckg4shj6-glitch/quiz-app-link`、公開リポジトリ）
公開URL: https://9hckg4shj6-glitch.github.io/quiz-app-link/

---

## 1. 依頼したいこと（残作業）

**本番SupabaseのSQL Editorで、マイグレーションを1回だけ実行してもらう。それだけです。**

コード側の修正・検証は完了して `main` へpush済み（コミット `5366026`, `7a83296`）。
GitHub Actionsでのビルド・Pages配信も成功しています。**アプリのコードに残作業はありません。**

手順:

1. リポジトリ直下で `npm run db:bundle` を実行する
   → `supabase/apply-all.generated.sql` が生成される（001〜013を連結した1ファイル、約2,200行）
   → このファイルは `.gitignore` 済み。生成物なので手で編集しないこと
2. Supabase Dashboard → SQL Editor を開く
3. 生成された `apply-all.generated.sql` の**全文を貼り付けて、1回で実行**する
4. エラーが出なければ完了。出た場合は「5. 失敗したときの切り分け」を参照

> **重要**: 絶対に分割して貼らないでください。SQL Editorはスクリプト全体を1トランザクションで実行するため、
> 途中で1文でも失敗すると**それまでの分も全部ロールバックされ、テーブルが1つも残りません**。
> 今回の不具合の根本原因がまさにこれです。

---

## 2. 何が起きていたか（調査結果・実測）

ユーザーの症状は「自分が作成した暗記カードのデッキを共有（公開）しようとするとエラーになる」。

公開ビルド（`dist/assets/index-*.js`）に埋め込まれたSupabase URLとpublishable keyを使って、
本番のREST APIを直接叩いて実態を確認しました。

| 対象 | 本番の状態 |
| --- | --- |
| `shared_memory_decks` / `shared_memory_cards` | **存在しない**（HTTP 404 / PGRST205） |
| RPC `publish_memory_deck` | **存在しない**（HTTP 404 / PGRST202） |
| `decks` / `cards` / `review_events` / `settings` | **存在しない** |
| `account_profiles` / `account_devices` | **存在しない** |
| `boards` / `posts` / `leaderboard` | 存在する |

つまり **`001_initial.sql` が本番に適用されていない**。002〜005（掲示板・ランキング）だけが入っている状態でした。
共有機能のテーブルもRPCも無いので、クライアントを何度直しても公開は成功しません。

### なぜ001が入らなかったのか（PGliteで再現済み）

- `001_initial.sql` の `create policy` に `drop policy if exists` が無かった
  → **2回目の実行で必ず `policy "cards_owner_all" for table "cards" already exists` で失敗**
- SQL Editorはスクリプト全体が1トランザクション → この失敗で**テーブルが1つも作られないまま終わる**
- さらに `storage.objects` へのポリシー作成はプロジェクトによって権限不足で失敗し、これも全体をロールバックさせる
- `011_memory_cards.sql` は `alter table public.decks ...` で001に依存しているため、001が無いと必ず失敗する
  → 暗記カードの共有機能まで連鎖して動かない状態だった

---

## 3. すでに実施した修正（push済み・触らなくてよい）

| ファイル | 内容 |
| --- | --- |
| `supabase/migrations/001_initial.sql` | 全 `create policy` の前に `drop policy if exists` を追加して再実行可能に。storageのバケットとポリシーを例外処理付き `do $$ ... exception when insufficient_privilege or undefined_table then ... end $$;` に隔離し、storageに触れないプロジェクトでも同期用テーブルは作られるようにした |
| `supabase/migrations/012_atomic_memory_deck_publish.sql` | 末尾に `notify pgrst, 'reload schema';` を追加（適用直後のスキーマキャッシュ切れ対策） |
| `scripts/bundle-migrations.mjs` | 新規。`npm run db:bundle` で001〜013を1ファイルへ連結する |
| `src/memory-cards.ts` | 公開前バリデーション `publishBlockReason()` と、Supabaseエラーの日本語化 `shareErrorMessage()` を追加。RPC引数の `undefined` を既定値で埋める（引数名が欠けるとPostgRESTが関数を解決できない）。公開・共有一覧取得・カード取得・取り込みの全経路に例外処理を追加 |
| `tests/memory-share.test.ts` | 新規。上記2関数の回帰テスト12件 |
| `README.md` | 適用手順を「バンドルを1回貼る」方式へ更新 |

---

## 4. 実施済みの検証（再実行不要）

ローカルにPostgresが無いため、WASM版Postgresの **PGlite（PostgreSQL 18.3）** で本物のPostgresを立てて検証しました。
（`auth.users` / `auth.uid()` / `storage.*` / ロール `anon`・`authenticated` はSupabase相当のスタブを用意）

- 全13マイグレーションを **3回連続で適用して全部成功**（冪等性を確認）
- storageスキーマが存在しない環境でも `001_initial.sql` が完走し、`decks`/`cards` 等が残ることを確認
- 公開RPC `publish_memory_deck` の実動作 **20項目すべて合格**:
  - 初回公開で `v1` が返り、`status=published` / `card_count` / `published_at` / `owner_id` が正しい
  - 再公開で `v2`、カードが完全に入れ替わる（削除分が消え、編集が反映される）
  - 他ユーザーが同じデッキIDを公開しようとすると拒否され、既存データは無傷
  - 未ログイン、0枚、空タイトル、空欄カード、表2000字超・裏4000字超を正しく拒否
  - 失敗した公開が中途半端な行を残さない
  - 公開後のデッキ・カードが未ログイン（anon）から読める＝「みんなのデッキ」からの取り込みが成立する
- `npm run check`（vitest 128件 + tsc + vite build）全通過
- GitHub Actions `Test and deploy Pages` 成功・Pages配信済み

---

## 5. 失敗したときの切り分け

SQL実行でエラーが出た場合、**エラーメッセージ全文**を確認してください。

| エラー | 意味と対処 |
| --- | --- |
| `must be owner of table objects` / `permission denied for schema storage` | storage部分は `do` ブロックで握りつぶすようにしたので、本来ここでは止まらないはず。止まるならブロックの外に別のstorage参照が無いか確認 |
| `... already exists` | どこかに `drop ... if exists` の抜けがある。該当オブジェクト名を報告してほしい |
| `relation "public.decks" does not exist` | 001より先に011を流している。必ずバンドル（番号順）で流すこと |
| `extension "pgcrypto" is not available` | Supabaseでは起きない（PGlite固有）。もし出たらDashboardのDatabase → Extensionsで `pgcrypto` を有効化 |

---

## 6. 適用後の確認方法

### 6-1. APIから（確実・推奨）

Supabase URLとpublishable key（anon key）は Supabase Dashboard → Project Settings → API で確認できます。
（公開ビルドのJSにも埋め込まれています。公開前提のキーなので秘密情報ではありません）

```bash
U="https://<project-ref>.supabase.co"
K="<publishable key>"

# 200 が返れば共有テーブルができている（未適用なら 404 / PGRST205）
curl -s -o /dev/null -w '%{http_code}\n' "$U/rest/v1/shared_memory_decks?select=id&limit=1" -H "apikey: $K"

# RPCの存在確認。適用後は 400 前後で
# 「デッキを公開するにはログインが必要です」(code P0001) が返るのが正常。
# 未適用なら PGRST202「Could not find the function」。
curl -s -X POST "$U/rest/v1/rpc/publish_memory_deck" -H "apikey: $K" \
  -H "Content-Type: application/json" \
  -d '{"p_deck_id":"probe","p_subject_id":"genome","p_title":"probe","p_description":"","p_cards":[]}'
```

`ログインが必要です` が返れば、**関数が存在し、中身も動いている**ことの証明です（未ログインなので拒否されるのが正しい挙動）。

### 6-2. アプリから（最終確認）

1. https://9hckg4shj6-glitch.github.io/quiz-app-link/ を開く（Service Worker更新のため一度リロード）
2. 「設定・データ」からGoogleログイン
3. 任意の科目 → 「暗記カード」→ デッキを作成 → カードを1枚以上追加
4. デッキ詳細の「自分のデッキを公開する」→ 確認ダイアログでOK
5. **「『◯◯』をみんなのデッキへ公開しました（v1）。」** が出れば成功
6. 「みんなのデッキ」タブに表示され、「自分のデッキに追加」で取り込めることも確認

失敗した場合、画面に日本語のエラーが出るようにしてあります。その文言をそのまま報告してもらえば原因が特定できます。
特に **「共有用のテーブルがまだ作られていません（マイグレーション未適用）」** が出たら、SQLの適用が完了していません。

---

## 7. 注意事項・前提

- `public/subjects/*/questions.js` は**自動生成物**。読むのも手で直すのも禁止（正は `~/Documents/試験解説作成/output/data/*.json`）
- `materials/` 配下の授業スライド・過去問PDFはGit管理外。リポジトリが公開のため絶対にコミットしない
- `supabase/apply-all.generated.sql` は生成物。`.gitignore` 済みなのでコミットしない
- Supabaseのservice role keyやDBパスワードをリポジトリ・`.env`・GitHubへ置かないこと。今回の作業に不要です
- `VITE_SOCIAL_AUTH_ENABLED` は本番で `true`。GoogleログインのUIは有効になっている
- 今回のバンドル適用で、共有機能に加えて**端末間同期・アカウント統合・記述問題の答案保存**（006/008/009/013）も同時に有効になります。これらも現在は本番未適用で動いていないため、意図した復旧です

---

## 8. コード側で追加の作業をする場合の注意

- 検証はリスクに合わせる。内容追加だけなら `npm run validate:content` で十分。`npm run build` や全テストは不要
- コマンド出力は必ずバイト上限を付ける（`2>&1 | tail -c 2000`）
- 詳細な作業規約は `CLAUDE.md` を参照
