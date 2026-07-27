# 免疫編・記述問題 実装仕様書

最終更新: 2026-07-27  
対象リポジトリ: `問題演習アプリ`  
想定実装者: VS Code 上の Claude Code

## 1. 目的

既存の代謝・ゲノム編で使用している選択問題エンジンを壊さず、免疫の過去問に含まれる記述問題を、通常演習・本番モード・FSRS復習・誤答ノート・同期・バックアップまで一貫して扱えるようにする。

この仕様では外部AIによる答案採点を行わない。短答・数値問題の機械的な「仮判定」と、模範解答・採点基準を用いた学習者自身の採点を組み合わせる。

## 2. 過去問調査結果

確認済み資料:

- `/Users/hattoriyuusuke/Downloads/R3後半過去問.pdf`
- `/Users/hattoriyuusuke/Downloads/R4後半過去問.pdf`
- `/Users/hattoriyuusuke/Downloads/R5後半過去問.pdf`
- `/Users/hattoriyuusuke/Downloads/R5後半過去問解答.pdf`
- `/Users/hattoriyuusuke/Downloads/R6後半過去問.pdf`
- `/Users/hattoriyuusuke/Downloads/R6後半過去問解答.pdf`
- `/Users/hattoriyuusuke/Downloads/R7後半過去問マークのみ.pdf`

実際に存在する回答形式:

| 形式 | 実例 | 必要なUI |
|---|---|---|
| 通常の論述 | R4設問4「NK細胞が自己組織を攻撃しない仕組み」 | 複数行テキスト |
| 必須語句付き論述 | R5設問6 セルソーター、R6設問6 Western blotting | 複数行テキスト、必須語句表示 |
| 複数の正答例を許す論述 | R5設問5 老化現象 | 模範例一覧、自己採点 |
| 数値・途中計算 | R3設問6、R6設問7 血球計算盤 | 数値、単位、途中計算欄 |
| 白紙への自由作図 | R4設問2 IgG構造 | 描画キャンバス |
| 作図と文章の複合 | R3設問2、R4設問3、R5設問2・3 | キャンバス＋文章 |
| 既存図への描き込み | R3設問4、R4設問5 オクタロニー法 | 背景画像付きキャンバス |
| マーク問題のみ | R7資料 | 既存の選択問題 |

R5・R6には公式解答があるが、すべての設問に細かな部分点基準が示されているわけではない。公式の採点細目がある箇所はそのまま使用し、総配点と模範解答しかない箇所では「学習用採点基準」を作成して、その旨を画面に明示する。

## 3. スコープ

### 3.1 対象

- 選択問題と記述問題を共通の `QUIZ_DATA` から読み込む
- 短答、論述、数値、作図、およびそれらの複合回答
- 通常演習での即時自己採点
- 選択・記述混在の本番モード
- 部分点、FSRS評価、XP、正誤・苦手判定
- 記述答案の全履歴
- IndexedDB保存、同期コードによる端末間同期、JSONバックアップ
- 問題検索、問題一覧、誤答ノート、フラッシュカードへの表示
- 既存の代謝・ゲノム問題との後方互換

### 3.2 対象外

- 外部AI APIによる意味判定
- 手書き文字認識
- 作図内容の自動画像認識
- 答案画像のアップロード
- 記述答案の第三者採点
- 個別答案の削除・編集。v1では履歴は採点後に不変とし、全削除のみ対応する
- 免疫の授業スライドを根拠にした全問解説の執筆。スライド資料が揃った後の教材作成工程とする

## 4. 現在の構造と変更方針

現在の主要構造:

- `public/subjects/<subject>/questions.js`: 問題データ
- `public/subjects.js`: 科目マニフェスト
- `index.html`: 問題読込、演習、本番、検索、誤答ノート、バックアップの旧UI
- `src/types.ts`: IndexedDB・同期用型
- `src/db.ts`: Dexieデータベース
- `src/main.ts` / `src/global.d.ts`: `index.html` とTypeScript側のブリッジ
- `src/datasync.ts`: 同期コード方式のRPC呼び出し
- `scripts/validate-content.mjs`: 教材データ検証
- `supabase/migrations/006_sync.sql`: 同期コード方式のサーバーデータ

実装方針:

1. `type` がない問題は従来の選択問題として扱う。
2. 記述問題だけ `type: "constructed"` と `responseParts` を持たせる。
3. `index.html` がIndexedDBを直接操作せず、`window.STUDY_CORE.writtenAttempts` 経由でTypeScript側へ委譲する。
4. 答案本文や描画を既存の `progress` に入れない。独立した答案履歴テーブルへ保存する。
5. 既存の選択問題処理は分岐の一方として温存し、記述問題用の描画・採点関数を別に作る。

## 5. 問題データ仕様

### 5.1 共通判定

問題種別の正規化:

```js
function questionType(q) {
  return q.type === "constructed" ? "constructed" : "choice";
}
```

既存の選択問題には `type` を追加しない。`choices` が2個以上ある従来データはそのまま動かす。

### 5.2 記述問題

```ts
type ConstructedPartKind =
  | "short-text"
  | "long-text"
  | "numeric"
  | "drawing";

interface ConstructedQuestion {
  id: string;
  type: "constructed";
  year: string;
  category: string;
  field: string;
  question: string;
  points: number;
  responseParts: ResponsePart[];
  rubric: RubricCriterion[];
  rubricSource: "official" | "derived";
  modelAnswer: string;
  explanation: string;
  image?: string | null;
  imageAlt?: string;
  explainImage?: string | null;
  explainImageAlt?: string;
  slideRefs?: SlideReference[] | null;
}
```

### 5.3 回答パーツ

```ts
interface BaseResponsePart {
  id: string;
  kind: ConstructedPartKind;
  label: string;
  prompt?: string;
  required?: boolean; // 省略時は true
}

interface ShortTextPart extends BaseResponsePart {
  kind: "short-text";
  acceptedAnswers: string[];
  placeholder?: string;
}

interface LongTextPart extends BaseResponsePart {
  kind: "long-text";
  requiredTerms?: string[];
  placeholder?: string;
  rows?: number; // 省略時 6
}

interface NumericPart extends BaseResponsePart {
  kind: "numeric";
  expectedValue: number;
  absoluteTolerance?: number;
  relativeTolerance?: number;
  acceptedUnits: string[];
  placeholder?: string;
}

interface DrawingPart extends BaseResponsePart {
  kind: "drawing";
  backgroundImage?: string | null;
  backgroundImageAlt?: string;
  modelImage: string;
  modelImageAlt: string;
  aspectRatio?: number; // 幅 / 高さ。省略時 4 / 3
  paperAllowed?: boolean; // 免疫編では true
}

type ResponsePart =
  | ShortTextPart
  | LongTextPart
  | NumericPart
  | DrawingPart;
```

数値問題で途中計算も採点する場合は、`numeric` と `long-text` を別パーツとして同じ問題に入れる。

### 5.4 採点基準

```ts
interface RubricCriterion {
  id: string;
  partIds: string[];
  text: string;
  points: number;
  autoCheck?:
    | { kind: "short-match"; partId: string }
    | { kind: "numeric-match"; partId: string }
    | {
        kind: "terms-present";
        partId: string;
        terms: string[];
        mode: "all" | "any";
      };
}
```

ルール:

- `rubric[].points` の合計は `question.points` と完全一致させる。
- `id` は問題内で一意にする。
- `partIds` は存在する回答パーツだけを参照する。
- `autoCheck` は初期チェックの補助に限定し、学習者が必ず修正できる。
- 作図項目は自動判定しない。
- 模範解答が複数考えられる場合は `modelAnswer` 内に代表的な正答例を列挙し、採点項目は「有効な例を1つ挙げた」など意味単位にする。

### 5.5 R5設問2の例

```js
{
  id: "immunology1-r5-written-02",
  type: "constructed",
  year: "令和5年度",
  category: "免疫学",
  field: "B細胞活性化",
  question:
    "BCRが抗原により架橋される様子を図示し、架橋が必要な理由を指定語句を用いて説明しなさい。",
  points: 5,
  rubricSource: "derived",
  responseParts: [
    {
      id: "diagram",
      kind: "drawing",
      label: "BCR架橋の図",
      modelImage: "images/immunology1/answers/r5-written-02.webp",
      modelImageAlt: "抗原が複数のBCRを架橋する模範図",
      aspectRatio: 1.5,
      paperAllowed: true
    },
    {
      id: "reason",
      kind: "long-text",
      label: "架橋が必要な理由",
      requiredTerms: ["Igα/β", "チロシンキナーゼ"],
      rows: 7
    }
  ],
  rubric: [
    {
      id: "crosslink",
      partIds: ["diagram"],
      text: "抗原が複数のBCRを架橋している",
      points: 2
    },
    {
      id: "kinase",
      partIds: ["reason"],
      text: "架橋によりチロシンキナーゼがBCR周囲へ集まる",
      points: 1,
      autoCheck: {
        kind: "terms-present",
        partId: "reason",
        terms: ["チロシンキナーゼ"],
        mode: "all"
      }
    },
    {
      id: "signal",
      partIds: ["reason"],
      text: "Igα/βのリン酸化と下流への情報伝達を説明している",
      points: 2,
      autoCheck: {
        kind: "terms-present",
        partId: "reason",
        terms: ["Igα/β"],
        mode: "all"
      }
    }
  ],
  modelAnswer: "模範解答本文",
  explanation: "授業資料に基づく解説",
  slideRefs: []
}
```

`rubricSource` は、総配点だけが公式で部分点の内訳を教材作成時に分解した場合は `"derived"` とする。

## 6. 入力と仮判定

### 6.1 短答

正規化手順:

1. Unicode NFKC正規化
2. 前後空白削除
3. 連続空白を1個に圧縮
4. ラテン文字を小文字化

正規化後に `acceptedAnswers` のいずれかと完全一致した場合だけ仮正解にする。部分一致、編集距離、意味推定は使用しない。同義語は教材データの `acceptedAnswers` へ明示的に登録する。

### 6.2 必須語句

- 問題文直下に必須語句をチップ表示する。
- 回答中は採点結果を予告しない。
- 回答確定後に、含まれていた語句と不足語句を色分けする。
- 単純な語句出現は意味的正しさを保証しないため、仮チェック後に学習者が採点項目を修正できるようにする。

### 6.3 数値

- 数値入力と単位選択を分ける。
- `5.1e7`、`5.1E7`、`5.1×10^7`、`51000000` を同じ値として解釈する。
- カンマ、全角数字、前後空白は正規化する。
- 単位は `acceptedUnits` の選択肢から選ばせる。
- 判定は `absoluteTolerance` または `relativeTolerance` を用いる。両方指定時はいずれかを満たせば仮正解。
- 途中計算は別の `long-text` パーツと採点項目で自己採点する。

### 6.4 作図

キャンバス要件:

- Pointer Eventsを使用し、マウス、指、ペンへ共通対応する。
- `devicePixelRatio` を考慮し、高DPIでもぼけない。
- 論理座標を0〜1へ正規化して保存する。
- ペン、消しゴム、取り消し、やり直し、全消去を提供する。
- 背景図は答案ストロークと別レイヤーで描画する。
- 画面サイズや向きが変わっても正規化座標から再描画する。
- ストローク終了時に近接点を間引き、画像ではなくストロークJSONとして保存する。
- 1作図につき最大20,000点とし、上限到達時は追加描画を止めて案内する。
- `paperAllowed` の場合、「アプリに描く」「紙に描く」を回答前に選択できる。
- 紙回答では描画データを保存せず、`mode: "paper"` と自己採点結果を履歴へ残す。

模範図確認:

- 回答確定までは模範図を表示しない。
- 確定後は「自分の図」「模範図」をタブまたは上下で比較する。
- 背景図付き問題では、必要に応じて自分のストロークと模範ストロークを切り替え表示する。

## 7. 通常演習フロー

1. 問題文、問題画像、回答パーツを表示する。
2. 学習者が文章・数値・作図を入力する。
3. 必須パーツが空の場合は「答案を確定」を無効化する。ただし「分からないので解答を見る」を別ボタンとして許可する。
4. 「答案を確定」後は回答を読み取り専用にする。
5. 自分の答案、模範解答・模範図、解説を表示する。
6. 自動仮判定可能な採点項目を初期チェックする。
7. 学習者が各採点項目を確認・修正する。
8. 獲得点をリアルタイム表示する。
9. FSRS評価候補を提示し、学習者が許容範囲内で確定する。
10. 採点済み答案を履歴へ保存し、進捗、XP、誤答ノート、FSRSを更新する。
11. 次の問題へ進む。

「分からないので解答を見る」は0点・Againとして記録する。

## 8. 採点・FSRS・既存統計

### 8.1 点数

```js
earnedPoints = rubric
  .filter(criterion => selectedCriterionIds.has(criterion.id))
  .reduce((sum, criterion) => sum + criterion.points, 0);
```

- `earnedPoints === points`: 正解
- `earnedPoints < points`: 不正解・要復習
- 部分点は答案履歴と結果画面へ必ず残す
- 問題単位の既存 `correct` は満点時のみ加算する
- 0点・部分点では `wrong` を加算し、連続正解を0へ戻す
- 満点時のみ既存の連続正解を加算する

### 8.2 FSRS評価候補

| 得点 | 初期候補 | 選べる評価 |
|---|---|---|
| 0点 | Again (1) | Again、Hard |
| 0点超・満点未満 | Hard (2) | Again、Hard |
| 満点 | Good (3) | Hard、Good、Easy |

満点でも迷いがあった場合はHardまたはGoodを選べる。部分点でGood/Easyは選べない。

### 8.3 XP

既存の定数を使用し、記述問題のXPを次で決める。

```js
ratio = earnedPoints / points;
xp = Math.round(XP_WRONG + ratio * (XP_CORRECT - XP_WRONG));
```

- 0点でも既存の不正解XPを与える。
- 満点だけコンボ倍率の対象にする。
- 部分点ではコンボを終了する。

### 8.4 誤答ノート

記述問題の誤答項目:

- 問題文
- 最新答案
- 最新の `獲得点 / 満点`
- 落とした採点項目
- 従来の「なぜ間違えた？」メモ
- 「この問題を解く」
- 「答案履歴を見る」

選択問題の「よく選ぶ誤答」は記述問題では表示しない。

## 9. 本番モード

### 9.1 出題

- 同じセッション内に選択問題と記述問題を入れられる。
- 選択問題は従来どおり回答を記録する。
- 記述問題は回答パーツをセッション内に保存する。
- 試験中は正誤、模範解答、模範図、採点基準を一切表示しない。
- 前後移動しても入力済み答案を復元する。
- 問題ごとの配点は、記述問題では `points`、選択問題では `points` があればそれを、なければ既存の `EXAM_POINT` を使用する。

### 9.2 提出

提出または時間切れ時:

1. 選択問題を自動採点する。
2. 記述答案を `status: "submitted"` としてIndexedDBへ保存する。
3. 未回答の記述問題は0点候補として保存する。
4. 「記述答案を採点する」画面へ移る。
5. 1問ずつ自分の答案と模範解答を比較し、採点基準をチェックする。
6. 全問の自己採点後に `status: "graded"` とする。

採点途中で画面を閉じた場合は、ホームに「採点待ちの試験」を表示して再開できるようにする。

### 9.3 結果

主表示:

```text
獲得点 / 満点
得点率
選択問題の得点
記述問題の得点
記述問題の部分点内訳
```

本番モードでは、採点後の各答案を履歴へ保存する。既存本番モードと同様、FSRSの個別評価ボタンは出さない。本番結果は進捗の正誤集計へ反映するが、FSRS復習イベントは作成しない。

## 10. 答案履歴データ

### 10.1 型

`src/types.ts` に追加する。

```ts
export type WrittenAttemptStatus = "draft" | "submitted" | "graded";
export type WrittenAttemptMode = "practice" | "exam";

export interface TextPartAnswer {
  kind: "short-text" | "long-text";
  text: string;
}

export interface NumericPartAnswer {
  kind: "numeric";
  rawValue: string;
  normalizedValue: number | null;
  unit: string;
}

export interface DrawingPoint {
  x: number;
  y: number;
  pressure?: number;
}

export interface DrawingStroke {
  tool: "pen" | "eraser";
  color: string;
  width: number;
  points: DrawingPoint[];
}

export interface DrawingPartAnswer {
  kind: "drawing";
  mode: "canvas" | "paper";
  strokes: DrawingStroke[];
}

export type WrittenPartAnswer =
  | TextPartAnswer
  | NumericPartAnswer
  | DrawingPartAnswer;

export interface WrittenAttempt {
  id: string;
  subjectId: string;
  questionId: string;
  examSessionId: string | null;
  mode: WrittenAttemptMode;
  status: Exclude<WrittenAttemptStatus, "draft">;
  answers: Record<string, WrittenPartAnswer>;
  selectedRubricIds: string[];
  earnedPoints: number | null;
  maxPoints: number;
  rating: 1 | 2 | 3 | 4 | null;
  durationMs: number | null;
  submittedAt: string;
  gradedAt: string | null;
  updatedAt: string;
  syncedAt: string | null;
}

export interface WrittenDraft {
  id: string;
  subjectId: string;
  questionId: string;
  examSessionId: string | null;
  mode: WrittenAttemptMode;
  answers: Record<string, WrittenPartAnswer>;
  updatedAt: string;
}
```

### 10.2 Dexie

`src/db.ts` をversion 2へ上げる。

```ts
writtenAttempts!: EntityTable<WrittenAttempt, "id">;
writtenDrafts!: EntityTable<WrittenDraft, "id">;

this.version(2).stores({
  cards: "&id, ownerId, deckId, kind, updatedAt, deletedAt, *tags",
  decks: "&id, ownerId, order, updatedAt, deletedAt",
  reviewEvents: "&id, ownerId, cardId, reviewedAt, [cardId+reviewedAt], syncedAt",
  schedules: "&cardId, due, state, updatedAt",
  outbox: "++seq, &operationId, table, recordId, status, createdAt",
  settings: "&key, ownerId, updatedAt",
  writtenAttempts:
    "&id, subjectId, questionId, gradedAt, updatedAt, syncedAt, [questionId+gradedAt]",
  writtenDrafts:
    "&id, subjectId, questionId, examSessionId, updatedAt"
});
```

version 1のテーブル定義は削除せず、version 2を追加する。既存データの移行処理は不要。

### 10.3 保存規則

- 通常演習の入力中は、問題ID単位のdraftを500msデバウンスして保存する。
- 本番モードは `examSessionId + questionId` 単位でdraftを保存する。
- draftはローカル専用で、同期・バックアップ・答案履歴の対象外。
- 回答確定時に `WrittenAttempt` を作成する。
- 通常演習では採点完了後に同じ問題のdraftを削除する。
- 本番では提出時に `submitted` を作り、自己採点完了時に同じIDを `graded` へ更新する。
- 採点済み答案は編集しない。再挑戦は新しいUUIDの答案として追加する。
- 全履歴を保持し、自動削除しない。

### 10.4 JavaScriptブリッジ

`src/main.ts` と `src/global.d.ts` に以下を公開する。

```ts
window.STUDY_CORE.writtenAttempts = {
  saveAttempt,
  updateAttempt,
  getAttempt,
  listByQuestion,
  listPendingExamAttempts,
  saveDraft,
  getDraft,
  deleteDraft,
  exportAll,
  importMany,
  deleteAll
};
```

`index.html` はこのAPIだけを使い、Dexieを直接importしない。

## 11. 同期

### 11.1 既存同期から分離する理由

現在の同期コード方式は `progress` と `meta` を1個のJSONBへまとめ、1MB上限で保存している。答案全文と描画履歴をこのJSONへ追加すると、利用継続により必ず上限へ近づく。

答案履歴は独立した行として保存し、`attemptId` 単位で差分同期する。

### 11.2 Supabaseテーブル

新しいmigrationを追加する。既存番号の次の未使用番号を使用する。

```sql
create table public.sync_written_attempts (
  sync_key text not null
    references public.sync_data(sync_key) on delete cascade,
  attempt_id text not null,
  payload jsonb not null,
  client_updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  primary key (sync_key, attempt_id)
);

create index sync_written_attempts_cursor_idx
  on public.sync_written_attempts
  (sync_key, server_updated_at, attempt_id);
```

- RLSを有効化し、直接アクセス用ポリシーは作らない。
- すべて `security definer` RPC経由にする。
- `sync_key` の存在確認には既存の `norm_sync_code` を使用する。

### 11.3 RPC

追加するRPC:

```text
sync_written_attempts_push(
  p_key text,
  p_attempts jsonb
) returns timestamptz

sync_written_attempts_pull(
  p_key text,
  p_after timestamptz,
  p_after_id text,
  p_limit integer
) returns table(
  attempt_id text,
  payload jsonb,
  server_updated_at timestamptz
)

sync_written_attempts_delete_all(
  p_key text
) returns void
```

push仕様:

- 1回100件以下
- リクエスト全体512KB以下
- `attempt_id`、`updatedAt`、`questionId` がない行を拒否する
- `client_updated_at` が既存値以上の場合だけupsertする
- 同じIDの再送は冪等

pull仕様:

- `p_limit` は1〜200、既定100
- `(server_updated_at, attempt_id)` の昇順
- `p_after` より後、または同時刻で `attempt_id > p_after_id` を返す
- 0件になるまでページングする

### 11.4 クライアント同期

`src/datasync.ts` に答案用RPCラッパーを追加し、`window.STUDY_CORE.datasync` へ公開する。

同期順序:

1. 既存の `progress/meta` をpull・mergeする。
2. 答案履歴をカーソルからページングしてpullする。
3. `attemptId` でローカルへupsertする。競合時は `updatedAt` が新しい方を採用する。
4. `syncedAt` がnull、または `updatedAt > syncedAt` の採点済み答案を100件・512KB以下に分割してpushする。
5. 成功した行だけ `syncedAt` を更新する。
6. 既存の `progress/meta` をpushする。

カーソルはDexieの `settings` へ保存し、同期コードごとに分ける。同期コードを変更した場合は新しいカーソルから全件取得する。

draftと `submitted` の未採点答案は同期しない。`graded` のみ同期する。

## 12. バックアップとリセット

### 12.1 バックアップ

既存の学習記録バックアップをversion 2へ上げる。

```json
{
  "app": "metabolism-quiz",
  "v": 2,
  "exportedAt": "ISO_DATE",
  "progress": {},
  "meta": {},
  "writtenAttempts": []
}
```

変更点:

- `buildExportString()` を非同期化し、ブリッジから答案履歴を取得する。
- バックアップモーダルは生成中表示を出す。
- v1は従来どおり読み込める。
- v2の統合読込は `attemptId` で重複排除し、`updatedAt` が新しい方を採用する。
- 置換読込では既存答案を削除してから取り込む。
- 不正なpart kind、点数範囲外、未知のstatus、日付不正を拒否する。

カード管理画面の `metabolism-study` バックアップとは別物であり、答案履歴は学習記録バックアップ側へ含める。二重格納しない。

### 12.2 リセット

「学習記録をすべて削除」に以下を含める。

- `progress`
- `meta`
- `writtenAttempts`
- `writtenDrafts`
- 採点待ち試験

同期コードが接続済みの場合は、「この端末だけ」では次回同期で復元されるため、リモート答案も削除することを確認文へ明示する。既存の同期コード自体を残して記録だけ消す場合は `sync_written_attempts_delete_all` と既存payloadの空データpushを行う。

## 13. `index.html` の主な変更点

### 13.1 読込

現在の `loadData()` は `choices.length >= 2` で全問題を絞っている。次へ変更する。

```js
.filter(q => {
  if (!q.question) return false;
  if (questionType(q) === "choice") return q.choices.length >= 2;
  return Array.isArray(q.responseParts) && q.responseParts.length > 0;
});
```

記述問題では次を保持する。

- `type`
- `points`
- `responseParts`
- `rubric`
- `rubricSource`
- `modelAnswer`

### 13.2 セッション

queue要素を判別共用体として扱う。

```js
{
  q,
  type: "choice",
  choices,
  need
}

{
  q,
  type: "constructed",
  parts: q.responseParts
}
```

`session.answers[i]` は選択問題の旧値も読み取れるようにし、新規記述答案だけオブジェクトを格納する。

### 13.3 描画用DOM

`#choices` と同じ場所に記述回答コンテナを追加する。

```html
<div id="constructedAnswer" class="constructedAnswer hidden"></div>
<button
  type="button"
  class="btn primary hidden"
  id="constructedSubmit"
>答案を確定</button>
```

採点基準と模範解答は既存 `#explainBox` 内へ描画する。

### 13.4 関数分割

追加または分割する関数:

```text
questionType(q)
renderChoiceQuestion(cur)
renderConstructedQuestion(cur)
readConstructedAnswers(q)
validateConstructedAnswers(q, answers)
submitConstructedAnswer()
renderConstructedReview(q, answers)
suggestWrittenRating(earned, max)
finalizeConstructedGrade(...)
renderDrawingPart(...)
serializeDrawing(...)
restoreDrawing(...)
answerSummary(q)
```

既存 `renderQuestion()` はタイプ判定と共通ヘッダーだけ担当させる。

既存 `ansText(q)` は選択問題専用として残し、検索・一覧・結果では `answerSummary(q)` を使う。

### 13.5 関連画面

次の箇所で `q.choices` や `q.answer` の存在を前提にしないよう分岐する。

- `startQuiz`
- `renderQuestion`
- `answer`
- `submitExam`
- `renderExamResult`
- `renderResult`
- `searchMatches`
- `questionToCard`
- `renderQBrowse`
- `renderMistakes`
- `ansText` 呼出箇所
- 本番モードのwrong list

フラッシュカードでは、記述問題の表面を問題文、裏面を `modelAnswer` とし、模範図がある場合は裏面に表示する。

## 14. UI・アクセシビリティ

- PCでは答案と模範解答を2列、狭い画面では縦並びにする。
- textareaの入力内容をHTMLとして挿入せず、必ずエスケープする。
- 各回答パーツに明示的なlabelを付ける。
- 必須語句の色だけに依存せず、「使用済み」「不足」の文字を表示する。
- 採点項目はcheckboxと点数をセットで読み上げられるようにする。
- キャンバスには代替説明と、「紙に描く」手段を用意する。
- キャンバス操作ボタンは44px以上のタップ領域を確保する。
- キーボードだけで文章入力、採点、次問遷移ができる。
- `prefers-reduced-motion` では採点画面へのアニメーションを無効化する。
- ダークモードでも背景図、ストローク、採点状態のコントラストを保つ。

## 15. 教材検証

`scripts/validate-content.mjs` を問題タイプ別に変更する。

選択問題:

- 現在の検証をそのまま維持する。

記述問題:

- `choices` と `answer` を要求しない。
- `points` が正の整数。
- `responseParts` が1件以上。
- part IDが一意。
- required partに必要な設定がある。
- `short-text` は `acceptedAnswers` が1件以上。
- `numeric` は有限の `expectedValue` と1件以上の単位を持つ。
- `drawing` は存在する `modelImage` を持つ。
- `backgroundImage` があればファイルが存在する。
- rubric IDが一意。
- rubricの `partIds` と `autoCheck.partId` が存在する。
- rubric配点合計が問題満点と一致する。
- `rubricSource` が `official` または `derived`。

検証エラーには科目名・問題ID・項目名を含める。

## 16. テスト

### 16.1 単体テスト

- 短答のNFKC、空白、大小文字、別解候補
- 短答で部分一致を正解にしない
- `5.1e7`、`5.1×10^7`、`51000000` の数値正規化
- 絶対誤差・相対誤差判定
- rubric合計と得点計算
- FSRS候補と選択可能範囲
- XP比例計算
- 描画座標のシリアライズ・復元
- attemptのID重複排除と `updatedAt` 競合解決
- v1/v2バックアップ読込
- 同期カーソルの同時刻・ID順ページング

### 16.2 代表問題による結合確認

- R5設問2: 自由作図＋必須語句付き論述＋部分点
- R3設問4: 背景図への描き込み
- R4設問2: 白紙へのIgG作図
- R3設問6またはR6設問7: 科学表記、単位、途中計算
- R5設問5: 複数の正答例を許す自己採点
- R6設問6: 必須語句と公式の減点要素をrubricへ反映

### 16.3 回帰確認

- 代謝・ゲノムの既存問題数が変わらない。
- 既存の選択肢シャッフル、複数正解、選択肢別解説が動く。
- 既存の通常演習、本番、検索、問題一覧、誤答ノート、FSRSが動く。
- 旧バックアップを読み込める。
- オフライン起動とPWAキャッシュが動く。

### 16.4 同期確認

- オフラインで複数答案を作り、再接続後に全件同期される。
- 2端末で別答案を追加し、和集合になる。
- 同一attemptを再送しても重複しない。
- 採点更新前後で新しい `updatedAt` が採用される。
- 100件超・512KB超の履歴が複数バッチで同期される。
- 既存1MBの `sync_data.payload` に答案本文が混入しない。

## 17. 実装順序

### Phase 1: データ型と検証

1. 問題タイプ、回答パーツ、rubricの内部型を定義する。
2. `loadData()` を後方互換のタイプ分岐へ変更する。
3. `validate-content.mjs` を選択／記述の両形式へ対応させる。
4. R5設問2、R3設問4、R3設問6の最小fixtureを用意して検証する。

完了条件: 既存教材のvalidationが通り、記述fixtureの不正データを検出できる。

### Phase 2: 通常演習

1. テキスト、数値、作図の回答部品を実装する。
2. 模範解答・模範図・rubric自己採点画面を実装する。
3. 得点、FSRS候補、XP、正誤・苦手更新を接続する。
4. 問題検索、問題一覧、フラッシュカードをタイプ対応させる。

完了条件: 代表3形式を通常演習で解答・自己採点でき、既存選択問題が回帰しない。

### Phase 3: 履歴と誤答ノート

1. Dexie version 2とブリッジAPIを追加する。
2. draft、submitted、gradedの保存を実装する。
3. 誤答ノートと問題別答案履歴を実装する。
4. バックアップv2とリセットを実装する。

完了条件: 再読み込み後も答案、描画、部分点、採点待ち状態を復元できる。

### Phase 4: 混在本番モード

1. セッション回答を選択・記述の判別共用体へ変更する。
2. 記述問題の前後移動とdraft保存を実装する。
3. 提出後の記述採点キューを実装する。
4. 得点ベースの結果画面を実装する。

完了条件: 選択＋記述を同時出題し、時間切れ、採点中断、採点再開、最終集計が正しい。

### Phase 5: 差分同期

1. Supabase migrationとRPCを追加する。
2. `datasync.ts` にpush/pullページングを追加する。
3. 自動同期、手動同期、同期コード接続時の全件統合を実装する。
4. 容量・重複・競合テストを行う。

完了条件: 1MBスナップショット上限と独立して答案全履歴を複数端末で保持できる。

### Phase 6: 免疫コンテンツ

1. `public/subjects/immunology1/questions.js` を作成する。
2. 記述設問へ問題画像・背景図・模範図を切り出してWebPで配置する。
3. 公式解答を基に `modelAnswer` を作る。
4. 公式細目と学習用細目を区別してrubricを作る。
5. R3〜R6の記述問題を登録する。
6. R7は資料名どおりマーク問題として既存形式で登録する。
7. 問題数確定後に `public/subjects.js` の `draft` を外し、`expectQuestions` を設定する。

授業スライドが揃うまでは、不明な根拠ページを推測して `slideRefs` に入れない。

## 18. 最終受け入れ条件

- 代謝・ゲノムの既存問題が無変更で動く。
- 免疫の論述、必須語句、数値、自由作図、図への描き込み、複合問題を同じエンジンで扱える。
- 回答前に模範解答や採点基準が漏れない。
- 学習者が部分点を付け、FSRS評価を確定できる。
- 満点と部分点が既存の正誤・苦手・XPへ定義どおり反映される。
- 選択＋記述混在の本番モードが得点ベースで完結する。
- 全答案履歴と描画ストロークがIndexedDBへ残る。
- 答案履歴が同期コードで差分同期され、1MBスナップショット上限を消費しない。
- v1バックアップ互換とv2答案バックアップが動く。
- `npm run check` が成功する。
- PC、スマートフォン、ダークモード、オフラインPWAで主要フローを確認できる。

## 19. 実装時の注意

- 既存の問題IDを変更しない。進捗とFSRSがIDへ紐づいている。
- 既存の `q.answer` / `q.answers` ロジックを記述問題へ無理に流用しない。
- 答案本文や描画を `localStorage` の `progress` に保存しない。
- 描画をbase64 PNGとして同期しない。
- 必須語句の出現だけで論述全体を正解にしない。
- 学習用rubricを公式採点基準と表示しない。
- 自己採点前の答案を同期済み履歴として扱わない。
- ユーザー入力を `innerHTML` へ直接挿入しない。
- 作図問題をスマートフォン利用者へ強制せず、紙回答を必ず残す。
- 大規模な `index.html` の全面書き換えは行わず、既存機能を小さなタイプ分岐で段階的に拡張する。
