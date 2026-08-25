# 学習コンテンツ補強 作業計画（表ブロック導入）

作成日: 2026-08-26 / 状態: **未着手（項目1から）**

目的は「複雑な内容を、文字の壁ではなく表と図で整理して見せる」こと。
現状のレンダラでは表が書けないので、まずレンダラを拡張し、そのうえで既存の
長文ブロックを表へ機械的に置き換える。

---

## 0. 前提（調査済みの事実）

### 現状の実測値

| 科目 | 学習ブロック数 | 総文字数 | 図ページ数 | 図なしブロック | 状態 |
|---|---|---|---|---|---|
| genome | 499 | 420,996 | 773 | **107** | 執筆完了 |
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

## 5. 図なしブロックの穴埋め（genome 107件）

うち **1,200字超が16件** ＝ 完全な文字の壁。対応は3択：

1. スライドに該当図がある → `slides` にページを足す（`slide_search.py` で探す）
2. 図が無い → 項目3・4の表で代替する
3. どちらも無理 → 現状維持

`materials/genome/` は gitignore 済み。ページ探索は全ページ Read せず
`slide_search.py` かキーワード検索で該当象限だけ見る（CLAUDE.md の節約ルール）。

---

## 6. animalphysiology の lessons.js 新規作成（別軸の穴）

- 現在 **学習画面がゼロ**。117問・AY01〜AY12 に根拠スライドは付いている。
- 制作パイプラインは植物生理編を流用（`export_slides_plantphysiology.py` 相当）。
- **項目1（表対応）の後に着手する**。最初から表つきで書けるほうが安い。
- 構成は植物生理編に合わせる：【1】どういう話か／【2】覚えること／【3】試験ではこう出る。
- 執筆前に該当デッキの過去問を全文読み、論点別に問題数と配点を数える。

## 7. immunology2 の1年次デッキ 1〜10 搬入

- **118問が slideRefs 空**のまま（1年次スライドが未搬入）。
- スライド搬入 → 問題の slideRefs 付与 → lessons のデッキ 1〜10 執筆、の順。
- 執筆コストが最大なので最後。

---

## 優先順まとめ

| # | 項目 | 規模 | 効果 |
|---|---|---|---|
| 1 | レンダラに `table` 追加 | 半日 | 全部の前提 |
| 2 | 「問われ方の一覧」33ブロック表化 | 1〜2日 | **最大**（最長ブロックが直接効く） |
| 3 | 用語編 61ブロック 3列表化 | 2日 | 大 |
| 4 | exam60 の論点表 | 半日 | 中 |
| 5 | 図なし107件の穴埋め | 断続 | 中 |
| 6 | animalphysiology lessons 新規 | 大 | 大（ゼロ→有） |
| 7 | immunology2 デッキ1〜10 | 最大 | 中 |

---

## 作業時の注意（このリポジトリ固有）

- `public/subjects/*/questions.js` は**自動生成物**。手で直さない。正は
  `~/Documents/試験解説作成/output/data/*.json`。
- `lessons.js` は手書き。ただし巨大なので**全文読まない**（node で eval して部分抽出）。
- 検証は `npm run validate:content` のみ。`npm run build` と全テストは回さない。
- コマンド出力は必ずバイト上限（`2>&1 | tail -c 2000`）。
- 各ブロックには「試験ではこう出る」を必ず残す（表化しても消さない）。
