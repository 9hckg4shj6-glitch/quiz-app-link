// スタート画面のモデル「好中球の血管外遊出（接着カスケード）」：上が細静脈の中、下が組織。
// 血液は中心ほど速く流れ（層流）、赤血球は転がるように流れる。好中球は
// ① 微絨毛の先の PSGL-1 が内皮のセレクチンに結合しては切れ、転がる（ローリング：結合は前で生まれ、後ろで伸びて切れる）
// ② 内皮に出たケモカイン（IL-8）でインテグリンが活性化 ③ LFA-1 が ICAM-1 に強く結合して止まり、平たく広がる
// ④ 内皮の上を細胞のすき間まで這う ⑤ すき間（PECAM-1）をくびれながらすり抜ける（核は1葉ずつ） ⑥ 組織の細菌の方へ向かう。
// 大事な瞬間ほどゆっくり見せる。動きを減らす設定では、すき間をくぐる途中の1枚を描く。
import { cachedLayer, clamp, drawSteps, drawTag, glow, ramp, rgba, roundRect, smooth, stepOf, timeWarp, type Palette, type Pt, type StartModel } from "./common";
import { cellPath, drawBacterium, drawGranules, drawNucleus, drawRbc, lobesAt, paintCell, type CellPose } from "./neutrophil";

const BOUNDS = [0, 0.3, 0.42, 0.54, 0.66, 0.86, 1];
const SHOW_SEC = [3.4, 1.7, 1.5, 1.7, 2.8, 2.0];
const STILL_U = 0.75;
const STEPS = [
  "ローリング：セレクチンに\nゆるく捕まって転がる",
  "活性化：ケモカイン（IL-8）で\nインテグリンが活性化",
  "接着：LFA-1がICAM-1に\n強く結合して止まる",
  "這う：内皮の上を\nすき間まで這う",
  "遊出：内皮細胞のすき間を\nすり抜ける（PECAM-1）",
  "組織へ：細菌が出す物質の\n濃い方へ向かう",
];
const MICROVILLI = 16;

interface Rbc { lane: number; x0: number; phase: number; spin: number }

// 内皮細胞：平たい細胞と、ふくらんだ核。内腔側（上）には糖衣（細い毛）
function drawEndo(g: CanvasRenderingContext2D, a: number, b: number, top: number, th: number, p: Palette, flip = false): void {
  if (b - a < 4) return;
  const grad = g.createLinearGradient(0, top, 0, top + th);
  grad.addColorStop(0, rgba(p.brand2, flip ? 0.24 : 0.14)); grad.addColorStop(1, rgba(p.brand2, flip ? 0.14 : 0.24));
  roundRect(g, a, top, b - a, th, Math.min(th * 0.45, 6));
  g.fillStyle = p.card; g.fill(); g.fillStyle = grad; g.fill();
  g.strokeStyle = rgba(p.brand2, 0.45); g.lineWidth = 1; g.stroke();
  const nx = (a + b) / 2, ny = top + th * 0.52, nr = Math.min((b - a) * 0.2, th * 1.1);
  const ng = g.createRadialGradient(nx - nr * 0.3, ny - th * 0.15, 1, nx, ny, nr);
  ng.addColorStop(0, rgba(p.brand2, 0.25)); ng.addColorStop(1, rgba(p.brand2, 0.55));
  g.fillStyle = ng; g.beginPath(); g.ellipse(nx, ny, nr, th * 0.3, 0, 0, Math.PI * 2); g.fill();
  const surf = flip ? top + th : top, dir = flip ? 1 : -1;
  g.strokeStyle = rgba(p.brand2, 0.28); g.lineWidth = 0.7;
  g.beginPath();
  for (let x = a + 2; x < b - 2; x += 2.6) { g.moveTo(x, surf); g.lineTo(x + Math.sin(x) * 0.8, surf + dir * (1.6 + (Math.sin(x * 3.7) + 1) * 0.7)); }
  g.stroke();
}

export const extravasation: StartModel = {
  id: "extravasation",
  label: "血管外遊出",
  note: "いま動いているのは<b>好中球の血管外遊出</b>。セレクチンでゆるく捕まって転がり（ローリング）、ケモカインで活性化したインテグリン（LFA-1）がICAM-1に強く結合して止まり、内皮細胞のすき間をすり抜けて組織へ出ます。",
  create(w, h, still) {
    const fs = clamp(h * 0.035, 11, 13), R = h * 0.075, mv = R * 0.15;
    const roof = h * 0.07, wall = h * 0.55, th = h * 0.06, bm = wall + th + 2.5;
    const jx = w * 0.6, cellLen = clamp(w * 0.19, 60, 110);
    const xStart = -R * 1.8, xArrest = jx - R * 2.2;
    const bug: Pt = [w * 0.87, bm + (h - bm) * 0.42];
    const lumenMid = (roof + wall) / 2, lumenHalf = (wall - roof) / 2, vmax = w * 0.45;
    const flowAt = (y: number): number => vmax * (1 - ((y - lumenMid) / lumenHalf) ** 2) + 8;
    const rbcs: Rbc[] = Array.from({ length: Math.round(w / 20) }, () => ({
      lane: roof + R * 0.6 + Math.random() * (wall - roof - R * 1.4), x0: Math.random() * (w + 60), phase: Math.random() * 6, spin: 0.6 + Math.random() * 1.2,
    }));
    const junctions = Array.from({ length: Math.ceil(w / cellLen) + 3 }, (_, i) => jx + (i - Math.ceil(jx / cellLen) - 1) * cellLen);
    const warp = timeWarp(BOUNDS, SHOW_SEC), t0 = still ? warp.timeOf(STILL_U) : 0;

    // 動かない部分：血漿の色・向かいの壁・すき間の両隣以外の内皮・組織の線維と線維芽細胞
    const base = cachedLayer(w, h, (g, p) => {
      const plasma = g.createLinearGradient(0, roof, 0, wall);
      plasma.addColorStop(0, rgba(p.bad, 0.1)); plasma.addColorStop(0.5, rgba(p.bad, 0.04)); plasma.addColorStop(1, rgba(p.bad, 0.1));
      g.fillStyle = plasma; g.fillRect(0, roof, w, wall - roof);
      for (let x = -cellLen * 0.4; x < w; x += cellLen) drawEndo(g, x + 1.5, x + cellLen - 1.5, roof - th, th, p, true);
      for (let i = 0; i < junctions.length - 1; i++) {
        if (Math.abs(junctions[i] - jx) < 1 || Math.abs(junctions[i + 1] - jx) < 1) continue;
        drawEndo(g, junctions[i] + 1.5, junctions[i + 1] - 1.5, wall, th, p);
      }
      const ecm = g.createLinearGradient(0, bm, 0, h);
      ecm.addColorStop(0, rgba(p.warn, 0.05)); ecm.addColorStop(1, rgba(p.warn, 0.02));
      g.fillStyle = ecm; g.fillRect(0, bm, w, h - bm);
      g.lineCap = "round";
      [0.22, 0.5, 0.78].forEach((k, i) => {
        for (let s = 0; s < 3; s++) {
          g.strokeStyle = rgba(p.warn, 0.16 + s * 0.04); g.lineWidth = 1.1; g.beginPath();
          for (let x = -10; x <= w + 10; x += 5) { const y = bm + (h - bm) * k + Math.sin(x * 0.04 + i * 2) * 4 + s * 2.2 + Math.sin(x * 0.11 + s) * 0.8; if (x > -10) g.lineTo(x, y); else g.moveTo(x, y); }
          g.stroke();
        }
      });
      // 線維芽細胞（紡錘形）
      const fx = w * 0.36, fy = bm + (h - bm) * 0.24;
      g.fillStyle = rgba(p.muted, 0.16); g.strokeStyle = rgba(p.muted, 0.4); g.lineWidth = 1;
      g.beginPath(); g.moveTo(fx - R * 2.2, fy + 2); g.quadraticCurveTo(fx, fy - R * 0.55, fx + R * 2.2, fy - 2); g.quadraticCurveTo(fx, fy + R * 0.55, fx - R * 2.2, fy + 2); g.fill(); g.stroke();
      g.fillStyle = rgba(p.muted, 0.35); g.beginPath(); g.ellipse(fx, fy, R * 0.5, R * 0.22, -0.05, 0, Math.PI * 2); g.fill();
    });

    return (g, time, _dt, p) => {
      const t = time + t0, cyc = warp.at(t), u = cyc - Math.floor(cyc), now = stepOf(BOUNDS, u);
      base(g, p);
      // 層流：中心ほど速い筋と、転がるように流れる赤血球
      g.setLineDash([10, 16]); g.lineWidth = 1;
      for (let i = 1; i <= 5; i++) {
        const y = roof + ((wall - roof) * i) / 6;
        g.strokeStyle = rgba(p.bad, 0.12); g.lineDashOffset = -t * flowAt(y); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      }
      g.setLineDash([]);
      for (const c of rbcs) {
        const x = ((c.x0 + flowAt(c.lane) * t) % (w + 60)) - 30;
        drawRbc(g, x, c.lane, R * 0.5, c.phase + t * c.spin * 0.6, 0.3 + 0.7 * Math.abs(Math.cos(c.phase + t * c.spin)), p, 0.9);
      }
      // すき間：くぐる間だけ広がる。両隣の内皮細胞と基底膜も同じだけ開く
      const open = 1.5 + R * 0.34 * (ramp(u, 0.64, 0.7) - ramp(u, 0.84, 0.9));
      drawEndo(g, jx - cellLen + 1.5, jx - open, wall, th, p); drawEndo(g, jx + open, jx + cellLen - 1.5, wall, th, p);
      g.strokeStyle = rgba(p.brand2, 0.35); g.lineWidth = 1.6; g.setLineDash([5, 2]);
      g.beginPath(); g.moveTo(0, bm - 1); g.lineTo(jx - open, bm - 1); g.moveTo(jx + open, bm - 1); g.lineTo(w, bm - 1); g.stroke(); g.setLineDash([]);
      // 接着分子：ICAM-1（内皮の表面）・PECAM-1（すき間の両側）
      const icam = 0.35 + 0.65 * ramp(u, 0.4, 0.46) * (1 - ramp(u, 0.86, 0.9));
      g.fillStyle = rgba(p.brand2, 0.7 * icam);
      for (let x = jx - R * 3.6; x < jx + R * 1.2; x += R * 0.32) { if (Math.abs(x - jx) > open + 2) { g.beginPath(); g.arc(x, wall - 1.2, 1.3, 0, Math.PI * 2); g.fill(); } }
      const pecam = 0.4 + 0.6 * ramp(u, 0.64, 0.68) * (1 - ramp(u, 0.86, 0.9));
      g.fillStyle = rgba(p.warn, 0.8 * pecam);
      for (let y = wall + 3; y < wall + th - 1; y += 3.5) for (const side of [-1, 1]) { g.beginPath(); g.arc(jx + side * (open + 0.5), y, 1.1, 0, Math.PI * 2); g.fill(); }
      // ケモカイン：内皮の糖衣の上に現れる
      const chemo = ramp(u, 0.18, 0.3) * (1 - ramp(u, 0.86, 0.92));
      if (chemo > 0) {
        g.fillStyle = rgba(p.good, 0.9 * chemo);
        for (let x = xArrest - R * 1.4; x < jx + R; x += R * 0.36) { g.beginPath(); g.arc(x, wall - 3.4, 1.5, 0, Math.PI * 2); g.fill(); }
      }
      // 組織の細菌と、そこから広がる物質の輪
      glow(g, bug[0], bug[1], R * 2.6, p.good, 0.14);
      for (let i = 0; i < 3; i++) { const q = (t * 0.3 + i / 3) % 1; g.strokeStyle = rgba(p.good, 0.3 * (1 - q)); g.lineWidth = 1.1; g.beginPath(); g.arc(bug[0], bug[1], R * (0.5 + 2.4 * q), 0, Math.PI * 2); g.stroke(); }
      ([[-9, -5, 0.4], [7, 3, -0.3], [-2, 9, 1.2]] as const).forEach(([dx, dy, a]) => drawBacterium(g, bug[0] + dx * R / 17, bug[1] + dy * R / 17, a + Math.sin(t * 1.3 + dx) * 0.15, R / 30, t, p));

      // ---- 好中球 ----
      const fade = 1 - ramp(u, 0.95, 1);
      g.save(); g.globalAlpha = fade;
      let tagAt: Pt = [jx, wall], cellTop = wall - R * 2;
      if (u < 0.66) {
        // ローリング→（止まって平たくなる）→這う
        const roll = Math.min(1, u / 0.42), spread = smooth(ramp(u, 0.42, 0.54)), crawl = smooth(ramp(u, 0.54, 0.66));
        const x = u < 0.42 ? xStart + (xArrest - xStart) * (1 - (1 - roll) ** 2.2) : xArrest + (jx - xArrest) * crawl;
        const sx = 1 + 0.28 * spread, sy = 1 - 0.28 * spread, lift = mv * (1 - spread), y = wall - R * sy - lift;
        const spin = (Math.min(x, xArrest) - xStart) / R;
        const pose: CellPose = { x, y, r: R, heading: 0, reach: 0.22 * crawl, tail: 0.18 * crawl, sx, sy, ruffle: crawl };
        cellTop = y - R * sy;
        // 微絨毛と、その先の PSGL-1 がセレクチンにつくる結合
        if (lift > 0.3) {
          g.lineCap = "round";
          let shown = false;
          for (let k = 0; k < MICROVILLI; k++) {
            const a = spin + (k * Math.PI * 2) / MICROVILLI, bx = x + Math.cos(a) * R * 0.98 * sx, by = y + Math.sin(a) * R * 0.98 * sy;
            const tx = x + Math.cos(a) * (R * sx + lift), ty = y + Math.sin(a) * (R * sy + lift);
            g.strokeStyle = rgba(p.brand, 0.7); g.lineWidth = 1.4; g.beginPath(); g.moveTo(bx, by); g.lineTo(tx, ty); g.stroke();
            g.fillStyle = rgba(p.brand2, 0.9); g.beginPath(); g.arc(tx, ty, 1.3, 0, Math.PI * 2); g.fill();
            const d = Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2));   // 真下を通り過ぎてからの角度
            if (d >= 0 && d < 0.95 && u < 0.46) {
              const ax = x - R * d, stretch = d / 0.95;
              g.strokeStyle = rgba(p.brand2, 0.85 * (1 - stretch * 0.5)); g.lineWidth = 1.2 - stretch * 0.5;
              g.beginPath(); g.moveTo(tx, ty); g.lineTo(ax, wall - 0.5); g.stroke();
              g.fillStyle = rgba(p.brand2, 0.9); g.beginPath(); g.arc(ax, wall - 0.5, 1.5, 0, Math.PI * 2); g.fill();
              if (!shown) { tagAt = [(tx + ax) / 2, (ty + wall) / 2]; shown = true; }
            }
          }
        }
        const path = cellPath(pose, t);
        paintCell(g, path, pose, p);
        drawGranules(g, path, pose, t, p);
        drawNucleus(g, lobesAt(pose, u < 0.42 ? spin : undefined), R * 0.2, p);
        // インテグリン：ケモカインの刺激で、細胞の下面が順に活性化（黄）する
        const act = ramp(u, 0.3, 0.4);
        if (act > 0) {
          glow(g, x, wall - 1, R * 1.2, p.good, 0.25 * act * (1 - ramp(u, 0.42, 0.5)));
          g.fillStyle = rgba(p.warn, act);
          for (let i = -3; i <= 3; i++) { g.beginPath(); g.arc(x + i * R * 0.3 * sx, wall - 1.5 - lift * 0.4, 1.7, 0, Math.PI * 2); g.fill(); }
        }
        if (u >= 0.3) tagAt = [x, wall - 2];
      } else if (u < 0.86) {
        // 遊出：上の部分が縮み、組織側の部分がふくらむ。間はすき間の幅にくびれる
        const q = smooth(ramp(u, 0.66, 0.86)), up = Math.sqrt(1 - q), down = Math.sqrt(q);
        const upper: CellPose = { x: jx, y: wall - R * 0.72 * up, r: R * Math.max(up, 0.05), heading: Math.PI / 2, reach: 0, tail: 0, sx: 1.28, sy: 0.72, ruffle: 0 };
        const lower: CellPose = { x: jx, y: bm + R * 0.95 * down, r: R * Math.max(down, 0.05), heading: Math.PI / 2, reach: 0.18, tail: 0, ruffle: 0.6 };
        const neck = Math.max(2, open * 1.7), shape = new Path2D();
        if (up > 0.08) shape.addPath(cellPath(upper, t));
        shape.rect(jx - neck / 2, wall - 2, neck, bm - wall + 4);
        if (down > 0.08) shape.addPath(cellPath(lower, t));
        const look: CellPose = { x: jx, y: (upper.y + lower.y) / 2, r: R, heading: Math.PI / 2, reach: 0, tail: 0 };
        g.fillStyle = p.card; g.fill(shape);
        const grad = g.createLinearGradient(0, upper.y - R, 0, lower.y + R);
        grad.addColorStop(0, rgba(p.brand, 0.3)); grad.addColorStop(0.5, rgba(p.brand, 0.14)); grad.addColorStop(1, rgba(p.brand, 0.3));
        g.fillStyle = grad; g.fill(shape);
        g.save();
        const outside = new Path2D(); outside.rect(0, 0, w, h); outside.rect(jx - neck / 2, wall - 3, neck, bm - wall + 6);
        g.clip(outside, "evenodd");
        g.strokeStyle = rgba(p.brand, 0.85); g.lineWidth = 1.3;
        if (up > 0.08) g.stroke(cellPath(upper, t));
        if (down > 0.08) g.stroke(cellPath(lower, t));
        g.restore();
        drawGranules(g, shape, look, t, p);
        // 核は1葉ずつ、すき間で細くなりながら下へ移る
        const lobes = [0, 1, 2].map((i): Pt => {
          const k = smooth(clamp((q - 0.14 * i) / 0.62, 0, 1)), squeeze = Math.sin(k * Math.PI);
          return [jx + (i - 1) * R * 0.3 * (1 - squeeze), upper.y + (lower.y - upper.y) * k];
        });
        drawNucleus(g, lobes, R * 0.18, p);
        tagAt = [jx + open + 1, wall + th / 2]; cellTop = upper.y - R * 0.72 * up;
      } else {
        // 組織の中を、細菌の方へ這う
        const k = smooth(ramp(u, 0.86, 1)), sx0 = jx, sy0 = bm + R * 0.95;
        const x = sx0 + (bug[0] - sx0) * 0.55 * k, y = sy0 + (bug[1] - sy0) * 0.55 * k, head = Math.atan2(bug[1] - y, bug[0] - x);
        const pose: CellPose = { x, y, r: R, heading: head, reach: 0.3, tail: 0.3 };
        const path = cellPath(pose, t);
        paintCell(g, path, pose, p); drawGranules(g, path, pose, t, p); drawNucleus(g, lobesAt(pose), R * 0.2, p);
      }
      g.restore();
      // 名札（細胞の上の血管の中に出す）
      const box: Pt = [clamp(tagAt[0], 80, w - 80), Math.max(16, Math.min(cellTop, wall - R * 1.6) - R * 0.9)];
      drawTag(g, "セレクチン ⇄ PSGL-1", box, [tagAt], ramp(u, 0.04, 0.07) * (1 - ramp(u, 0.26, 0.29)), fs, p);
      drawTag(g, "ケモカイン（IL-8）", box, [tagAt], ramp(u, 0.3, 0.32) * (1 - ramp(u, 0.4, 0.42)), fs, p);
      drawTag(g, "LFA-1 ⇄ ICAM-1", box, [tagAt], ramp(u, 0.43, 0.45) * (1 - ramp(u, 0.6, 0.63)), fs, p);
      drawTag(g, "PECAM-1（すき間）", [clamp(jx + R * 3.2, 80, w - 80), box[1]], [tagAt], ramp(u, 0.68, 0.7) * (1 - ramp(u, 0.83, 0.86)), fs, p);
      drawSteps(g, 14, h - fs * 4.1 - 4, Math.min(w * 0.5, 230), STEPS, now, still ? 1 : ramp(u, BOUNDS[now], BOUNDS[now] + 0.012), fs, p, true);
    };
  },
};
