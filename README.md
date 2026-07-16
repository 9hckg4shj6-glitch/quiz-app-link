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

## 教材の編集

標準教材は次のファイルにあります。

- `public/questions.js`: 選択問題
- `public/terms.js`: 用語カード
- `public/updates.js`: 更新履歴
- `public/images/`: 教材画像（WebP）

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
- `public/`: 標準教材と静的画像
- `supabase/`: 同期DB・RLS・Storage設定
- `tests/`: データ型、FSRS移行、IndexedDBの単体テスト
- `.github/workflows/`: CIとPages配信

App Store対応はPWAと同期の運用安定後にCapacitorプロジェクトとして追加します。
