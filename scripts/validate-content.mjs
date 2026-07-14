import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadBrowserData(filename, globalName) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(filename, "utf8"), sandbox, { filename });
  const value = sandbox.window[globalName];
  if (!Array.isArray(value)) throw new Error(`${filename}: window.${globalName} が配列ではありません`);
  return value;
}

const questions = loadBrowserData("public/questions.js", "QUIZ_DATA");
const terms = loadBrowserData("public/terms.js", "TERM_CARDS");
const errors = [];
const ids = new Set();

for (const [index, question] of questions.entries()) {
  const id = String(question?.id ?? `question-${index}`);
  if (ids.has(id)) errors.push(`問題IDが重複しています: ${id}`);
  ids.add(id);
  if (!question?.question || !Array.isArray(question.choices) || question.choices.length < 2) errors.push(`問題 ${id}: 問題文または選択肢が不足しています`);
  if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer >= question.choices.length) errors.push(`問題 ${id}: 正解番号が範囲外です`);
  if (question.image && !fs.existsSync(path.join("public", question.image))) errors.push(`問題 ${id}: 画像がありません (${question.image})`);
}

for (const [index, term] of terms.entries()) {
  const id = String(term?.id ?? `term-${index}`);
  if (ids.has(id)) errors.push(`カードIDが重複しています: ${id}`);
  ids.add(id);
  if (!term?.term) errors.push(`用語カード ${id}: 表面がありません`);
  if (term.image && !fs.existsSync(path.join("public", term.image))) errors.push(`用語カード ${id}: 画像がありません (${term.image})`);
}

if (questions.length !== 790) errors.push(`問題数が想定と異なります: ${questions.length} / 790`);
if (terms.length !== 337) errors.push(`用語カード数が想定と異なります: ${terms.length} / 337`);
if (errors.length) {
  console.error(errors.slice(0, 50).join("\n"));
  process.exit(1);
}
console.log(`Content OK: ${questions.length} questions, ${terms.length} term cards, ${ids.size} unique IDs.`);
