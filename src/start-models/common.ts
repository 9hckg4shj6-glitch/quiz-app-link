// スタート画面の動くモデルで共通に使う型と小さな関数。
// 色は CSS 変数から読むので、ライト／ダークの切り替えに追従する。

export interface Palette { brand: string; brand2: string; good: string; bad: string; warn: string; text: string; muted: string }

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
    warn: v("--warn", "#c98a00"), text: v("--text", "#141931"), muted: v("--muted", "#5b6488"),
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
