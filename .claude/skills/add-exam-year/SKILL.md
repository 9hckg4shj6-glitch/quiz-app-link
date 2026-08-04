---
name: add-exam-year
description: 過去問を1年度分アプリに追加する。動物生理学・植物生理学の「R◯を実装して」「◯年度の過去問を入れて」に使う。スキーマ・ヘルパ・検証コマンドを再発見せずに済ませるための手順書。
---

# 過去問を1年度追加する

**探索するな。ここに書いてある道だけ通れ。** 各年度で同じ調査を繰り返すのが最大の無駄。

## 正・派生の関係

```
materials/<科目>/exams/*.pdf        原本（Git外・画像PDF）
  ↓ build_<年度>_<科目>_json.py     ← 人が書く。解説の本文はここ
~/Documents/試験解説作成/output/data/<年度>_<科目>_解答解説.json   ← 正
  ↓ build_questions_js*.py
public/subjects/<科目>/questions.js  ← 自動生成物。読むな・直すな
```

制作リポジトリは `~/Documents/試験解説作成/`。アプリ側で直すのは
`public/subjects.js` の `expectQuestions` **だけ**。

## 手順

1. **原本を読む** — Task ツールで `exam-pdf-extractor` に投げる。ページ画像をメイン文脈に入れない。
   すでに添付で本文が渡っているなら省略。

2. **根拠スライドの所在を1回で走査する**
   ```bash
   python3 ~/Documents/試験解説作成/slide_panel_scan.py animalphysiology シナプトタグミン 減数分裂 ...
   ```
   `deck p<頁> <象限>` が返る。**ヒットしない論点は解説を書く前に把握する**（下の grounding を参照）。
   スライドPDFを直接 Read するのは、走査で当たったページの本文が要るときだけ。

3. **`build_<年度>_<科目>_json.py` を書く** — 直前年度のスクリプトをコピーして中身だけ差し替える。
   ヘルパは共通（動物生理の場合）:
   - `choice(parent, item, points, prompt, options, correct, overall, evidence, multiple=, group_id=, figure=, shuffle=)`
     `options` は `[(記号, 本文, 解説, evidence)]`。**全選択肢に解説が要る**
   - `written(parent, item, points, qtype, prompt, evidence, **kw)`
     `qtype` は `short_answer` / `fill_blank` / `structured_answer`。
     `kw` に `passage`+`blanks[]`、`answer_parts[]`、`scoring_points[]`、`model_answer`、
     `official_answer`、`official_answer_note`、`explanation` を渡す
   - `ev(("AY03", 8, "スライド本文の実在キーワード", "ラベル"), ...)`
     **キーワードが指定ページに無ければビルドが落ちる**（厳格）。空白は無視して突き合わせるので
     語中の改行は気にしなくてよい。象限はキーワードから自動解決される
   - 配点合計＝満点はスクリプト末尾で assert される

4. **`build_questions_js_animal.py`（植物は `build_questions_js.py`）の `SOURCES` に1件足す**
   ```python
   {"src": "output/data/R5_動物機能生理学前期_解答解説.json", "year": "令和5年度",
    "field": {1: "シナプス伝達", 2: "ニューロンとグリア", ...}},   # 大問番号 → 絞り込み用の分野
   ```
   `year` は既存と同じ「令和◯年度」表記。降順（新しい年度が上）に並べる。

5. **`public/subjects.js` の `expectQuestions` を加算**（コメントの内訳も更新する）

6. **検証はこれだけ**
   ```bash
   cd ~/Documents/試験解説作成 && python3 build_<年度>_<科目>_json.py && python3 build_questions_js_animal.py
   cd <アプリ> && npm run validate:content 2>&1 | tail -c 1500
   ```
   `npm run build` と全テストは回さない。

## grounding（根拠）の扱い

- 既定は `grounding_status: "slide_supported"`。スライドに無いことは書かない。
- **年度が古いと現行スライドに論点自体が無いことがある**（担当教員の講義内容が変わるため）。
  その場合は配布解答を根拠に据えて `grounding_status: "official_answer_supported"` とし、
  `official_answer_note` に「現行の授業スライドには該当項目が無いため配布解答に基づく」と明記する。
  `evidence` は空配列でよい。**推測でスライドのページを当てるのは禁止**（ev() が落ちる）。
- 配布解答が「講義資料より出題」等で中身を書いていない設問は、スライドから模範解答を起こし、
  `official_answer_note` にその旨を書く。

## 件数の数え方

大問ではなく**アプリ上の問題数**。`fill_blank` は空欄が何個あっても1問。
```bash
python3 -c "import re;s=open('public/subjects/animalphysiology/questions.js',encoding='utf-8').read();print(len(re.findall(r'\"id\":',s)))"
```
