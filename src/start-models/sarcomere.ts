// スタート画面のモデル「サルコメアの収縮（滑り説）」：Z線から伸びる細いフィラメント（アクチン）が、
// ミオシン頭部に引かれて太いフィラメント（ミオシン）の間へ滑り込み、Z線どうしが近づく。フィラメント自体の長さは変わらない。
// 上の目盛りで、縮むと I帯 と H帯 は短くなり、A帯（ミオシンの長さ）は変わらないことを見せる。約6秒で1周。
// 動きを減らす設定では、縮んでいく途中の1枚を描く。
import { font, ramp, rgba, smooth, type Palette, type StartModel } from "./common";

const LOOP = 6;
const STILL_AT = 2.3;
const SHORTEN = 0.28;   // 縮みきったときに、休んでいるときの長さから何割短くなるか

// 収縮の度合い 0（休み）〜1（縮みきり）と、ミオシン頭部が首を振っているか
function contraction(tt: number): { c: number; cycling: number; state: string } {
  if (tt < 1.2) return { c: 0, cycling: 0, state: "弛緩" };
  if (tt < 2.8) return { c: smooth(ramp(tt, 1.2, 2.8)), cycling: 1, state: "Ca²⁺ が出る → 収縮" };
  if (tt < 4) return { c: 1, cycling: 0.4, state: "収縮" };
  if (tt < 5.4) return { c: 1 - smooth(ramp(tt, 4, 5.4)), cycling: 0, state: "Ca²⁺ が戻る → 弛緩" };
  return { c: 0, cycling: 0, state: "弛緩" };
}

function bracket(g: CanvasRenderingContext2D, a: number, b: number, y: number, label: string, color: string, below: boolean): void {
  const tick = below ? -4 : 4;
  g.strokeStyle = color; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(a, y + tick); g.lineTo(a, y); g.lineTo(b, y); g.lineTo(b, y + tick); g.stroke();
  g.fillStyle = color; g.fillText(label, (a + b) / 2, below ? y + 14 : y - 5);
}

export const sarcomere: StartModel = {
  id: "sarcomere",
  label: "筋の収縮",
  note: "いま動いているのは<b>サルコメア</b>。ミオシン頭部がアクチンをたぐり寄せ、細いフィラメントが太いフィラメントの間へ滑り込みます。縮むとI帯とH帯は短くなり、A帯（ミオシンの長さ）は変わりません。",
  create(w, h, still) {
    const cx = w / 2, cy = h * 0.55, L0 = Math.min(w * 0.8, h * 2.4);
    const actin = 0.3 * L0, myosin = 0.23 * L0, bare = 0.035 * L0, gap = h * 0.065;
    const thinRows = [-3, -1, 1, 3].map((k) => cy + k * gap), thickRows = [-2, 0, 2].map((k) => cy + k * gap);
    const headLen = gap * 0.85, headStep = Math.max(6, L0 * 0.022);
    const t0 = still ? STILL_AT : 0;

    const drawThin = (g: CanvasRenderingContext2D, from: number, to: number, p: Palette): void => {
      for (const y of thinRows) {
        g.strokeStyle = rgba(p.brand, 0.55); g.lineWidth = 1.2; g.beginPath(); g.moveTo(from, y); g.lineTo(to, y); g.stroke();
        // 2本のらせんに見えるよう、上下に少しずらした玉を並べる
        g.fillStyle = rgba(p.brand, 0.75);
        const dir = Math.sign(to - from), n = Math.floor(Math.abs(to - from) / 4);
        for (let i = 0; i <= n; i++) { g.beginPath(); g.arc(from + dir * i * 4, y + (i % 2 ? 1.2 : -1.2), 1.7, 0, Math.PI * 2); g.fill(); }
      }
    };

    return (g, time, _dt, p) => {
      const t = time + t0, tt = t % LOOP, { c, cycling, state } = contraction(tt);
      const L = L0 * (1 - SHORTEN * c);
      // 3つ並んだサルコメアのうち真ん中を主役にする。Z線は境目、M線は真ん中
      for (let k = -2; k <= 1; k++) {
        const z = cx + (k + 0.5) * L;
        drawThin(g, z, z - actin, p); drawThin(g, z, z + actin, p);
      }
      for (let k = -1; k <= 1; k++) {
        const m = cx + k * L;
        for (const y of thickRows) {
          // ミオシン頭部：M線から外向き（Z線の方）に傾き、首振り（パワーストローク）でアクチンを中央へたぐる
          g.strokeStyle = rgba(p.brand2, 0.7); g.lineWidth = 1.3; g.fillStyle = rgba(p.brand2, 0.85);
          let i = 0;
          for (let s = bare; s <= myosin; s += headStep, i++) {
            for (const side of [-1, 1]) {
              const up = (i + (side > 0 ? 1 : 0)) % 2 ? -1 : 1;
              // 首振りはゆっくり中央へ倒し（パワーストローク）、すばやく戻す。頭ごとに少しずつずらす
              const phase = (((t * 1.6 + i * 0.37 + side * 0.2) % 1) + 1) % 1;
              const swing = phase < 0.7 ? phase / 0.7 : 1 - (phase - 0.7) / 0.3;
              const angle = (50 + cycling * (swing * 50 - 10)) * (Math.PI / 180);
              const bx = m + side * s, by = y + up * 2.2;
              const tx = bx + side * Math.cos(angle) * headLen * 0.75, ty = by + up * Math.sin(angle) * headLen;
              g.beginPath(); g.moveTo(bx, by); g.lineTo(tx, ty); g.stroke();
              g.beginPath(); g.arc(tx, ty, 1.7, 0, Math.PI * 2); g.fill();
            }
          }
          g.strokeStyle = rgba(p.brand2, 0.8); g.lineWidth = 4; g.lineCap = "round";
          g.beginPath(); g.moveTo(m - myosin, y); g.lineTo(m + myosin, y); g.stroke(); g.lineCap = "butt";
        }
        g.strokeStyle = rgba(p.muted, 0.45); g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(m, cy - 2.6 * gap); g.lineTo(m, cy + 2.6 * gap); g.stroke();
      }
      // Z線（ジグザグ）
      g.strokeStyle = rgba(p.text, 0.6); g.lineWidth = 2;
      for (let k = -2; k <= 1; k++) {
        const z = cx + (k + 0.5) * L;
        g.beginPath();
        for (let j = 0; j <= 14; j++) { const y = cy - 3.6 * gap + (j * 7.2 * gap) / 14, x = z + (j % 2 ? 2.5 : -2.5); if (j) g.lineTo(x, y); else g.moveTo(x, y); }
        g.stroke();
      }
      // 目盛り：上に I帯・A帯・I帯、下に H帯。短くなる帯は縮んでいる間だけ黄色くする
      const zl = cx - L / 2, zr = cx + L / 2, shrinking = c > 0.02 ? p.warn : rgba(p.muted, 0.9);
      g.font = font(11, 700); g.textAlign = "center";
      const yTop = cy - 4.4 * gap, yBottom = cy + 4.4 * gap;
      bracket(g, cx - myosin, cx + myosin, yTop, "A帯（長さは一定）", p.brand2, false);
      bracket(g, zl + 2, cx - myosin - 2, yTop, "I帯", shrinking, false);
      bracket(g, cx + myosin + 2, zr - 2, yTop, "I帯", shrinking, false);
      const hz = L / 2 - actin;
      if (hz > 4) bracket(g, cx - hz, cx + hz, yBottom, "H帯", shrinking, true);
      g.textAlign = "left"; g.font = font(11, 700); g.fillStyle = c > 0.02 ? p.warn : rgba(p.muted, 0.9);
      g.fillText(state, 12, 18);
    };
  },
};
