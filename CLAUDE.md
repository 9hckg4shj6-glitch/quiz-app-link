<!-- 出典: Austin1serb/agents-md (GitHub 150★) の AGENTS.md をこのリポジトリ向けに導入。
     https://github.com/Austin1serb/agents-md
     「不要な作業を減らす」ことで token を削る運用ルール。常時ロードされる。 -->

# Coding Agent Instructions

## Operating Principles

Keep it simple. Simple is better than complex.
Assume the user is a principal engineer.
Make the smallest maintainable change that solves the actual request.
Prefer existing patterns over new abstractions.
Avoid broad refactors, speculative helpers, and clever architecture unless clearly justified.
Use judgment. Read enough surrounding code to understand the existing pattern, then avoid unnecessary exploration.
Optimize for correctness, speed, judgment, and token efficiency.
Correct the user when appropriate.
Prefer FAANG-level code quality: clear naming, strong types, simple control flow, minimal mutation, focused functions, pure functions/components where practical, and no unnecessary abstraction.

## Context Discipline

Protect context aggressively.

Answer the narrow question first. Inspect the smallest relevant file, symbol, route, component, diff, log, or test output.

Prefer targeted searches, focused file sections, nearby call sites, capped logs, and scoped validation. Avoid running validation commands like `npm run build`, `npm run test`, or `npm run lint` unless absolutely necessary. Use normal scoped commands like `rg`, with a byte cap when needed.

Avoid dumping full files, full logs, unrelated directories, broad repo searches, large diffs, or generated output after the relevant code is found.

Do not byte-cap instruction files, skill files, tool docs, or agent policy files. Read the whole relevant file unless it is unexpectedly huge.

## Command Output

Protect context usage. **Any command with unknown or potentially large output must be scoped and byte-capped.**

Byte-cap unknown or potentially large output. Line caps alone are unsafe because a single line can be huge.

```bash
COMMAND 2>&1 | head -c 4000
COMMAND 2>&1 | tail -c 4000
```

### Good Byte Capping Examples

```bash
rg -n -m 20 'functionName|ComponentName|routeName' src 2>&1 | head -c 200
bash -o pipefail -c 'npm run type-check 2>&1 | tail -c 500'
bash -o pipefail -c 'npm run test 2>&1 | tail -c 2000'
bash -o pipefail -c 'npm run build 2>&1 | tail -c 500'
rg -l "SEARCH_TERM" src 2>&1 | head -c 4000
```

Do not rely on `head -n`, `tail -n`, or `sed -n` as the only cap.

Scope before printing content: list files first, search specific paths, count matches when useful, and avoid reading generated, binary, minified, database, or huge JSON/JSONL files unless required.

Preserve exit codes when needed:

```bash
tmp="$(mktemp)"
COMMAND >"$tmp" 2>&1
status=$?
tail -c 5000 "$tmp"
rm -f "$tmp"
exit "$status"
```

Avoid unbounded `cat`, broad `rg`, `find`, `ls -R`, `git diff`, tests, builds, and `select *`.

If capped output is insufficient, narrow the command before increasing the cap.

## Code Changes

Prefer direct edits with the available patch tool.
Patch the narrow failing path first.
Avoid unrelated cleanup.
Do not add helpers, wrappers, maps, files, abstractions, or validation layers unless they clearly reduce complexity.

## Patterns to Avoid

Avoid single-use abstractions.

Prefer inline types and direct logic when a helper, wrapper, map, or named type is used only once.

Avoid wrapper functions that simply call another function.

## Validation

Match validation to risk.

Skip validation for low-risk changes and say so plainly.
Use the cheapest useful check for risky changes.
Do not run full test suites or full builds unless risk justifies it or the user asks.

## Subagents

Use subagents only when they save context, save time, or materially improve output quality.

For research, review, and exploration tasks, avoid confirmation bias. Do not pass a preferred conclusion. Ask the subagent to investigate, compare, or verify, and require evidence, tradeoffs, uncertainty, and better alternatives.

Prefer subagents for:

- documentation/API checks
- web research
- non-trivial copywriting/content generation

Avoid subagents for trivial work the main agent can finish faster.

When using a subagent, assign a narrow task and require:

- findings
- files inspected
- files changed, if any
- validation run, if any
- risks or uncertainty

You own final judgment and integration.

## Communication

Before editing, state the approach only for non-trivial tasks.

During complex work, keep updates short:

- what was found
- what changed
- what risk remains

After work, summarize:

- what changed
- files touched
- validation run, or why skipped
- remaining risk

Keep summaries short. Do not explain obvious edits.

Oververbosity:low

---

## このリポジトリ固有の節約ルール（日本語）

上の原則をこのプロジェクトに落とし込んだもの。ここを守るだけで無駄な読み込みがかなり減る。

### 生成物を読まない・直さない

- `public/subjects/*/questions.js` は **自動生成物**。中身を全文読むのも手で直すのも禁止。
  正は `~/Documents/試験解説作成/output/data/*.json`。直すときは JSON を直して
  `build_questions_js*.py` を再実行する。
- 確認したいときは全文 `cat` せず、件数・IDだけ抜く:
  ```bash
  python3 -c "import re;s=open('public/subjects/<id>/questions.js',encoding='utf-8').read();print(len(re.findall(r'\"id\":',s)))"
  ```
- `dist/`, `node_modules/`, `.min.*`, 大きな JSON は読まない。

### 授業スライドPDFの読み方

- `materials/*/lectures/*.pdf` は 4-up の配布資料。**必要なページだけ**を読む。
  全ページを Read に流さない。ページ当たりの探索は `slide_search.py` か PyMuPDF の
  `get_text()` で該当キーワードのある象限だけ取り出す。
- 図を切り出すときは座標を `get_image_info()` で取り、検証は「1枚のモンタージュを1回 Read」。
  1枚ずつ Read で確認しない。

### 過去問を1年度追加するときの最短手順

1. 原本PDFを `materials/<科目>/exams/` に置く
2. `~/Documents/試験解説作成/build_<年度>_<科目>_json.py` を作る（既存年度をコピーして差分だけ）
3. `build_questions_js*.py` の `SOURCES` に1件足して実行
4. `public/subjects.js` の `expectQuestions` を更新
5. `npm run validate:content` だけ流す（ビルド・全テストは回さない）

### 検証はリスクに合わせる

- 内容追加だけなら `validate:content` で十分。`npm run build` や全テストは回さない。
- コマンド出力は必ずバイト上限を付ける（`2>&1 | tail -c 2000`）。
