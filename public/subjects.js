/* ============================================================
   科目マニフェスト
   ------------------------------------------------------------
   新しい科目を足すときは、ここに1行追加するだけでよい。
   アプリ本体（index.html）を触る必要はない。

     1. public/subjects/<id>/questions.js を作る（window.QUIZ_DATA = [...]）
     2. public/subjects/<id>/terms.js を作る  （window.TERM_CARDS = [...]）
        ※ カードが無い科目は terms を省略してよい
     3. 図があれば public/images/<id>/ に置く
     4. 「学習」画面を出す科目は public/subjects/<id>/lessons.js を作る
        （window.LESSONS = [...]。授業回は問題の slideRefs から自動で並ぶので省略可）
     5. この配列に1行足す

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
    learningMode: "cards",
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
    learningMode: "lessons",
    questions: "subjects/genome/questions.js",
    lessons: "subjects/genome/lessons.js",   // 「📖 学習」画面の要点テキスト（省略可）
    expectQuestions: 500,
    hideCards: true,     // この科目では「カード」機能を出さない（メニュー・ハブ・カード一覧）
    hideExamDay: true,   // この科目では「試験日モード」を出さない
  },

  /* --- ここから下は「ボタンだけ」の科目（中身はこれから入れる） ---
     draft:true のあいだは questions.js が無くてもよく、
     科目えらび画面には「準備中」のタイルとして並ぶ。
     中身を入れるときは questions: "subjects/<id>/questions.js" を足して
     draft を消す。問題IDは "<id>-" で始めること。 */
  {
    id: "immunology1",
    name: "免疫学（1年次）",
    emoji: "🛡️",
    accent: "#e11d48",
    learningMode: "lessons",
    draft: true,
    hideCards: true,
    hideExamDay: true,
  },
  {
    id: "immunology2",
    name: "免疫学（2年次）",
    emoji: "🦠",
    accent: "#ea580c",
    learningMode: "lessons",
    questions: "subjects/immunology2/questions.js",
    lessons: "subjects/immunology2/lessons.js",   // 「📖 学習」画面の要点テキスト
    // 2025年度（令和7年度）後半のマーク85問 ＋ 2024年度（令和6年度）後半のマーク80問・記述6問
    // ＋ 2023年度（令和5年度）後半のマーク80問・記述6問
    // ＋ 2022年度（令和4年度）後半のマーク83問・記述6問
    expectQuestions: 346,
    hideCards: true,
    hideExamDay: true,
  },
  {
    id: "animalphysiology",
    name: "動物生理",
    emoji: "🐁",
    accent: "#0ea5e9",
    learningMode: "lessons",
    questions: "subjects/animalphysiology/questions.js",
    // 令和7年度 前期 35問・100点（選択25＋記述10）
    // 令和6年度 前期 31問・100点（選択21＋記述10）
    // 令和5年度 前期 11問・100点（選択3＋記述8。問Ⅱ以外はすべて記述）
    // 令和4年度 前期 11問・100点（選択5＋記述6。公式解答が無い年度）
    expectQuestions: 88,
    hideCards: true,
    hideExamDay: true,
  },
  {
    id: "plantphysiology",
    name: "植物生理",
    emoji: "🌱",
    accent: "#16a34a",
    learningMode: "lessons",
    questions: "subjects/plantphysiology/questions.js",
    lessons: "subjects/plantphysiology/lessons.js",   // 「📖 学習」画面の要点テキスト
    // 2025年度（令和7年度）前期の43問・100点。
    //   選択27問（うち「2つ選べ」3問）＋記述16問（短答9・記述式3・穴埋め3・記述＋記号1）
    // 2024年度（令和6年度）前期の40問・100点。
    //   選択19問（うち「2つ選べ」1問）＋記述21問（短答11・記述式8・穴埋め2）
    // 2023年度（令和5年度）前期の43問・100点。
    //   選択24問＋記述19問（短答13・記述式5・穴埋め1）
    // 2022年度（令和4年度）前期の33問・100点。
    //   選択17問（うち「2つ選べ」5問）＋記述16問（短答9・記述式5・穴埋め2）
    // 2021年度（令和3年度）前期の32問・100点。
    //   選択17問（うち「2つ選べ」2問）＋記述15問（短答9・記述式5・穴埋め1）
    expectQuestions: 191,
    hideCards: true,
    hideExamDay: true,
  },
];
