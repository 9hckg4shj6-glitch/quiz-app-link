// スタート画面のモデル「好中球の血管外遊出」：上が血管の中、下が組織。赤血球は中心ほど速く流れ（層流）、
// 好中球は血管の壁をセレクチンでゆるく捕まりながら転がる（ローリング）→ 内皮に出たケモカインで活性化した
// インテグリン（LFA-1）が ICAM-1 に強く結合して止まり、平たく広がる（接着）→ 内皮細胞のすき間をくびれながら
// すり抜け、組織の細菌の方へ這っていく（遊出）。約13秒で1周。動きを減らす設定では、すき間をくぐる途中の1枚を描く。
import { bump, clamp, font, glow, ramp, rgba, smooth, type Palette, type StartModel } from "./common";

const LOOP = 13;
const ROLL_END = 5.5, ARREST_END = 7, CROSS_END = 10.5, OUT_END = 12.4;
const STILL_AT = 8.6;
const STEPS = ["ローリング", "接着", "遊出"];

interface Rbc { lane: number; x0: number; r: number; tilt: number }

// 好中球の輪郭：ゆらぐ膜に、lead の向きへ張り出す仮足を足す
function cellOutline(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, t: number, lead: number, reach: number): void {
  g.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const k = 1 + 0.04 * Math.sin(3 * a + t * 2.2) + 0.03 * Math.sin(5 * a - t * 2.9) + reach * Math.max(0, Math.cos(a - lead)) ** 3;
    if (i) g.lineTo(x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k); else g.moveTo(x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k);
  }
  g.closePath();
}

// 分葉核（3葉）。spin で回す（転がっている間）
function nucleus(g: CanvasRenderingContext2D, lobes: [number, number][], r: number, p: Palette): void {
  g.strokeStyle = rgba(p.brand2, 0.5); g.lineWidth = 2;
  g.beginPath(); lobes.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
  g.fillStyle = rgba(p.brand2, 0.5);
  for (const [x, y] of lobes) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
}

function lobesAt(x: number, y: number, R: number, spin: number): [number, number][] {
  return ([[-0.34, 0.06], [0, -0.1], [0.34, 0.06]] as const).map(([u, v]): [number, number] =>
    [x + (u * Math.cos(spin) - v * Math.sin(spin)) * R, y + (u * Math.sin(spin) + v * Math.cos(spin)) * R]);
}

export const extravasation: StartModel = {
  id: "extravasation",
  label: "血管外遊出",
  note: "いま動いているのは<b>好中球の血管外遊出</b>。血管の壁をセレクチンでゆるく捕まりながら転がり（ローリング）、ケモカインで活性化したインテグリン（LFA-1）がICAM-1に強く結合して止まり、内皮細胞のすき間をすり抜けて組織へ出ます。",
  create(w, h, still) {
    const top = h * 0.05, wall = h * 0.56, th = h * 0.07, floor = wall + th + 3;
    const R = h * 0.085, jx = w * 0.6, cellLen = clamp(w * 0.2, 60, 110);
    const xStart = -R * 1.5, xStop = jx - R * 0.5;
    const bx = w * 0.86, by = floor + (h - floor) * 0.5;
    const lumenMid = (top + wall) / 2, lumenHalf = (wall - top) / 2, vmax = w * 0.42;
    const rbcs: Rbc[] = Array.from({ length: Math.round(w / 22) }, () => ({
      lane: top + 8 + Math.random() * (wall - top - 18), x0: Math.random() * (w + 40), r: 6 + Math.random() * 2.5, tilt: Math.random() * Math.PI,
    }));
    const t0 = still ? STILL_AT : 0;

    return (g, time, _dt, p) => {
      const t = time + t0, tt = t % LOOP;
      // 血管の中（向かいの壁と血漿）と、流れる赤血球。壁に近いほど遅い
      g.fillStyle = rgba(p.bad, 0.04); g.fillRect(0, top, w, wall - top);
      g.strokeStyle = rgba(p.brand2, 0.25); g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, top); g.lineTo(w, top); g.stroke();
      for (const c of rbcs) {
        const v = vmax * (1 - ((c.lane - lumenMid) / lumenHalf) ** 2) + 6;
        const x = ((c.x0 + v * t) % (w + 40)) - 20;
        g.save(); g.translate(x, c.lane); g.rotate(c.tilt + t * 0.4); g.scale(1, 0.62);
        g.fillStyle = rgba(p.bad, 0.2); g.beginPath(); g.arc(0, 0, c.r, 0, Math.PI * 2); g.fill();
        g.strokeStyle = rgba(p.bad, 0.3); g.lineWidth = c.r * 0.42; g.beginPath(); g.arc(0, 0, c.r * 0.74, 0, Math.PI * 2); g.stroke();
        g.restore();
      }
      // 組織：コラーゲン線維と、その奥の細菌（好中球はここへ向かう）
      g.strokeStyle = rgba(p.muted, 0.14); g.lineWidth = 1;
      for (const [i, k] of [0.3, 0.62, 0.9].entries()) {
        g.beginPath();
        for (let x = 0; x <= w; x += 6) { const y = floor + (h - floor) * k + Math.sin(x * 0.045 + i * 2) * 3; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
        g.stroke();
      }
      glow(g, bx, by, R * 2.2, p.good, 0.14);
      g.fillStyle = p.good;
      for (const [dx, dy, a] of [[-8, -4, 0.4], [6, 3, -0.3], [-2, 8, 1.2]]) {
        g.save(); g.translate(bx + dx, by + dy); g.rotate(a + Math.sin(t * 1.3 + dx) * 0.15);
        g.beginPath(); g.ellipse(0, 0, 6, 2.8, 0, 0, Math.PI * 2); g.fill(); g.restore();
      }
      // 内皮細胞：すき間 jx は、くぐる間だけ広がる。基底膜も同じところが開く
      const open = 1.5 + R * 0.32 * (ramp(tt, ARREST_END - 0.4, ARREST_END + 0.6) - ramp(tt, CROSS_END - 0.4, CROSS_END + 0.4));
      for (let j = jx - Math.ceil(jx / cellLen + 1) * cellLen; j < w; j += cellLen) {
        const a = j + (Math.abs(j - jx) < 1 ? open : 1.5), b = j + cellLen - (Math.abs(j + cellLen - jx) < 1 ? open : 1.5);
        g.fillStyle = rgba(p.brand2, 0.12); g.fillRect(a, wall, b - a, th);
        g.strokeStyle = rgba(p.brand2, 0.35); g.lineWidth = 1; g.strokeRect(a, wall, b - a, th);
        g.fillStyle = rgba(p.brand2, 0.28); g.beginPath(); g.ellipse((a + b) / 2, wall + th / 2, (b - a) * 0.22, th * 0.3, 0, 0, Math.PI * 2); g.fill();
      }
      g.strokeStyle = rgba(p.brand2, 0.3); g.lineWidth = 1.2; g.beginPath();
      g.moveTo(0, floor - 1.5); g.lineTo(jx - open, floor - 1.5); g.moveTo(jx + open, floor - 1.5); g.lineTo(w, floor - 1.5); g.stroke();
      // ケモカイン：止まる少し前に内皮の表面に現れる
      const chemokine = ramp(tt, 3.2, 5) * (1 - ramp(tt, CROSS_END, CROSS_END + 1));
      if (chemokine > 0) {
        g.fillStyle = rgba(p.good, 0.85 * chemokine);
        for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(jx + (i - 5) * R * 0.35, wall - 1.6, 1.6, 0, Math.PI * 2); g.fill(); }
      }

      const fade = 1 - ramp(tt, OUT_END - 0.7, OUT_END);
      let tagX = 0, tagY = 0, tag = "";
      g.save(); g.globalAlpha = fade;
      if (tt < ARREST_END) {
        // ローリング→接着：転がりながら遅くなり、止まるとすき間の上まで這って平たく広がる
        const u = Math.min(1, tt / ROLL_END), spread = smooth(ramp(tt, ROLL_END, ARREST_END));
        const x = spread > 0 ? xStop + (jx - xStop) * spread : xStart + (xStop - xStart) * u * (1.6 - 0.6 * u);
        const rx = R * (1 + 0.22 * spread), ry = R * (0.96 - 0.16 * spread), y = wall - ry;
        const spin = (Math.min(x, xStop) - xStart) / R;
        const tether = 1 - ramp(tt, ROLL_END - 0.3, ROLL_END + 0.5);
        if (tether > 0) {
          // セレクチンの結合：前で結び、後ろでほどけるのをちらつきで見せる
          g.strokeStyle = rgba(p.brand2, 0.75 * tether); g.fillStyle = rgba(p.brand2, 0.75 * tether); g.lineWidth = 1.2;
          [-0.55, -0.2, 0.2, 0.55].forEach((off, i) => {
            if (Math.sin(t * 5 + i * 1.7) < -0.3) return;
            const a = Math.PI / 2 + off, sx = x + Math.cos(a) * rx, sy = y + Math.sin(a) * ry, ax = x + Math.cos(a) * rx * 1.35;
            g.beginPath(); g.moveTo(sx, sy); g.lineTo(ax, wall); g.stroke();
            g.beginPath(); g.arc(ax, wall - 0.5, 1.4, 0, Math.PI * 2); g.fill();
          });
        }
        cellOutline(g, x, y, rx, ry, t, 0, 0);
        g.fillStyle = rgba(p.brand, 0.2); g.fill(); g.strokeStyle = rgba(p.brand, 0.65); g.lineWidth = 1.5; g.stroke();
        nucleus(g, lobesAt(x, y, R, spread > 0 ? (xStop - xStart) / R : spin), R * 0.2, p);
        const bond = ramp(tt, ROLL_END, ROLL_END + 0.5);
        if (bond > 0) { g.fillStyle = rgba(p.warn, bond); for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(x + (i - 2) * rx * 0.32, wall - 1, 1.8, 0, Math.PI * 2); g.fill(); } }
        [tagX, tagY, tag] = [x, y - ry - 10, spread > 0 ? "インテグリン（LFA-1）× ICAM-1" : "セレクチンでゆるく結合"];
      } else if (tt < CROSS_END) {
        // 遊出：上の部分が縮み、下の部分がふくらむ。間はすき間の幅にくびれる
        const q = smooth(ramp(tt, ARREST_END, CROSS_END)), up = Math.sqrt(1 - q), down = Math.sqrt(q);
        const rxU = R * 1.22 * up, ryU = R * 0.8 * up, yU = wall - ryU, rL = R * 0.95 * down, yL = floor + rL;
        const neck = Math.max(2, open * 1.6);
        const shape = new Path2D();
        if (rxU > 0.5) shape.ellipse(jx, yU, rxU, ryU, 0, 0, Math.PI * 2);
        shape.rect(jx - neck / 2, Math.min(yU, wall - 2), neck, Math.max(yL, floor + 2) - Math.min(yU, wall - 2));
        if (rL > 0.5) { shape.moveTo(jx + rL * 1.05, yL); shape.ellipse(jx, yL, rL * 1.05, rL, 0, 0, Math.PI * 2); }
        g.fillStyle = rgba(p.brand, 0.24); g.fill(shape);
        // 輪郭はくびれの部分を切り抜いて描く
        g.save();
        const outside = new Path2D(); outside.rect(0, 0, w, h); outside.rect(jx - neck / 2, 0, neck, h);
        g.clip(outside, "evenodd");
        g.strokeStyle = rgba(p.brand, 0.65); g.lineWidth = 1.5; g.beginPath();
        if (rxU > 0.5) g.ellipse(jx, yU, rxU, ryU, 0, 0, Math.PI * 2);
        if (rL > 0.5) { g.moveTo(jx + rL * 1.05, yL); g.ellipse(jx, yL, rL * 1.05, rL, 0, 0, Math.PI * 2); }
        g.stroke(); g.restore();
        // 核は1葉ずつ、すき間で細くなりながら下へ移る
        const lobes = [0, 1, 2].map((i): [number, number] => {
          const k = smooth(clamp((q - 0.12 * i) / 0.64, 0, 1));
          return [jx + (i - 1) * R * 0.3 * (1 - bump(k, 0, 1)), yU + (yL - yU) * k];
        });
        nucleus(g, lobes, R * 0.17, p);
        const bond = 1 - ramp(tt, CROSS_END - 1.2, CROSS_END);
        if (bond > 0 && rxU > 2) { g.fillStyle = rgba(p.warn, bond); for (const s of [-2, -1, 1, 2]) { g.beginPath(); g.arc(jx + s * rxU * 0.32, wall - 1, 1.8, 0, Math.PI * 2); g.fill(); } }
        [tagX, tagY, tag] = [jx, Math.min(yU - ryU, wall - R) - 10, "内皮細胞のすき間をすり抜ける"];
      } else {
        // 組織の中を、細菌の出す物質の濃い方へ這う
        const u = smooth(ramp(tt, CROSS_END, OUT_END)), sx = jx, sy = floor + R * 0.95;
        const x = sx + (bx - sx) * 0.5 * u, y = sy + (by - sy) * 0.5 * u, lead = Math.atan2(by - y, bx - x);
        cellOutline(g, x, y, R * 0.95, R * 0.95, t, lead, 0.3);
        g.fillStyle = rgba(p.brand, 0.2); g.fill(); g.strokeStyle = rgba(p.brand, 0.65); g.lineWidth = 1.5; g.stroke();
        nucleus(g, lobesAt(x, y, R, lead + Math.PI / 2), R * 0.2, p);
      }
      if (tag) {
        g.font = font(10); g.textAlign = "center"; g.fillStyle = rgba(p.text, 0.75);
        g.fillText(tag, clamp(tagX, 90, w - 90), Math.max(12, tagY));
      }
      g.restore();
      // いまの段階：ローリング → 接着 → 遊出
      const now = tt < ROLL_END ? 0 : tt < ARREST_END ? 1 : 2;
      g.font = font(11, 700); g.textAlign = "left";
      let x = 12;
      STEPS.forEach((s, i) => {
        g.fillStyle = i === now ? p.brand : rgba(p.muted, 0.7); g.fillText(s, x, h - 9); x += g.measureText(s).width;
        if (i < STEPS.length - 1) { g.fillStyle = rgba(p.muted, 0.6); g.fillText(" → ", x, h - 9); x += g.measureText(" → ").width; }
      });
    };
  },
};
