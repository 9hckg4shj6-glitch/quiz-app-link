// スタート画面の動くモデルで共通に使う型と小さな関数。
// 色は CSS 変数から読むので、ライト／ダークの切り替えに追従する。

export interface Palette { brand: string; brand2: string; good: string; bad: string; warn: string; text: string; muted: string; card: string }

// 1コマ描く関数。t は動き始めからの秒数、dt は前のコマからの秒数（止め絵では 0）
export type Frame = (g: CanvasRenderingContext2D, t: number, dt: number, p: Palette) => void;

export interface StartModel {
  id: string;
  label: string;   // 選ぶボタンの文字
  note: string;    // キャンバスの下の説明（HTML。主役を <b> で強調）
  // キャンバスの大きさが決まるたびに呼ぶ。still（動きを減らす設定）のときは、返した関数で1枚だけ描く
  create(width: number, height: number, still: boolean): Frame;
}

export function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
  return {
    brand: v("--brand", "#147d8f"), brand2: v("--brand2", "#1f6feb"), good: v("--good", "#12a559"), bad: v("--bad", "#e23b52"),
    warn: v("--warn", "#c98a00"), text: v("--text", "#141931"), muted: v("--muted", "#5b6488"), card: v("--card", "#ffffff"),
  };
}

// "#rgb" / "#rrggbb" を透明度つきの rgba() にする
export function rgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const n = Number.parseInt(full, 16);
  return Number.isNaN(n) ? `rgba(128,128,128,${alpha})` : `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
// a〜b の間で 0→1 に進む（外側では 0 か 1）
export const ramp = (x: number, a: number, b: number): number => clamp((x - a) / (b - a), 0, 1);
export const smooth = (x: number): number => x * x * (3 - 2 * x);
// a〜b の間だけ 0→1→0 と山になる
export const bump = (x: number, a: number, b: number): number => (x <= a || x >= b ? 0 : Math.sin(((x - a) / (b - a)) * Math.PI));

export const font = (px: number, weight = 600): string =>
  `${weight} ${Math.round(px)}px system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif`;

// ふちのぼやけた光の点
export function glow(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, rgba(color, alpha)); grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}

export type Pt = readonly [number, number];

// Catmull-Rom の曲線で点を滑らかにつなぐ
export function spline(c: CanvasPath, pts: readonly Pt[], closed: boolean): void {
  const n = pts.length, at = (i: number): Pt => pts[closed ? (i + n) % n : clamp(i, 0, n - 1)];
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    c.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
  }
  if (closed) c.closePath();
}
// 同じ曲線を細かい折れ線にする（途中まで光らせる・時刻を割り振るため）
export function dense(pts: readonly Pt[], steps = 10): Pt[] {
  const n = pts.length, at = (i: number): Pt => pts[clamp(i, 0, n - 1)], out: Pt[] = [pts[0]];
  for (let i = 0; i < n - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let s = 1; s <= steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}
export const pathOf = (pts: readonly Pt[], closed: boolean): Path2D => { const p = new Path2D(); spline(p, pts, closed); return p; };

export function roundRect(g: CanvasPath, x: number, y: number, w: number, h: number, r: number): void {
  if (g instanceof CanvasRenderingContext2D) g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// 日本語を幅に収まるよう1文字ずつ折り返す
export function wrap(g: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of text) { if (line && g.measureText(line + ch).width > width) { lines.push(line); line = ch; } else line += ch; }
  return line ? [...lines, line] : lines;
}

// 名札：box（中心）に文字を出し、anchors（指す先）へ線を引く。座標は画面の px。\n で改行
export function drawTag(g: CanvasRenderingContext2D, text: string, box: Pt, anchors: readonly Pt[], alpha: number, fs: number, p: Palette): void {
  if (alpha <= 0) return;
  const lines = text.split("\n"), lh = fs + 1;
  g.save(); g.globalAlpha = alpha; g.font = font(fs - 1, 700); g.textAlign = "center"; g.textBaseline = "middle";
  const tw = Math.max(...lines.map((l) => g.measureText(l).width)) + 14, th = lines.length * lh + 7;
  g.strokeStyle = rgba(p.warn, 0.9); g.fillStyle = p.warn; g.lineWidth = 1;
  for (const [x, y] of anchors) { g.beginPath(); g.moveTo(box[0], box[1]); g.lineTo(x, y); g.stroke(); g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill(); }
  roundRect(g, box[0] - tw / 2, box[1] - th / 2, tw, th, Math.min(th / 2, 11));
  g.fillStyle = rgba(p.card, 0.94); g.fill(); g.strokeStyle = rgba(p.warn, 0.9); g.stroke();
  g.fillStyle = p.text; lines.forEach((l, i) => g.fillText(l, box[0], box[1] + 0.5 + (i - (lines.length - 1) / 2) * lh));
  g.restore();
}

// 進み具合の点と、いまの出来事（\n で改行位置を決める）。fresh は切り替わった直後の 0→1。backdrop で白い下地をつける
export function drawSteps(g: CanvasRenderingContext2D, x: number, top: number, width: number, steps: readonly string[], now: number, fresh: number, fs: number, p: Palette, backdrop = false): void {
  g.font = font(fs, 700);
  const lh = fs * 1.35, lines = steps[now].split("\n").flatMap((part) => wrap(g, part, width)).slice(0, 3);
  if (backdrop) {
    roundRect(g, x - 9, top - 8, width + 18, 18 + fs * 1.75 + (lines.length - 1) * lh, 10);
    g.fillStyle = rgba(p.card, 0.88); g.fill(); g.strokeStyle = rgba(p.text, 0.08); g.lineWidth = 1; g.stroke();
  }
  for (let i = 0; i < steps.length; i++) {
    g.fillStyle = i === now ? p.warn : rgba(p.muted, 0.4);
    g.beginPath(); g.arc(x + 4 + i * 11, top + 3, i === now ? 3.4 : 2.6, 0, Math.PI * 2); g.fill();
  }
  g.textAlign = "left"; g.fillStyle = rgba(p.text, 0.88 * Math.max(0.25, fresh));
  lines.forEach((line, i) => g.fillText(line, x, top + 3 + fs * 1.45 + i * lh));
}

// 区間ごとに見せる秒数を変える（大事な瞬間ほどゆっくり）。at(t)＝周回数＋周の中の位置（0〜1）、timeOf(u)＝周の中の位置 u の見せる時刻
export function timeWarp(bounds: readonly number[], showSec: readonly number[]): { cycle: number; at: (t: number) => number; timeOf: (u: number) => number } {
  const N = 2000, cum = new Float64Array(N + 1), last = showSec.length - 1, sig = (x: number): number => 1 / (1 + Math.exp(-x / 0.006));
  for (let k = 0; k < N; k++) {
    const u = (k + 0.5) / N;
    let dens = 0;
    for (let i = 0; i <= last; i++) dens += (showSec[i] / (bounds[i + 1] - bounds[i])) * (sig(u - (i ? bounds[i] : -1)) - sig(u - (i === last ? 2 : bounds[i + 1])));
    cum[k + 1] = cum[k] + dens / N;
  }
  const cycle = cum[N];
  return {
    cycle,
    at: (t) => {
      const n = Math.floor(t / cycle), r = t - n * cycle;
      let lo = 0, hi = N;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= r) lo = m; else hi = m; }
      return n + (lo + (r - cum[lo]) / (cum[hi] - cum[lo] || 1)) / N;
    },
    timeOf: (u) => cum[Math.round(clamp(u, 0, 1) * N)],
  };
}
// 周の中の位置 u がどの区間にあるか
export const stepOf = (bounds: readonly number[], u: number): number => Math.max(0, bounds.findIndex((b, i) => u >= b && u < bounds[i + 1]));

// 動かない部分を画面外のキャンバスに描いておき、毎コマはそれを貼るだけにする（色が変わったら描き直す）
export function cachedLayer(w: number, h: number, draw: (g: CanvasRenderingContext2D, p: Palette) => void): (g: CanvasRenderingContext2D, p: Palette) => void {
  const dpr = Math.min(2, devicePixelRatio || 1), c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr));
  const cg = c.getContext("2d")!;
  let key = "";
  return (g, p) => {
    const k = Object.values(p).join();
    if (k !== key) { key = k; cg.setTransform(dpr, 0, 0, dpr, 0, 0); cg.clearRect(0, 0, w, h); draw(cg, p); }
    g.drawImage(c, 0, 0, w, h);
  };
}

// 暗い計器の画面（心電図モニターと同じ見た目。ライト／ダークどちらでも暗いまま）
export const PANEL = { bg: "#0b1322", line: "rgba(255,255,255,0.08)", green: "#3ef08f", amber: "#ffcf5a", ink: "#cfe9dc", grid: "62,240,143" };
export function drawPanel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  roundRect(g, x, y, w, h, 12); g.fillStyle = PANEL.bg; g.fill(); g.strokeStyle = PANEL.line; g.lineWidth = 1; g.stroke();
}
