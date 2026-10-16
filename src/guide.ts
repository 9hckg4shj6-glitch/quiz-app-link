import "./guide.css";

// 使い方ガイド。スタート画面・ホーム・メニューから開く。図は画面を簡略化したイラストで、
// 番号のバッジと本文の手順の番号を対応させる（ゲノム対戦のガイドと同じ作り）。
const SEEN_KEY = "guideSeen_v1";
export const guideSeen = (): boolean => { try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; } };
const markGuideSeen = (): void => { try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* noop */ } };

// ---------- 図（画面を簡略化したイラスト。幅320の座標で描く） ----------
const t = (x: number, y: number, s: string, cls = "", anchor = "start"): string =>
  `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${s}</text>`;
const box = (x: number, y: number, w: number, h: number, cls = "f-card", r = 8): string =>
  `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;
const bars = (x: number, y: number, widths: number[], gap = 8): string => widths.map((w, i) => box(x, y + i * gap, w, 4, "f-soft", 2)).join("");
const hl = (x: number, y: number, w: number, h: number, r = 10): string => `<rect class="f-hl" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;
const badge = (x: number, y: number, n: number): string =>
  `<g class="f-badge"><circle class="f-pulse" cx="${x}" cy="${y}" r="9"/><circle cx="${x}" cy="${y}" r="9"/>${t(x, y + 3.5, String(n), "", "middle")}</g>`;
const figure = (label: string, h: number, body: string): string =>
  `<svg class="guideFig" viewBox="0 0 320 ${h}" role="img" aria-label="${label}">${box(1, 1, 318, h - 2, "f-screen", 16)}${body}</svg>`;

function homeFigure(): string {
  const menu = ["学習", "問題演習", "問題一覧", "復習", "暗記カード", "問題検索"].map((name, i) => {
    const x = 14 + (i % 2) * 148, y = 110 + Math.floor(i / 2) * 40;
    return `${box(x, y, 144, 34)}${box(x + 8, y + 8, 18, 18, "f-chip", 6)}${t(x + 34, y + 21, name, "t-strong")}`;
  }).join("");
  const nav = ["ホーム", "学習", "問題演習", "問題一覧", "問題検索", "復習"].map((name, i) => {
    const x = 14 + (292 / 6) * (i + 0.5);
    return `${i === 0 ? box(x - 20, 249, 40, 30, "f-on", 10) : ""}${box(x - 5, 254, 10, 10, i === 0 ? "f-primary" : "f-soft", 3)}${t(x, 275, name, "t-tiny", "middle")}`;
  }).join("");
  return figure("ホーム画面。上に今日の復習、中央に学習メニュー、下に主要なナビゲーション", 300, `
    ${t(18, 30, "今日は何を学ぶ？", "t-title")}
    ${box(14, 42, 292, 42, "f-card", 12)}${box(24, 51, 24, 24, "f-chip", 8)}${t(56, 60, "今日の復習", "t-strong")}${t(56, 74, "忘れかけた問題が自動で並びます", "t-small")}${t(292, 70, "12件", "t-big t-brand", "end")}
    ${hl(9, 37, 302, 52)}${badge(302, 40, 1)}
    ${t(18, 103, "学習メニュー", "t-label")}${menu}${hl(9, 105, 302, 124)}${badge(302, 108, 2)}
    ${box(14, 244, 292, 40, "f-card", 14)}${nav}${hl(9, 239, 302, 50)}${badge(302, 242, 3)}`);
}

function subjectFigure(): string {
  const tiles = [["ゲノム", "600問・学習済 120問", 0.2], ["免疫学", "506問・学習済 0問", 0]] as const;
  const cards = tiles.map(([name, meta, pct], i) => {
    const x = 14 + i * 148;
    return `${box(x, 138, 144, 92)}${box(x + 12, 150, 26, 26, "f-chip", 8)}${t(x + 12, 196, name, "t-strong")}${t(x + 12, 209, meta, "t-tiny")}
      ${box(x + 12, 216, 120, 4, "f-soft", 2)}${box(x + 12, 216, 120 * pct, 4, "f-primary", 2)}`;
  }).join("");
  return figure("科目えらびの画面。上に前回のつづき、下に科目のタイル", 246, `
    ${t(18, 26, "学習ライブラリ", "t-small t-brand")}${t(18, 44, "今日の学びを選ぼう", "t-title")}
    ${box(14, 56, 292, 54, "f-on", 14)}${box(24, 66, 34, 34, "f-card", 10)}${t(68, 77, "続きから", "t-tiny t-brand")}${t(68, 95, "代謝・生化学", "t-strong t-mid")}${t(292, 89, "→", "t-brand t-mid", "end")}
    ${hl(9, 51, 302, 64)}${badge(302, 54, 1)}
    ${t(18, 130, "医学部1年", "t-label")}${cards}${hl(9, 120, 302, 116)}${badge(302, 123, 2)}`);
}

function lessonFigure(): string {
  return figure("学習の画面。授業回の要点、試験ではこう出る、論点ごとの演習ボタンと学習済みボタン", 286, `
    ${t(18, 28, "第5回　酵素反応の速さ", "t-title")}
    ${box(14, 40, 292, 196, "f-card", 12)}${t(26, 60, "ミカエリス・メンテンの式", "t-strong")}${bars(26, 70, [262, 240, 252, 180])}
    ${box(26, 108, 268, 56, "f-exam", 8)}${t(36, 124, "試験ではこう出る", "t-small t-warn")}${bars(36, 132, [236, 210, 160])}
    ${hl(21, 103, 278, 66, 9)}${badge(302, 106, 1)}
    ${box(26, 180, 150, 28, "f-on", 14)}${t(101, 198, "この論点を3問解く", "t-small t-brand", "middle")}
    ${box(186, 180, 108, 28, "f-card", 14)}${t(240, 198, "✓ 学習済み", "t-small t-strong", "middle")}
    ${hl(21, 175, 160, 38, 16)}${badge(178, 172, 2)}${hl(181, 175, 118, 38, 16)}${badge(302, 172, 3)}
    ${box(14, 246, 292, 30, "f-card", 12)}${bars(26, 256, [200, 150])}`);
}

function practiceFigure(): string {
  const quick = [["全範囲", "全問から出題"], ["ランダム10", "腕試し"], ["苦手を復習", "間違えが多い問題"], ["見直したい問題", "☆で保存した問題"]]
    .map(([name, meta], i) => `${box(14, 106 + i * 30, 292, 26, "f-card", 10)}${t(30, 123 + i * 30, name, "t-strong")}${t(292, 123 + i * 30, meta, "t-tiny", "end")}`).join("");
  return figure("問題演習の画面。問題一覧、クイック演習、試験日モードと本番モード", 324, `
    ${t(18, 28, "問題演習", "t-title")}
    ${box(14, 40, 292, 42, "f-card", 12)}${t(28, 58, "問題一覧（年度別）", "t-strong")}${t(28, 72, "年度・形式ごとに全問を見る", "t-small")}${t(292, 66, "一覧 →", "t-small t-brand", "end")}
    ${t(18, 99, "クイック演習", "t-label")}${quick}${hl(9, 101, 302, 130)}${badge(302, 104, 1)}
    ${t(18, 249, "試験に向けて", "t-label")}
    ${box(14, 256, 144, 44, "f-card", 10)}${t(26, 274, "試験日モード", "t-strong")}${t(26, 288, "忘れない順に出題", "t-tiny")}
    ${box(162, 256, 144, 44, "f-card", 10)}${t(174, 274, "本番モード", "t-strong")}${t(174, 288, "50問・制限時間つき", "t-tiny")}
    ${hl(9, 251, 302, 54)}${badge(302, 254, 2)}`);
}

function quizFigure(): string {
  const choice = (i: number, cls: string, text: string, status: string, statusCls: string): string => {
    const y = 92 + i * 36;
    return `${box(14, y, 292, 32, cls, 10)}${box(22, y + 8, 16, 16, cls === "f-card" ? "f-chip" : `${cls}-key`, 5)}
      ${t(30, y + 19.5, "ABCD"[i], cls === "f-card" ? "t-tiny" : "t-tiny t-on", "middle")}${t(46, y + 14, text, cls === "f-card" ? "t-small" : "t-small t-dark")}
      ${t(46, y + 26, status, statusCls)}`;
  };
  return figure("問題を解く画面。上のバー、選択肢の判定、解説、下のボタン", 384, `
    ${box(14, 12, 292, 32, "f-card", 12)}${box(21, 18, 20, 20, "f-chip", 10)}${t(31, 31.5, "✕", "t-tiny", "middle")}
    ${box(48, 26, 182, 4, "f-soft", 2)}${box(48, 26, 70, 4, "f-primary", 2)}${t(238, 32, "3 / 10", "t-small t-strong")}
    ${box(270, 19, 30, 18, "f-streak", 9)}${t(285, 31.5, "🔥3", "t-tiny", "middle")}${hl(9, 7, 302, 42)}${badge(302, 10, 1)}
    ${t(20, 66, "尿素回路の最初の反応として正しいのは", "t-strong")}${t(20, 80, "どれか。", "t-strong")}
    ${choice(0, "f-good", "アンモニアとCO2からカルバモイルリン酸を作る", "✓ 正解", "t-tiny t-good")}
    ${choice(1, "f-bad", "アルギニンを直接シトルリンに変換する", "✕ あなたの回答", "t-tiny t-bad")}
    ${choice(2, "f-card", "フェニルアラニンをチロシンに変換する", "▾ 解説を見る", "t-tiny t-brand")}
    ${choice(3, "f-card", "フマル酸からアンモニアを生成する", "▾ 解説を見る", "t-tiny t-brand")}
    ${hl(9, 87, 302, 148)}${badge(302, 90, 2)}
    ${box(14, 244, 292, 88, "f-card", 12)}<circle class="f-bad-key" cx="30" cy="262" r="8"/>${t(30, 265.5, "✕", "t-tiny t-on", "middle")}${t(44, 266, "不正解", "t-strong t-bad")}
    ${box(24, 274, 272, 18, "f-good", 6)}${t(32, 286.5, "正解 A　アンモニアとCO2からカルバモイルリン酸…", "t-tiny t-good")}
    ${bars(24, 300, [262, 240, 200])}${hl(9, 239, 302, 98)}${badge(302, 242, 3)}
    ${box(14, 344, 292, 32, "f-card", 14)}${box(22, 349, 30, 22, "f-chip", 10)}${t(37, 364, "←", "t-small", "middle")}
    ${box(58, 349, 240, 22, "f-primary", 11)}${t(178, 364, "次の問題 →", "t-small t-on", "middle")}${hl(9, 339, 302, 42)}${badge(302, 342, 4)}`);
}

function reviewFigure(): string {
  return figure("記憶の残り方の図。復習するたびに記憶が戻り、次に忘れかけるまでの間隔が延びる", 232, `
    ${t(18, 28, "記憶の残り方と、復習のタイミング", "t-title")}
    <path class="f-axis" d="M30 194H302M30 194V46"/>${t(36, 52, "覚えている度合い", "t-tiny")}${t(302, 210, "日数 →", "t-tiny", "end")}
    <path class="f-forget" d="M30 128H302"/>${t(300, 122, "忘れかける", "t-tiny t-warn", "end")}
    <path class="f-curve" d="M30 60C48 96 70 118 88 130L88 60C122 86 150 108 170 126L170 60C218 78 262 94 302 104"/>
    <circle class="f-dot" cx="88" cy="130" r="4"/><circle class="f-dot" cx="170" cy="126" r="4"/>
    ${t(88, 146, "復習①", "t-tiny t-brand", "middle")}${t(170, 142, "復習②", "t-tiny t-brand", "middle")}
    ${badge(88, 168, 1)}${badge(236, 70, 2)}`);
}

// ---------- 本文 ----------
const steps = (items: string[]): string => `<ol class="guideSteps">${items.map((s) => `<li>${s}</li>`).join("")}</ol>`;
const tips = (items: string[]): string => `<ul class="guideTips">${items.map((s) => `<li>${s}</li>`).join("")}</ul>`;
const section = (id: string, eyebrow: string, title: string, body: string): string =>
  `<section class="guideSection" id="guide-${id}"><p class="guideEyebrow">${eyebrow}</p><h2 tabindex="-1">${title}</h2>${body}</section>`;

const SECTIONS = [
  { id: "start", label: "はじめに" },
  { id: "install", label: "おすすめ：ホーム画面に追加", recommended: true },
  { id: "subject", label: "科目をえらぶ" },
  { id: "learn", label: "学ぶ" },
  { id: "practice", label: "問題演習" },
  { id: "answer", label: "解く画面の見方" },
  { id: "review", label: "復習のしくみ" },
  { id: "records", label: "記録とレベル" },
  { id: "data", label: "記録の保存" },
  { id: "tools", label: "便利な機能" },
  { id: "faq", label: "よくある質問" },
];

function renderGuide(): string {
  const toc = SECTIONS.map((s) => `<button type="button" class="guideChip${s.recommended ? " recommended" : ""}" data-guide-jump="guide-${s.id}">${s.label}</button>`).join("");
  return `<header class="guideBar"><b id="guideTitle">使い方ガイド</b><button type="button" class="guideClose" data-guide-close aria-label="ガイドを閉じる">✕</button></header>
  <div class="guideBody">
    <div class="guideHero"><p class="guideEyebrow">HOW TO USE</p><h1>このアプリの使い方</h1>
      <p>基礎医学の過去問・予想問題を、科目ごとに<b>読む・解く・振り返る</b>ためのアプリです。気になる項目から読めます。</p></div>
    <nav class="guideToc" aria-label="ガイドの目次">${toc}</nav>

    ${section("start", "STEP BY STEP", "はじめに：3ステップで始める", `
      <div class="guideQuick">
        <div><b>1</b><strong>科目をえらぶ</strong><p>スタート画面の「スタートして科目を選ぶ」から、学ぶ科目を選びます。次からは一番上の「続きから」で前回の科目に戻れます。</p></div>
        <div><b>2</b><strong>学ぶ・解く</strong><p>授業の要点を読んでも、いきなり過去問を解いてもかまいません。答えるたびに正解と解説が出ます。</p></div>
        <div><b>3</b><strong>忘れる前に復習</strong><p>解いた問題は、忘れかけるころに「今日の復習」へ自動で並びます。</p></div>
      </div>
      ${homeFigure()}
      ${steps([
        "<b>今日の復習</b>：復習の時期が来た問題の数。押すとそのまま復習が始まります",
        "<b>学習メニュー</b>：学習（授業の要点）・問題演習・問題一覧・復習・暗記カード・問題検索",
        "<b>下のナビ</b>：どの画面からでも、ホーム・学習・問題演習・問題一覧・問題検索・復習へ移れます",
      ])}`)}

    ${section("install", "RECOMMENDED", "おすすめ：ホーム画面に追加", `
      <p>ホーム画面に追加すると、アプリのように全画面で開け、電波がない場所でも使えます。</p>
      ${steps([
        "<b>iPhone</b>：Safari で開き、下の共有ボタン →「ホーム画面に追加」",
        "<b>Android</b>：Chrome のメニュー（︙）→「アプリをインストール」または「ホーム画面に追加」",
      ])}
      ${tips(["iPhone では、Safari で開いたときとホーム画面のアプリとで、記録が別々に保存されます。ホーム画面に追加してから使い始めるか、Googleでログインして記録をそろえてください。"])}`)}

    ${section("subject", "SUBJECTS", "科目をえらぶ", `
      ${subjectFigure()}
      ${steps([
        "<b>続きから</b>：前回の科目にすぐ戻れます",
        "<b>科目のタイル</b>：問題数と、学習済みの問題数が出ます。「準備中」の科目は問題を追加中です",
      ])}
      ${tips(["科目を切り替えても、それぞれの科目の記録は残ります。右上のメニュー「科目をえらぶ」からも切り替えられます。"])}`)}

    ${section("learn", "LEARN", "学ぶ：授業の要点を読む", `
      ${lessonFigure()}
      ${steps([
        "<b>試験ではこう出る</b>：その論点が、どんな設問の形で出るか・どこが引っかけかをまとめています",
        "<b>この論点を解く</b>：読んだ論点の問題を、その場で数問解けます。解き終えると、読んでいた位置に戻れます",
        "<b>学習済み</b>：読み終えた項目に印を付けておけます",
      ])}
      ${tips(["下のナビの「学習」から授業回を選びます。科目によっては、講義カードをめくって覚える形です。", "解説の中の「学習編で読む」から、関係する要点へ移ることもできます。"])}`)}

    ${section("practice", "PRACTICE", "問題演習：範囲を選んで解く", `
      ${practiceFigure()}
      ${steps([
        "<b>クイック演習</b>：全範囲・ランダム10問・苦手な問題・☆で保存した問題から、すぐに始められます",
        "<b>試験に向けて</b>：試験日を決めると、覚えた内容を試験日まで忘れない順に出題します。本番モードは分野のバランスをとった50問を、制限時間つき・100点満点で解きます",
      ])}
      ${tips(["年度別・予想問題・分野別の一覧から、範囲を絞って解くこともできます。", "範囲を選ぶと、1回に解く問題数を選んでから始まります。"])}`)}

    ${section("answer", "HOW TO ANSWER", "解く画面の見方", `
      ${quizFigure()}
      ${steps([
        "<b>上のバー</b>：✕ から「保存して中断」「ここで終了して結果を見る」。🔥は3問連続で正解すると出て、連続正解でXPが増えます",
        "<b>選択肢</b>：答えると、正解と自分の誤答にだけ色が付きます。ほかの選択肢も「解説を見る」で理由を読めます。わからないときは「わからない（解答を見る）」",
        "<b>解説</b>：正解したときは「勘だった・むずかしい・できた・かんたん」から手ごたえを選びます。これで次の復習の時期が決まります。間違えたときは「なぜ間違えた？」にメモを残せます",
        "<b>下のボタン</b>：答える前は「後で解く」、答えると同じ場所が「次の問題 →」に変わります",
      ])}
      ${tips(["途中で閉じても自動で保存されます。ホームの「途中の演習」から続きを再開できます。", "右上の「☆ 見直す」で、あとで見直したい問題に保存できます。"])}`)}

    ${section("review", "REVIEW", "復習のしくみ：忘れる前に、もう一度", `
      ${reviewFigure()}
      ${steps([
        "解いた問題は、<b>忘れかけるころ</b>に「今日の復習」へ自動で並びます。間違えた問題は早めに、手ごたえが「かんたん」だった問題は遅めに出ます",
        "復習するたびに記憶が長持ちするようになり、<b>次の復習までの間隔が延びます</b>",
      ])}
      ${tips(["累計で2回間違えた問題は「苦手問題」になり、2回続けて正解すると外れます。", "下のナビの「復習」から、今日の復習・解いた問題の一覧と、苦手問題・見直したい問題・誤答ノートを開けます。"])}`)}

    ${section("records", "RECORDS", "記録とレベル", `
      <dl class="guideDefs">
        <div><dt>学習状況</dt><dd>学習の記録、忘却曲線（記憶がこれからどう薄れていくかの見込み）、毎日の学習アクティビティ、実績を見られます。</dd></div>
        <div><dt>レベルとXP</dt><dd>正解で10XP、不正解でも挑戦した分の3XP。連続正解中はXPが増えます（3問で1.5倍、5問で2倍、8問で3倍）。</dd></div>
        <div><dt>ランキング</dt><dd>参加は任意です。ホームの「ランキング」で「参加する」を押すと、スタート画面で入れた名前で載ります。</dd></div>
        <div><dt>コミュニティ</dt><dd>掲示板で、質問や情報を共有できます。</dd></div>
      </dl>`)}

    ${section("data", "DATA", "記録の保存とアカウント", `
      <dl class="guideDefs">
        <div><dt>ゲスト</dt><dd>記録はこの端末（このブラウザ）にだけ保存されます。</dd></div>
        <div><dt>Googleでログイン</dt><dd>記録をアカウントに保存し、スマホとPCなど複数の端末でそろえられます。ホームの「設定・データ」の「端末間同期」から。</dd></div>
        <div><dt>手動バックアップ</dt><dd>「設定・データ」から記録をファイルに書き出し、「データ読込」で戻せます。</dd></div>
        <div><dt>名前</dt><dd>スタート画面で入れた名前は、管理者の利用者一覧に表示されます。変えるときは右上のメニュー「スタート画面」から。</dd></div>
      </dl>`)}

    ${section("tools", "TOOLS", "便利な機能", `
      <dl class="guideDefs">
        <div><dt>読みやすさ</dt><dd>「設定・データ」で、文字の大きさと行間を変えられます。</dd></div>
        <div><dt>ライト／ダーク</dt><dd>右上のメニュー「テーマ切替」で切り替えます。</dd></div>
        <div><dt>キーボード（PC）</dt><dd>A〜E または 1〜9 で選択肢を選び、Enter か → で次の問題、← で前の問題、L で後で解く。</dd></div>
        <div><dt>問題検索</dt><dd>キーワードから問題を探せます。</dd></div>
        <div><dt>更新情報</dt><dd>右上の 🔔 から、追加された問題や新しい機能を確認できます。</dd></div>
      </dl>`)}

    ${section("faq", "FAQ", "よくある質問", `
      <dl class="guideDefs">
        <div><dt>記録が消えた</dt><dd>ブラウザのサイトデータを消すと、ゲストの記録も消えます。iPhone では Safari とホーム画面のアプリで記録が別々です。大事な記録は Googleでログインするか、手動バックアップで残してください。</dd></div>
        <div><dt>名前を変えたい</dt><dd>右上のメニュー「スタート画面」で入れ直して、「スタートして科目を選ぶ」を押してください。</dd></div>
        <div><dt>このガイドをもう一度見たい</dt><dd>スタート画面・ホームの「使い方ガイド」・右上のメニューから、いつでも開けます。</dd></div>
      </dl>`)}
  </div>`;
}

let dialog: HTMLDialogElement | null = null;

function buildDialog(): HTMLDialogElement {
  const d = document.createElement("dialog");
  d.className = "guideDialog";
  d.setAttribute("aria-labelledby", "guideTitle");
  d.innerHTML = renderGuide();
  d.addEventListener("click", (event) => {
    const target = event.target as Element;
    if (target === d || target.closest("[data-guide-close]")) { d.close(); return; }
    const jump = target.closest<HTMLElement>("[data-guide-jump]");
    if (jump) {
      const heading = d.querySelector<HTMLElement>(`#${jump.dataset.guideJump} h2`);
      heading?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      heading?.focus({ preventScroll: true });
    }
  });
  // 開いている間は後ろの画面をスクロールさせない
  d.addEventListener("close", () => { document.documentElement.style.overflow = ""; });
  document.body.append(d);
  return d;
}

export function openGuide(sectionId?: string): void {
  dialog ??= buildDialog();
  markGuideSeen();
  if (!dialog.open) dialog.showModal();
  document.documentElement.style.overflow = "hidden";
  const target = sectionId ? dialog.querySelector<HTMLElement>(`#guide-${sectionId} h2`) : null;
  if (target) target.scrollIntoView({ block: "start" });
  else dialog.scrollTop = 0;
}
