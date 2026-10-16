// スタート画面の動くモデル。どれを動かすかは利用者がスタート画面のボタンで選ぶ（index.html が端末に覚える）。
// 各モデルは src/start-models/ に1つずつ置き、ここに並べた順にボタンが並ぶ。先頭が最初の既定。
// 動きを減らす設定では、各モデルの止め絵を1枚だけ描く。画面が隠れている間は進めない。
import { readPalette, type Frame } from "./start-models/common";
import { ecg } from "./start-models/ecg";
import { extravasation } from "./start-models/extravasation";
import { neutrophil } from "./start-models/neutrophil";
import { sarcomere } from "./start-models/sarcomere";
import { cochlea } from "./start-models/cochlea";
import { atpSynthase } from "./start-models/atp-synthase";
import { dosing } from "./start-models/dosing";

export const START_MODELS = [ecg, extravasation, neutrophil, sarcomere, cochlea, atpSynthase, dosing];

// スタート画面を描いたあとに呼ぶ。戻り値の関数で止める（画面を閉じるとき・別のモデルに替えるとき）。
export function mountStartModel(canvas: HTMLCanvasElement, id: string): () => void {
  const model = START_MODELS.find((m) => m.id === id) ?? START_MODELS[0];
  const g = canvas.getContext("2d");
  if (!g) return () => {};
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let palette = readPalette(), width = 0, height = 0, t = 0, last = 0, raf = 0, frames = 0, stopped = false;
  let frame: Frame | null = null;

  const draw = (dt: number) => {
    if (!frame) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, width, height);
    frame(g, t, dt, palette);
  };
  const resize = () => {
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (!rect.width || !rect.height) return;
    width = rect.width; height = rect.height;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    frame = model.create(width, height, reduce);
    if (reduce) draw(0);
  };
  const tick = (now: number) => {
    if (stopped) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    if (frame && document.visibilityState === "visible") {
      if (++frames % 60 === 0) palette = readPalette();   // ライト／ダークの切り替えに追従する
      t += dt; draw(dt);
    }
    raf = requestAnimationFrame(tick);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  if (!reduce) raf = requestAnimationFrame(tick);
  return () => { stopped = true; cancelAnimationFrame(raf); observer.disconnect(); };
}
