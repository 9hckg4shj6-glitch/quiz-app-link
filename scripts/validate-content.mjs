import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadBrowserData(filename, globalName, { optional = false } = {}) {
  if (optional && !fs.existsSync(filename)) return [];
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(filename, "utf8"), sandbox, { filename });
  const value = sandbox.window[globalName];
  if (!Array.isArray(value)) throw new Error(`${filename}: window.${globalName} が配列ではありません`);
  return value;
}

const subjects = loadBrowserData("public/subjects.js", "SUBJECTS");
if (!subjects.length) throw new Error("public/subjects.js に科目が1つも登録されていません");

const errors = [];
const ids = new Set();          // IDは科目をまたいで一意でなければならない
                                // （進捗とFSRSの復習予定が問題IDで紐づいているため）
let totalQuestions = 0;
let totalTerms = 0;

for (const subject of subjects) {
  const label = subject.name || subject.id;
  // 新しい科目は "<id>-" で始まるIDを必須にする。既存科目は idPrefix:null で免除。
  const prefix = subject.idPrefix === null ? null : (subject.idPrefix || `${subject.id}-`);

  const questions = subject.questions
    ? loadBrowserData(path.join("public", subject.questions), "QUIZ_DATA")
    : [];
  const terms = subject.terms
    ? loadBrowserData(path.join("public", subject.terms), "TERM_CARDS", { optional: true })
    : [];
  totalQuestions += questions.length;
  totalTerms += terms.length;

  for (const [index, question] of questions.entries()) {
    const id = String(question?.id ?? `question-${index}`);
    if (ids.has(id)) errors.push(`[${label}] 問題IDが重複しています: ${id}`);
    ids.add(id);
    if (prefix && !id.startsWith(prefix)) errors.push(`[${label}] 問題ID ${id} は "${prefix}" で始めてください（科目をまたぐID衝突を防ぐため）`);
    if (!question?.question || !Array.isArray(question.choices) || question.choices.length < 2) errors.push(`[${label}] 問題 ${id}: 問題文または選択肢が不足しています`);
    if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer >= question.choices.length) errors.push(`[${label}] 問題 ${id}: 正解番号が範囲外です`);
    if (question.answers != null) {
      if (!Array.isArray(question.answers) || question.answers.length < 2) errors.push(`[${label}] 問題 ${id}: answers は2つ以上の配列にしてください`);
      else {
        if (question.answers[0] !== question.answer) errors.push(`[${label}] 問題 ${id}: answers[0] と answer が一致していません`);
        for (const a of question.answers) {
          if (!Number.isInteger(a) || a < 0 || a >= question.choices.length) errors.push(`[${label}] 問題 ${id}: answers に範囲外の番号があります`);
        }
        if (new Set(question.answers).size !== question.answers.length) errors.push(`[${label}] 問題 ${id}: answers に重複があります`);
      }
    }
    if (question.image && !fs.existsSync(path.join("public", question.image))) errors.push(`[${label}] 問題 ${id}: 画像がありません (${question.image})`);
  }

  // 「学習」画面の要点テキスト。deck は問題の slideRefs と一致していなければ
  // 章と問題が結びつかず、参照したスライド画像が無ければ図が欠ける。
  const lessons = subject.lessons
    ? loadBrowserData(path.join("public", subject.lessons), "LESSONS", { optional: true })
    : [];
  if (lessons.length) {
    const decks = new Set();
    for (const question of questions) {
      for (const ref of question?.slideRefs || []) if (ref?.deck) decks.add(String(ref.deck));
    }
    const slidePath = (deck, page) =>
      path.join("public", "images", subject.id, "slides", `${deck}-p${String(page).padStart(3, "0")}.webp`);
    const seenDecks = new Set();
    for (const [index, lesson] of lessons.entries()) {
      const deck = String(lesson?.deck ?? "");
      if (!deck) { errors.push(`[${label}] 学習 ${index + 1}件目: deck がありません`); continue; }
      if (seenDecks.has(deck)) errors.push(`[${label}] 学習 deck ${deck} が重複しています`);
      seenDecks.add(deck);
      if (!decks.has(deck)) errors.push(`[${label}] 学習 deck ${deck}: この deck を持つ問題（slideRefs）がありません`);
      const pages = [...(lesson.keySlides || [])];
      for (const section of lesson.sections || []) pages.push(...(section?.slides || []));
      for (const page of pages) {
        const file = slidePath(deck, page);
        if (!fs.existsSync(file)) errors.push(`[${label}] 学習 deck ${deck}: スライド画像がありません (${file})`);
      }
    }
  }

  for (const [index, term] of terms.entries()) {
    const id = String(term?.id ?? `term-${index}`);
    if (ids.has(id)) errors.push(`[${label}] カードIDが重複しています: ${id}`);
    ids.add(id);
    if (!term?.term) errors.push(`[${label}] 用語カード ${id}: 表面がありません`);
    if (term.image && !fs.existsSync(path.join("public", term.image))) errors.push(`[${label}] 用語カード ${id}: 画像がありません (${term.image})`);
  }

  if (typeof subject.expectQuestions === "number" && questions.length !== subject.expectQuestions) {
    errors.push(`[${label}] 問題数が想定と異なります: ${questions.length} / ${subject.expectQuestions}`);
  }
  if (typeof subject.expectTerms === "number" && terms.length !== subject.expectTerms) {
    errors.push(`[${label}] 用語カード数が想定と異なります: ${terms.length} / ${subject.expectTerms}`);
  }
  // draft の科目はこれから中身を入れるところなので、0件でもエラーにしない
  if (!subject.draft && !questions.length && !terms.length) errors.push(`[${label}] 問題もカードも0件です`);
}

if (errors.length) {
  console.error(errors.slice(0, 50).join("\n"));
  process.exit(1);
}
console.log(`Content OK: ${subjects.length} subject(s), ${totalQuestions} questions, ${totalTerms} term cards, ${ids.size} unique IDs.`);
