# 学習コンテンツ補強 作業計画（表ブロック導入）

作成日: 2026-08-26 / 最終更新: 2026-08-26
状態: **項目1〜6 完了。genome は執筆・補強とも完了（表と図の穴はゼロ）**
対象範囲: **当面はゲノム編のみ**（2026-08-26 指示）。項目7（animalphysiology）と
項目8（immunology2）は計画として残すが、いまは着手しない。

- 項目6：**図も表も無かった49ブロックを全部埋めた（2026-08-26）**。詳細は下の「項目6」。
  結果、**genome 499ブロックのうち、図も表も無いブロックは0件**（table 100・slides 434）。
- 項目1：`table`（＋表の後ろに置く `note`）をレンダラ・バリデータに実装済み。
- 項目2：genome の「この回のまとめ」12ブロックと plantphysiology の11ブロックを表化。
  immunology2 の10ブロックは、本文が【1】【2】【3】の3部構成で
  `validate-content.mjs` が「覚えること」の箇条書きを検査しているため表へ移すと検査に落ちる。
  内容も各500字前後と短く表化の利得が小さいので**意図的に見送り**。
- 項目3：用語編61ブロックのうち、**「・用語＝定義」が3行以上並ぶ21ブロック**を表化
  （`scratchpad/terms_table.py` で機械変換）。残り40ブロックは対比が地の文に溶けていて
  表にすると意味が落ちるため本文のまま。表の1列目（用語）は `th` で太字になるので
  `==…==` は外し、赤字は定義側だけに残している。
- 項目4：exam60 の「繰り返し出ている論点」（22行）と「回別の出題数」（13行）を表化。
- 項目5：genome の図なしブロックを2手で埋めた（2026-08-26）。
  - **「この回の読み方」12ブロック全部を表化**（deck 01〜10・12・13）。
    どれも `・論点（N問）——決め手` の並びなので `["論点","問数","出方・決め手"]` の3列へ機械変換した
    （第7回だけ年度が並ぶので3列目を「出た年度」、第10回は「出題回数」）。
    導入文は `body`、箇条書きの後ろの段落は `note` に残してある。
  - **図が付けられる7ブロックに `slides` を足した**。探し方は
    「本文が引用している `20XX年度QNN` を questions.js で引いて、その `slideRefs` のページを数える」
    ——最頻ページがそのまま根拠スライドになる。付けたのは
    01:37（p96,97,117）／01:38（p32,64,74,75）／04:36（p41,42,48,62）／04:4（p3,4）／
    06:23（p32,34,43,50）／08:65（08a:6,7,16）／08:66（08a:5,11,12）。
  - **用語編・exam60 の長い6ブロックを表化**：terms3:0（DNA/RNAポリメラーゼ3列）、
    terms6:5（3つのブロット）、terms4:5（メチル化の流れ）、terms4:3（核移植〜MyoD）、
    exam60:6（引っかけ5型）、exam60:4（コスパ順9範囲）。
  - deck 13（創薬モダリティ）だけは原資料が .docx で**スライド画像が存在しない**ため、
    今後も図は付かない。

### 実装の要点（項目1）

- スキーマは `{ heading, body, table, note, slides }`。**描画順は body → table → note → slides**。
  表の後ろに文章を置きたい場面（「取り違えの向き」「試験ではこう出る」）が多いので `note` を足した。
- 表のセルは `lessonBodyHTML()` を通すのでエスケープ経路は本文と同じ。`==強調==` もセル内で効く。
- CSS変数は `--card` / `--card2` / `--line` / `--muted`（`--panel` は存在しない）。
- 道具：`.tools/rewrite_section.py`（JSONで1セクションを丸ごと差し替え。
  `python3 .tools/rewrite_section.py public/subjects/<id>/lessons.js spec.json`）。
  `.tools/` は gitignore 済みなので、別クローンには無い。無ければ作り直す。
  **`slides` を持つセクションを書き換えるときは spec に `slides` を必ず入れる**
  （YY06〜YY09 で一度落として復旧した）。

目的は「複雑な内容を、文字の壁ではなく表と図で整理して見せる」こと。
現状のレンダラでは表が書けないので、まずレンダラを拡張し、そのうえで既存の
長文ブロックを表へ機械的に置き換える。

---

## 0. 前提（調査済みの事実）

### 現状の実測値

| 科目 | 学習ブロック数 | 総文字数 | 図ページ数 | 図なしブロック | 状態 |
|---|---|---|---|---|---|
| genome | 499 | 約43万 | 773 | **0**（図も表も無いブロックも0） | 執筆・補強とも完了 |
| plantphysiology | 443 | 332,563 | 485 | 17 | 執筆完了（YY05〜09も収録済み） |
| immunology2 | 426 | 150,648 | 730 | 2 | deck 11-15/22-27のみ。**118問が slideRefs 空**（1年次デッキ 1〜10 未搬入） |
| animalphysiology | **0** | – | – | – | **lessons.js が存在しない**（117問・AY01〜AY12 は根拠スライドあり） |
| metabolism | – | – | – | – | 学習画面なし（terms.js のカード運用） |

### 今のスキーマの限界

`lessons.js` の 1 ブロックは `{ heading, body, slides }` だけ。
本文は [index.html:5146](index.html#L5146) `lessonBodyHTML()` を通り、
**`==強調==` 以外は一切解釈されない**（`esc()` 後に `==` だけ span 化）。
表示側は [index.html:151](index.html#L151) `.lsBody{white-space:pre-wrap}` の素テキスト。

→ 表・対比・手順を表現する手段が存在しない。だから
「箇条書きで対比を書き下す」という不自然な形になっている箇所が大量にある。

### lessons.js は手書きファイル

`questions.js` と違い **lessons.js にビルドスクリプトは無い**
（`~/Documents/試験解説作成/` に lesson 系ビルダは存在しない）。直接編集してよい。
ただし 1 ファイル 0.4〜1.3MB あるので **全文 cat 禁止**。
node で eval して該当ブロックだけ抜く / python で部分置換する。

```bash
# ブロックの中身を1つだけ見る
node -e 'const fs=require("fs");const window={};global.window=window;
eval(fs.readFileSync("public/subjects/genome/lessons.js","utf8"));
const l=window.LESSONS.find(x=>x.deck==="05");console.log(l.sections[47].body)'
```

---

## 1. レンダラに表ブロックを追加（最優先・これが全部の前提）

### スキーマ

```js
{
  heading: "RNAポリメラーゼとDNAポリメラーゼ——ほぼ全部が逆",
  body: "…（導入の文章。表で言い切れない話だけ残す）",
  table: {
    caption: "",                                   // 任意
    headers: ["観点", "DNAポリメラーゼ", "RNAポリメラーゼ"],
    rows: [
      ["プライマー", "必要", "==不要=="],
      ["校正", "==ある==", "==ない=="],
      ["基質", "dNTP", "NTP"]
    ]
  },
  slides: [12, 13]
}
```

- `table` は任意。既存ブロックは無変更で動く。
- 描画順は **body → table → slides**（図の直前に表が来る）。

### 実装（index.html、約60行）

1. **描画関数を1つ足す**（`lessonFigsHTML` の隣、[index.html:5246](index.html#L5246) 付近）

```js
// 表は body と同じエスケープ経路（lessonBodyHTML）を通すので、注入面は増えない。
// 列が多いとモバイルで潰れるため、外側を横スクロールで包む。
function lessonTableHTML(t){
  if(!t || !Array.isArray(t.rows) || !t.rows.length) return "";
  const head = Array.isArray(t.headers) && t.headers.length
    ? `<thead><tr>${t.headers.map(h=>`<th>${lessonBodyHTML(h)}</th>`).join("")}</tr></thead>` : "";
  const rows = t.rows.map(r=>`<tr>${r.map((c,i)=>
    i===0 ? `<th scope="row">${lessonBodyHTML(c)}</th>` : `<td>${lessonBodyHTML(c)}</td>`).join("")}</tr>`).join("");
  return `<div class="lsTableWrap">${t.caption?`<div class="lsTableCap">${esc(t.caption)}</div>`:""}
    <table class="lsTable"><colgroup>...</colgroup>${head}<tbody>${rows}</tbody></table></div>`;
}
```

2. **`renderLesson` の sectHTML に差し込む**（[index.html:5429](index.html#L5429) 付近）

```js
${sc.body?`<div class="panel lsBody">${lessonBodyHTML(sc.body)}</div>`:""}
${lessonTableHTML(sc.table)}      // ← この1行を追加
${figs(sc.slides)}
```

3. **CSS を追加**（[index.html:151](index.html#L151) `.lsBody` の直後）

```css
.lsTableWrap{margin-top:11px;overflow-x:auto;-webkit-overflow-scrolling:touch;
  border:1px solid var(--line);border-radius:14px;background:var(--panel)}
.lsTableCap{padding:10px 14px 0;font-size:12.5px;color:var(--muted)}
.lsTable{width:100%;border-collapse:collapse;font-size:13.5px;line-height:1.75}
.lsTable th,.lsTable td{padding:9px 12px;border-bottom:1px solid var(--line);
  text-align:left;vertical-align:top;word-break:break-word}
.lsTable thead th{position:sticky;top:0;background:var(--panel);font-weight:900;font-size:12.5px;
  color:var(--muted);white-space:nowrap}
.lsTable tbody th{font-weight:800;white-space:nowrap}
.lsTable tbody tr:last-child th,.lsTable tbody tr:last-child td{border-bottom:0}
@media(max-width:520px){ .lsTable{font-size:12.5px} .lsTable th,.lsTable td{padding:8px 10px} }
```

4. **検索対象に含める**：`lessons` を全文検索している箇所があれば `table` のセルも
   拾うか確認する（`rg -n "sections" index.html` で該当箇所を絞る）。無ければ不要。

5. **バリデータ**：[scripts/validate-content.mjs:197](scripts/validate-content.mjs#L197) の
   sections ループに数行足す。
   - `table.rows` の各行の長さが `headers.length` と一致すること
   - `rows` が空でないこと

### 検証

```bash
npm run validate:content 2>&1 | tail -c 800
```
表示崩れの目視は 1 章だけ（genome deck 05）開いて確認すれば十分。ビルド・全テストは不要。

---

## 2. 「この回のまとめ——問われ方の一覧」を表化（計33ブロック）

各科目で最長のブロック群。中身が全部 `問われ方 → ==決め手==` の2列なので
**`→` で機械的に分割できる**。直前確認の用途では表のほうが圧倒的に速い。

| 科目 | 対象ブロック | 備考 |
|---|---|---|
| genome | 12件（deck 01,02,03,04,05,06,07,08,09,10,12,13） | **08 は 4,306字** で最大。09は1,216字 |
| plantphysiology | 11件（HF03,HF04,YY01〜YY09） | 見出しは「問われ方の一覧と優先順位」 |
| immunology2 | 10件（11〜14, 22〜27） | 各 440〜610字と短め。優先度は下 |

### 変換ルール

- `・A は→ ==B==` の行 → `["A", "==B=="]`、headers は `["問われ方","決め手"]`
- 1行に `／` で2組入っているもの（例：`iPS細胞の因子は→==…==／材料は→==…==`）は**2行に割る**
- 冒頭の導入文（「6年分（2020〜2025）73問の…」）は `body` に残す
- 年度の記載がある行は3列目に年度を出す（genome exam60 と揃える）

### 進め方

1章ずつ node で該当 section を抜き出し → 変換 → python で該当箇所を置換 → 次へ。
**一括スクリプトで全33件を機械変換しない**（`／` 割りと文脈判断が要るため、目視が要る）。

---

## 3. genome 用語編①〜⑦（61ブロック）を3列対比表に

全ブロックが A/B 対比。現状は `・==プライマー：DNAポリメラーゼは必要、RNAポリメラーゼは不要==`
のように、対比を1行に押し込んでいる。

- headers: `["観点", "A", "B"]`（A/B はブロックごとの実際の用語名）
- 末尾の「**取り違えの向き**」段落は**表にせず body に残す**（表にならない性質の情報）
- 「試験ではこう出る」も body のまま

| デッキ | ブロック数 |
|---|---|
| terms1 | 13 |
| terms2 | 7 |
| terms3 | 9 |
| terms4 | 8 |
| terms5 | 9 |
| terms6 | 9 |
| terms7 | 6 |

---

## 4. exam60「繰り返し出ている論点」（2,244字）を3列表に

`論点 / 出題年 / 問数` の3列。数字の話を文章で書いているので、表にすると
優先順位が一目で出る。exam60 章の他8ブロックも表に向くものがあれば同時に。

---

## 5. 図なしブロックの穴埋め（genome 107件）【完了】

うち **1,200字超が16件** ＝ 完全な文字の壁。対応は3択：

1. スライドに該当図がある → `slides` にページを足す（`slide_search.py` で探す）
2. 図が無い → 項目3・4の表で代替する
3. どちらも無理 → 現状維持

`materials/genome/` は gitignore 済み。ページ探索は全ページ Read せず
`slide_search.py` かキーワード検索で該当象限だけ見る（CLAUDE.md の節約ルール）。

---

## 6. 図も表も無い49ブロックの穴埋め【完了・2026-08-26】

残っていた49ブロック（用語編①〜⑦・exam60・補章13、いずれも1,000字未満）を
**全部、表化＋図付けした**。結果、genome に「図も表も無いブロック」は無くなった。

| デッキ | ブロック数 | 表 | 図（クロスデッキ参照） |
|---|---|---|---|
| terms1 | 8 | 8 | 01・07 |
| terms2 | 4 | 4 | 02・06 |
| terms3 | 7 | 5 | 03・04 |
| terms4 | 3 | 3 | 05・06 |
| terms5 | 3 | 3 | 04 |
| terms6 | 6 | 6 | 08・08a |
| terms7 | 5 | 5 | 10・12（:5 のみ図なし＝補章13は .docx） |
| exam60 | 5 | 5 | なし（統計の章。該当スライドが無い） |
| 13 | 8 | 8 | なし（.docx のため画像なし） |

### 表にしなかった2ブロック（terms3）

- `terms3:2`（転写開始の順番）＝(1)〜(5) の**手順**が主役。手順は表にしない。
- `terms3:4`（エキソン数とイントロン数）＝「n個→n−1個」等の**数の規則**で、
  用語＝定義の並びではない。表にすると規則が読みにくくなる。
  どちらも図（03:24/27、03:39/42）だけ足した。

### 用語編・exam60 に図を入れた（方針変更）

用語編①〜⑦は当初「意図的に図なし」だったが、**クロスデッキ記法 `"04:19"` で
授業回のスライドを引く**形にした。キャプションは `第4回 ・ p19` と出るので、
別の回から借りていることは読者にも分かる。
探し方は項目5と同じ——**本文の論点に一致する過去問を `questions.js` で引き、
`slideRefs[].pages` を頻度順に数え、最頻ページを PyMuPDF の `get_text()` で1行確認**。
webp が無いページは参照できない（`ls public/images/genome/slides | grep '^03-p'`）。
なお画像ファイル名は**3桁ゼロ埋め**（`03-p024.webp`）だが、`slides` に書く値は
ゼロ埋めしない（`"03:24"`）。

### 表化の判断基準（今回運用したもの）

- 3行以上の A/B 対比 → `["観点","A","B"]` の3列
- 「・用語＝定義」が3行以上 → `["用語","中身"]` の2列
- 手順・順番・因果は表にしない（ただし **exam60:7 の1週間の日程**と
  **13:1 のモダリティ古い順**は、行の順序で順番を保てるので表にした）
- 「取り違えの向き」「試験ではこう出る」は表に入れず `note` に残す
  （用語編には「試験ではこう出る」は書かない規約——方針md §4-1-5）
- 1列目は `th` で太字になるので `==…==` は外す。赤字は2列目以降だけ
- 1ブロックに表は1つ。対比が2組ある場合は主なほうだけ表にし、残りは body か note に残す

### 積み残し（内容の疑義。今回は直していない）

`terms7:3`（第二種使用等の実務）の本文に
**「同じ施設内で隣の実験室へ移すのは運搬に当たらない」**とあるが、
第10回スライド p55 は**「実験室間、建物間の移動などが運搬に当たります」**と書いている。
過去問の公式解答由来の記述と思われるが食い違うので、
**p55 は図として貼らず、p41（エアロゾル）と p54（運搬容器）だけ**にした。
どちらを正とするかは要確認。

---

## 7. animalphysiology の lessons.js 新規作成（別軸の穴）

- 現在 **学習画面がゼロ**。117問・AY01〜AY12 に根拠スライドは付いている。
- 制作パイプラインは植物生理編を流用（`export_slides_plantphysiology.py` 相当）。
- **項目1（表対応）の後に着手する**。最初から表つきで書けるほうが安い。
- 構成は植物生理編に合わせる：【1】どういう話か／【2】覚えること／【3】試験ではこう出る。
- 執筆前に該当デッキの過去問を全文読み、論点別に問題数と配点を数える。

## 8. immunology2 の1年次デッキ 1〜10 搬入

- **118問が slideRefs 空**のまま（1年次スライドが未搬入）。
- スライド搬入 → 問題の slideRefs 付与 → lessons のデッキ 1〜10 執筆、の順。
- 執筆コストが最大なので最後。

---

## 優先順まとめ

| # | 項目 | 規模 | 効果 | 状態 |
|---|---|---|---|---|
| 1 | レンダラに `table` 追加 | 半日 | 全部の前提 | **完了** |
| 2 | 「問われ方の一覧」33ブロック表化 | 1〜2日 | **最大**（最長ブロックが直接効く） | **完了** |
| 3 | 用語編 61ブロック 3列表化 | 2日 | 大 | **完了** |
| 4 | exam60 の論点表 | 半日 | 中 | **完了** |
| 5 | 図なし107件の穴埋め | 断続 | 中 | **完了** |
| 6 | 図も表も無い49件の穴埋め | 1日 | 中 | **完了** |
| 7 | animalphysiology lessons 新規 | 大 | 大（ゼロ→有） | 保留（対象外） |
| 8 | immunology2 デッキ1〜10 | 最大 | 中 | 保留（対象外） |

---

## 作業時の注意（このリポジトリ固有）

- `public/subjects/*/questions.js` は**自動生成物**。手で直さない。正は
  `~/Documents/試験解説作成/output/data/*.json`。
- `lessons.js` は手書き。ただし巨大なので**全文読まない**（node で eval して部分抽出）。
- 検証は `npm run validate:content` のみ。`npm run build` と全テストは回さない。
- コマンド出力は必ずバイト上限（`2>&1 | tail -c 2000`）。
- 各ブロックには「試験ではこう出る」を必ず残す（表化しても消さない）。
