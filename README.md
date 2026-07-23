# 代謝・生化学 問題演習アプリ

790問の問題演習、161枚の標準カード、自作カード、FSRS復習、オフラインPWAを備えた学習アプリです。AI APIは使用しません。

## 開発と確認

Node.js 22以降を使用します。

```sh
npm install
npm run dev
```

型検査、教材検証、単体テスト、本番ビルドは次でまとめて実行できます。

```sh
npm run check
```

同じLAN内へ配信する場合は `start-lan.command` を開くか、次を実行します。

```sh
npm run build
node server.js
```

簡易認証を付ける場合:

```sh
APP_USER="study" APP_PASSWORD="任意のパスワード" node server.js
```

## データ保存と同期

- ゲスト利用ではDexie/IndexedDBへカード、復習イベント、FSRS予定を保存します。
- 旧 `localStorage` の進捗・自作問題は初回起動時に自動移行します。
- 「カード管理・同期」からカード作成、編集、複製、削除、デッキ作成、JSONバックアップができます。
- Supabase未設定でも全ローカル機能を利用できます。
- PWAは新しい配信を検出するとService Workerを自動更新し、古いキャッシュを表示し続けないようにします。長時間開いたままの場合も1時間ごとに更新を確認します。
- 複数端末同期を有効にする場合は `.env.example` を `.env` にコピーして値を設定し、`supabase/migrations/001_initial.sql` をSupabaseへ適用します。
- 同期はメールOTP、Row Level Security、オフライン送信待ちキューを使用します。

## 公開ランキング（解いた問題数）

ホームの「🏆 ランキング」から、名前を登録すると「解いた問題数」がグローバルな公開ランキングに掲載されます。端末ごとに発行される `deviceId` で本人を識別し、名前は表示ラベルです（メール等の個人情報は公開しません）。演習中は随時、上限付き（30秒間隔）でスコアを送信します。

有効化には Supabase が必要です（未設定でもアプリはローカル専用で動作し、ランキングは「準備中」と表示されます）。手順:

1. Supabase プロジェクトを用意する（既存の同期用と同じでよい）。
2. `supabase/migrations/002_leaderboard.sql` を SQL Editor で実行する（`leaderboard` テーブルと4つの `security definer` 関数を作成）。認証は不要で、匿名（anon）ロールから関数のみ実行できます。
3. GitHub リポジトリの Settings → Secrets and variables → Actions に `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` を登録する（anonキーはRLS前提の公開可能キー）。
4. `main` へマージ／pushすると、CIがSecretsをビルドへ注入して配信します。

不適切な名前などは Supabase ダッシュボードの `leaderboard` テーブルから該当行を削除できます。名前は制御文字を除去し24文字までに制限、解答数はサーバ側で 0〜100000 にクランプ・単調増加（下がらない）としています。

## 端末間データ同期（同期コード）

「設定・データ」→「記録の引き継ぎ・バックアップ」から、**同期コード**（`ABCDE-FGHIJ` の10文字）を発行できます。別の端末でそのコードを入力するだけで学習記録がそろい、以降は自動で同期されます。ファイルのやり取りや貼り付けは不要です。

- 統合は `mergeProgress` / `mergeMeta`（問題ごとに最大値・和集合）で行い、**pull → 統合 → push** の順に動くため、どちらの端末の記録も失われません。
- 同期の対象は学習記録（`progress`）と実績・XP・アクティビティ（`meta`）です。自作カードは対象外で、従来どおり手動バックアップを使います。
- 学習のたび（最短1分間隔）、起動時、オンライン復帰時、アプリに戻ったときに自動同期します。
- 認証は使わず、コードを知っている端末だけが読み書きできます。**コードは学習記録への鍵**なので他人に教えないでください。
- 従来の手動バックアップ（コピー／ファイル）は「手動でのバックアップ」に折りたたんで残しています。

有効化には `supabase/migrations/006_sync.sql` を SQL Editor で実行します（`sync_data` テーブルと RPC 群を作成）。未適用の間は「準備中」と表示され、手動バックアップは引き続き使えます。

## コミュニティ（掲示板）

ホームの「💬 コミュニティ」から、誰でも掲示板を作成して書き込めます。全公開で、閲覧・投稿に認証は不要です。識別は端末ごとの `deviceId`、表示名は `localStorage` に保存します（ランキングに登録済みならその名前が初期値になり、変更しても互いに影響しません）。

有効化には `supabase/migrations/003_community.sql`、続けて `supabase/migrations/004_report_dedupe.sql` を SQL Editor で実行します（`boards` / `posts` / `app_secrets` / `reports` テーブルと RPC 群を作成）。未適用の間、アプリは「準備中」と表示して安全に動作します。

荒らし対策として次をサーバ側に実装しています。

- レート制限: 投稿は1分3件・1時間20件、掲示板作成は5分1件・1日5件まで
- 文字数制限: 名前24文字、タイトル40文字、説明200文字、本文1000文字
- 制御文字の除去（改行・タブは保持）と、表示時のHTMLエスケープ
- 通報は端末ごとに1回のみ有効で、異なる3端末から通報された掲示板・書き込みは一覧から自動的に非表示（同一端末の連打では隠せない）
- 投稿者は自分の書き込み・掲示板を削除可能（ソフト削除）

### 管理者削除

`app_secrets` テーブルの `admin_token` の値を任意の文字列に変更してください（初期値は `CHANGE_ME_...`）。

```sql
update public.app_secrets set value = '任意の管理者トークン' where key = 'admin_token';
```

アプリのコミュニティ画面の下部にある「管理者」からトークンを入力すると管理者モードになり、他人の書き込み・掲示板にも「管理削除」が出ます。トークンは端末の `localStorage` に保存されます。不適切な投稿は Supabase ダッシュボードから直接削除することもできます。

## 教材の編集

教材は**科目ごと**に分かれています。

- `public/subjects.js`: 科目マニフェスト（どんな科目があるか）
- `public/subjects/<科目id>/questions.js`: その科目の選択問題
- `public/subjects/<科目id>/terms.js`: その科目の用語カード
- `public/updates.js`: 更新履歴（全科目共通）
- `public/images/`: 教材画像（WebP。代謝は直下、新しい科目は `images/<科目id>/`）

アプリは**選択中の科目のデータだけ**を読み込みます。科目をいくつ増やしても、
起動時に読む量は1科目ぶんのまま変わりません。

### 新しい科目を足す

1. `public/subjects/<id>/questions.js` を作る（`window.QUIZ_DATA = [...]`）
2. カードがあれば `public/subjects/<id>/terms.js`（`window.TERM_CARDS = [...]`）
3. 図があれば `public/images/<id>/` に置く
4. `public/subjects.js` の配列に1行足す

```js
{ id:"pharm", name:"薬理学", emoji:"💊", accent:"#b0468a",
  questions:"subjects/pharm/questions.js", terms:"subjects/pharm/terms.js" }
```

**問題ID・カードIDは `<科目id>-` で始めてください。** 学習の進捗（localStorage）と
復習予定（IndexedDB）はIDで紐づいているため、科目をまたいでIDが衝突すると記録が混ざります。
`npm run validate:content` がこの規約を検査します（代謝だけは既存ユーザーの記録を守るため免除）。

アプリ本体（`index.html`）を触る必要はありません。

### 資料の原本（`materials/`）

問題や解説を作るときに参照する講義スライド・過去問PDFは `materials/<科目id>/` に置き、
各フォルダの `INDEX.md` に内容と使い方をまとめています（例: `materials/genome/INDEX.md`）。

**`materials/` は `.gitignore` で除外しています。** このリポジトリは公開されており、
資料には教科書の図版が含まれるためです。授業スライドの全体像は公開しませんが、
解説やカードを作るときは必ず原本を参照し、説明に必要な図はその問題・カードのために
切り抜いて使います。公開物に載せるのは「自分の言葉で書いた説明」と
「必要最小限の切り抜き図（`public/images/<科目id>/`）」に限ります。

問題形式:

```js
window.QUIZ_DATA = [
  {
    id: "Q001",
    year: "2026年",
    field: "糖代謝",
    question: "問題文",
    choices: ["選択肢1", "選択肢2", "選択肢3", "選択肢4"],
    answer: 0,
    explanation: "解説"
  }
];
```

`answer` は0始まりです。教材数、ID重複、正解番号、画像参照は `npm run validate:content` で検査されます。CSVは `public/template.csv` を使用できます。

## 配信

`main` へのpush時にGitHub Actionsが以下を実行し、成功時だけGitHub Pagesへ配信します。

1. 依存関係の再現インストール
2. 単体テスト
3. 教材検証
4. TypeScript型検査
5. Vite/PWAビルド
6. Pagesデプロイ

公開URL: https://9hckg4shj6-glitch.github.io/quiz-app-link/

GitリモートURLへアクセストークンを埋め込まないでください。GitHub CLIまたはOSの資格情報マネージャーを使用します。

## 構成

- `index.html`: 既存UIと問題演習ロジック
- `src/`: 型、Dexie、FSRS、カード管理、同期
- `public/`: 科目別の教材（`subjects/`）と静的画像
- `supabase/`: 同期DB・RLS・Storage設定
- `tests/`: データ型、FSRS移行、IndexedDBの単体テスト
- `.github/workflows/`: CIとPages配信

App Store対応はPWAと同期の運用安定後にCapacitorプロジェクトとして追加します。
