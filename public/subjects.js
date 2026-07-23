/* ============================================================
   科目マニフェスト
   ------------------------------------------------------------
   新しい科目を足すときは、ここに1行追加するだけでよい。
   アプリ本体（index.html）を触る必要はない。

     1. public/subjects/<id>/questions.js を作る（window.QUIZ_DATA = [...]）
     2. public/subjects/<id>/terms.js を作る  （window.TERM_CARDS = [...]）
        ※ カードが無い科目は terms を省略してよい
     3. 図があれば public/images/<id>/ に置く
     4. この配列に1行足す

   【重要】問題ID・カードIDは必ず科目ごとに一意にすること。
   進捗（localStorage）とFSRSの復習予定（IndexedDB）はIDで紐づいているため、
   科目をまたいでIDが衝突すると学習記録が混ざる。
   新しい科目のIDは "<id>-" で始める規約とし、validate:content が検査する。
   （代謝は既存ユーザーの記録を守るため、歴史的にプレフィックスなしのままとする）
   ============================================================ */

window.SUBJECTS = [
  {
    id: "metabolism",
    name: "代謝・生化学",
    emoji: "⚗️",
    accent: "#147d8f",
    questions: "subjects/metabolism/questions.js",
    terms: "subjects/metabolism/terms.js",
    idPrefix: null,          // 既存科目のみ例外的にプレフィックス検査を免除
    expectQuestions: 1039,   // 件数の取りこぼし検知（増減させたらこの数も更新する）
    expectTerms: 558,
  },
  {
    id: "genome",
    name: "ゲノム",
    emoji: "🧬",
    accent: "#7c3aed",
    questions: "subjects/genome/questions.js",
    expectQuestions: 200,
  },
];
