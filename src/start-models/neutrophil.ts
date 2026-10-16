// スタート画面のモデル「好中球の走化性と貪食」：赤血球のあいだで、好中球が細菌を追って食べる（Rogers の有名な映像へのオマージュ）。
// ① 走化性：細菌が出す fMLP や補体 C5a の濃い方へ、前に葉状仮足・後ろに尾部（ウロポッド）をつくって這う（細菌は逃げるが、好中球の方が少し速い）
// ② 貪食：仮足を伸ばして包み込む ③ ファゴソームに閉じこめる ④ 顆粒が融合し、活性酸素と酵素で殺菌する → 次の細菌を追う
// 細胞・赤血球の描き方はここにまとめ、血管外遊出のモデルでも使う。動きを減らす設定では、追いつく直前の1枚を描く。
import { cachedLayer, clamp, drawSteps, drawTag, glow, ramp, rgba, roundRect, smooth, type Palette, type Pt, type StartModel } from "./common";

// ===== 共通の描き方 =====

// 赤血球：両凹の円盤。tilt（0〜1）が小さいほど傾いて、縁だけ見える細い楕円になる
export function drawRbc(g: CanvasRenderingContext2D, x: number, y: number, r: number, angle: number, tilt: number, p: Palette, alpha = 1): void {
  const sy = Math.max(0.3, tilt);
  g.save(); g.translate(x, y); g.rotate(angle); g.scale(1, sy); g.globalAlpha *= alpha;
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2);
  g.fillStyle = p.card; g.fill();
  const body = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
  body.addColorStop(0, rgba(p.bad, 0.42)); body.addColorStop(0.6, rgba(p.bad, 0.55)); body.addColorStop(1, rgba(p.bad, 0.7));
  g.fillStyle = body; g.fill();
  g.strokeStyle = rgba(p.bad, 0.75); g.lineWidth = 0.9; g.stroke();
  // 真ん中は薄いので淡く見える
  const dimple = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.6);
  dimple.addColorStop(0, rgba(p.card, 0.6 * sy)); dimple.addColorStop(1, rgba(p.card, 0));
  g.fillStyle = dimple; g.beginPath(); g.arc(0, 0, r * 0.6, 0, Math.PI * 2); g.fill();
  g.restore();
}

// 好中球の姿勢。heading＝進む向き、reach＝前の仮足の張り出し、tail＝後ろの尾部、sx・sy＝平たさ、ruffle＝前縁のひだ
export interface CellPose { x: number; y: number; r: number; heading: number; reach: number; tail: number; sx?: number; sy?: number; ruffle?: number }

export function cellPath(c: CellPose, t: number): Path2D {
  const path = new Path2D(), sx = c.sx ?? 1, sy = c.sy ?? 1, ruffle = c.ruffle ?? 1;
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * Math.PI * 2, rel = a - c.heading;
    const lead = Math.max(0, Math.cos(rel)) ** 3, back = Math.max(0, -Math.cos(rel)) ** 10;
    const k = 1 + 0.035 * Math.sin(3 * a + t * 2.1) + 0.025 * Math.sin(5 * a - t * 2.7) + c.reach * lead + c.tail * back
      + ruffle * lead * (0.045 * Math.sin(11 * a + t * 5) + 0.025 * Math.sin(17 * a - t * 7));
    const x = c.x + Math.cos(a) * c.r * k * sx, y = c.y + Math.sin(a) * c.r * k * sy;
    if (i) path.lineTo(x, y); else path.moveTo(x, y);
  }
  path.closePath();
  return path;
}

// 細胞質：不透明な下地に、進む向き（葉状仮足）ほど明るい塗り。縁はにじみ＋細い線
export function paintCell(g: CanvasRenderingContext2D, path: Path2D, c: CellPose, p: Palette): void {
  g.fillStyle = p.card; g.fill(path);
  const fx = c.x + Math.cos(c.heading) * c.r * 0.7, fy = c.y + Math.sin(c.heading) * c.r * 0.7;
  const grad = g.createRadialGradient(fx, fy, c.r * 0.1, c.x, c.y, c.r * 1.45);
  grad.addColorStop(0, rgba(p.brand, 0.06)); grad.addColorStop(0.55, rgba(p.brand, 0.18)); grad.addColorStop(1, rgba(p.brand, 0.36));
  g.fillStyle = grad; g.fill(path);
  g.strokeStyle = rgba(p.brand, 0.22); g.lineWidth = 4; g.stroke(path);
  g.strokeStyle = rgba(p.brand, 0.85); g.lineWidth = 1.3; g.stroke(path);
}

// 顆粒：細胞の中をゆっくり流れる。一次顆粒（黄）と二次顆粒（青緑）
export function drawGranules(g: CanvasRenderingContext2D, path: Path2D, c: CellPose, t: number, p: Palette, skip = 0): void {
  g.save(); g.clip(path);
  for (let i = skip; i < 28; i++) {
    const a = i * 2.39996 + t * 0.12 * (i % 2 ? 1 : -1), rr = c.r * (0.22 + 0.55 * (((i * 37) % 23) / 23));
    const x = c.x + Math.cos(a) * rr * (c.sx ?? 1) + Math.sin(t * 1.3 + i) * 0.8, y = c.y + Math.sin(a) * rr * (c.sy ?? 1);
    g.fillStyle = i % 3 ? rgba(p.brand, 0.5) : rgba(p.warn, 0.6);
    g.beginPath(); g.arc(x, y, c.r * 0.052, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

// 分葉核の3つの葉の位置。spin を渡すと（転がっているとき）その角度で回す
export function lobesAt(c: CellPose, spin?: number): Pt[] {
  const back = (spin ?? c.heading) + Math.PI, side = back + Math.PI / 2, k = c.r;
  const cx = c.x + Math.cos(back) * k * 0.16, cy = c.y + Math.sin(back) * k * 0.16;
  return [-1, 0, 1].map((s): Pt => [
    cx + Math.cos(side) * s * k * 0.36 * (c.sx ?? 1) + Math.cos(back) * Math.abs(s) * k * 0.12,
    cy + Math.sin(side) * s * k * 0.36 * (c.sy ?? 1) + Math.sin(back) * Math.abs(s) * k * 0.12,
  ]);
}

export function drawNucleus(g: CanvasRenderingContext2D, lobes: readonly Pt[], r: number, p: Palette): void {
  g.lineCap = "round"; g.strokeStyle = rgba(p.brand2, 0.6); g.lineWidth = r * 0.38;
  g.beginPath(); lobes.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
  for (const [x, y] of lobes) {
    const grad = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    grad.addColorStop(0, rgba(p.brand2, 0.35)); grad.addColorStop(1, rgba(p.brand2, 0.72));
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = rgba(p.brand2, 0.85); g.lineWidth = 0.9; g.stroke();
  }
}

// 細菌（桿菌）：丸みのある体と、後ろへ波打つ鞭毛。dead（0〜1）で色が抜けて縮む
export function drawBacterium(g: CanvasRenderingContext2D, x: number, y: number, angle: number, s: number, t: number, p: Palette, dead = 0): void {
  const L = 9 * s * (1 - 0.3 * dead), W = 4.3 * s * (1 - 0.3 * dead), color = dead > 0.5 ? p.muted : p.good;
  g.save(); g.translate(x, y); g.rotate(angle); g.globalAlpha *= 1 - 0.6 * dead;
  if (dead < 0.3) {
    g.strokeStyle = rgba(p.good, 0.85); g.lineWidth = 1.1; g.lineCap = "round"; g.beginPath(); g.moveTo(-L + 1, 0);
    for (let i = 1; i <= 12; i++) g.lineTo(-L - i * 2.1 * s, Math.sin(t * 14 - i * 0.9) * 2.4 * s);
    g.stroke();
  }
  roundRect(g, -L, -W, L * 2, W * 2, W);
  const body = g.createLinearGradient(0, -W, 0, W);
  body.addColorStop(0, rgba(color, 0.7)); body.addColorStop(0.45, rgba(color, 1)); body.addColorStop(1, rgba(color, 0.65));
  g.fillStyle = body; g.fill(); g.strokeStyle = rgba(color, 1); g.lineWidth = 0.8; g.stroke();
  g.fillStyle = "rgba(255,255,255,0.35)"; roundRect(g, -L * 0.7, -W * 0.65, L * 1.2, W * 0.45, W * 0.22); g.fill();
  g.restore();
}

// ===== 好中球が細菌を追って食べる =====

const TURN_RATE = 1.7;      // 向きを変える速さ（rad/秒）
const ENGULF_SEC = 3.8;     // 包み込んでから殺菌し終えるまで
const STEPS = [
  "走化性：細菌が出すfMLP・C5aの\n濃い方へ這って追う",
  "貪食：仮足を伸ばして\n細菌を包み込む",
  "ファゴソームに閉じこめる",
  "顆粒が融合し、活性酸素と\n酵素で殺菌する",
];

interface Rbc { x: number; y: number; r: number; angle: number; phase: number; spin: number; vx: number; vy: number }
interface Scene {
  cell: { x: number; y: number; heading: number };
  bug: { x: number; y: number; angle: number; seed: number; born: number };
  eaten: number | null;                 // 包み込み始めた時刻（追っている間は null）
  catchAt: Pt;
  fuse: Pt[];                           // 融合する顆粒の、包み込み始めたときの位置（細胞の中心からのずれ）
  rbcs: Rbc[];
}

const rand = (min: number, max: number): number => min + Math.random() * (max - min);
const angleDiff = (a: number, b: number): number => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export const neutrophil: StartModel = {
  id: "neutrophil",
  label: "好中球の貪食",
  note: "いま動いているのは<b>好中球</b>。細菌が出すfMLPや補体C5aの濃い方へ這って追いかけ（走化性）、仮足で包んでファゴソームに閉じこめ、顆粒を融合させて殺菌します（貪食）。",
  create(w, h, still) {
    const R = clamp(h * 0.11, 22, 36), s = R / 26, fs = clamp(h * 0.035, 11, 13);
    const floor = h - fs * 4.6 - 8;   // 下の説明に細菌が隠れないよう、細菌はこれより上だけを泳ぐ
    const chase = R * 1.55, wander = R * 0.7, flee = R * 0.62, fleeRange = R * 3.4;
    const vignette = cachedLayer(w, h, (cg, p) => {
      const grad = cg.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
      grad.addColorStop(0, rgba(p.bad, 0.02)); grad.addColorStop(1, rgba(p.text, 0.07));
      cg.fillStyle = grad; cg.fillRect(0, 0, w, h);
    });
    const spawnBug = (sc: Scene, t: number): void => {
      const x = sc.cell.x < w / 2 ? rand(w * 0.6, w - 30) : rand(30, w * 0.4);
      sc.bug = { x, y: rand(30, floor - 20), angle: rand(0, Math.PI * 2), seed: rand(0, 100), born: t };
    };
    const scene: Scene = {
      cell: { x: w * 0.28, y: floor * 0.55, heading: 0 },
      bug: { x: w * 0.8, y: floor * 0.4, angle: Math.PI, seed: rand(0, 100), born: -10 },
      eaten: null, catchAt: [0, 0], fuse: [],
      rbcs: Array.from({ length: clamp(Math.round((w * h) / 7500), 6, 18) }, (): Rbc => ({
        x: rand(0, w), y: rand(0, h), r: R * rand(0.42, 0.52), angle: rand(0, Math.PI), phase: rand(0, Math.PI * 2), spin: rand(-0.5, 0.5), vx: rand(-6, 6), vy: rand(-3, 3),
      })),
    };
    if (still) {
      // 追いつく直前の1枚：好中球が仮足を伸ばし、目の前に細菌がいる
      scene.cell = { x: w * 0.42, y: floor * 0.55, heading: 0 };
      scene.bug = { ...scene.bug, x: w * 0.42 + R * 1.95, y: floor * 0.5, angle: 0 };
    }
    let lastStep = 0, stepAt = 0;

    const step = (t: number, dt: number): void => {
      const { cell, bug } = scene;
      for (const c of scene.rbcs) {
        c.x += c.vx * dt; c.y += c.vy * dt; c.angle += c.spin * dt * 0.3; c.phase += c.spin * dt;
        if (c.x < -20) c.x += w + 40; else if (c.x > w + 20) c.x -= w + 40;
        if (c.y < -20) c.y += h + 40; else if (c.y > h + 20) c.y -= h + 40;
      }
      if (scene.eaten !== null) {
        // 包み込んでいる間：細菌を細胞の中へ引き込み、好中球はほとんど止まる
        const k = (t - scene.eaten) / ENGULF_SEC, inX = cell.x + Math.cos(cell.heading) * R * 0.25, inY = cell.y + Math.sin(cell.heading) * R * 0.25;
        const pull = Math.min(1, dt * (k < 0.3 ? 2.2 : 4));
        bug.x += (inX - bug.x) * pull; bug.y += (inY - bug.y) * pull;
        if (k >= 1) { scene.eaten = null; spawnBug(scene, t); }
        return;
      }
      // 細菌：ふらふら泳ぎ、好中球が近いと逃げる。壁際では内側へ戻る
      const dx = bug.x - cell.x, dy = bug.y - cell.y, dist = Math.hypot(dx, dy) || 1, wv = bug.seed + t * 0.9;
      let vx = Math.cos(wv * 1.3 + Math.sin(wv * 0.7) * 2) * wander, vy = Math.sin(wv * 1.1 + Math.cos(wv * 0.5) * 2) * wander;
      if (dist < fleeRange) { const f = flee * (1 - dist / fleeRange); vx += (dx / dist) * f; vy += (dy / dist) * f; }
      if (bug.x < 24) vx += 30; else if (bug.x > w - 24) vx -= 30;
      if (bug.y < 24) vy += 30; else if (bug.y > floor - 16) vy -= 30;
      bug.x = clamp(bug.x + vx * dt, 8, w - 8); bug.y = clamp(bug.y + vy * dt, 8, floor);
      bug.angle += angleDiff(bug.angle, Math.atan2(vy, vx)) * Math.min(1, dt * 4);
      // 好中球：細菌の方へ少しずつ向きを変えながら這う（這う周期で速さが揺れる）
      cell.heading += clamp(angleDiff(cell.heading, Math.atan2(bug.y - cell.y, bug.x - cell.x)), -TURN_RATE * dt, TURN_RATE * dt);
      const speed = chase * (0.85 + 0.25 * Math.sin(t * 3));
      cell.x = clamp(cell.x + Math.cos(cell.heading) * speed * dt, R, w - R);
      cell.y = clamp(cell.y + Math.sin(cell.heading) * speed * dt, R, floor + R * 0.4);
      if (Math.hypot(bug.x - cell.x, bug.y - cell.y) < R * 1.05 && t - bug.born > 0.6) {
        scene.eaten = t; scene.catchAt = [bug.x, bug.y];
        scene.fuse = Array.from({ length: 6 }, (_, i): Pt => { const a = cell.heading + Math.PI + (i - 2.5) * 0.7; return [Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6]; });
      }
    };

    return (g, t, dt, p) => {
      if (dt) step(t, dt);
      const { cell, bug } = scene, k = scene.eaten === null ? -1 : (t - scene.eaten) / ENGULF_SEC;
      vignette(g, p);
      for (const c of scene.rbcs) drawRbc(g, c.x, c.y, c.r, c.angle, 0.3 + 0.7 * Math.abs(Math.cos(c.phase)), p);
      // 走化性因子の濃さ：細菌から広がる輪
      if (k < 0) {
        const born = ramp(t - bug.born, 0, 0.6);
        glow(g, bug.x, bug.y, R * 2.8, p.good, 0.16 * born);
        for (let i = 0; i < 3; i++) {
          const q = ((t * 0.35 + i / 3) % 1), rr = R * (0.6 + 2.6 * q);
          g.strokeStyle = rgba(p.good, 0.35 * (1 - q) * born); g.lineWidth = 1.2; g.beginPath(); g.arc(bug.x, bug.y, rr, 0, Math.PI * 2); g.stroke();
        }
        drawBacterium(g, bug.x, bug.y, bug.angle, s, t, p);
      }
      // 好中球：追っている間は前に仮足・後ろに尾部。包み込むときは細菌の方へ大きく仮足を伸ばす
      const toBug = Math.atan2(scene.catchAt[1] - cell.y, scene.catchAt[0] - cell.x);
      const cup = k >= 0 ? 1 - smooth(ramp(k, 0.18, 0.35)) : 0;
      const pose: CellPose = { x: cell.x, y: cell.y, r: R, heading: k >= 0 ? toBug : cell.heading, reach: k >= 0 ? 0.25 + 0.4 * cup : 0.3, tail: k >= 0 ? 0.12 : 0.3, ruffle: k >= 0 ? 0.5 : 1 };
      const path = cellPath(pose, t);
      paintCell(g, path, pose, p);
      // 取り込んだ細菌とファゴソーム。融合する顆粒が飛びこむたびに光る
      let fusing = 0;
      if (k >= 0) {
        const dead = smooth(ramp(k, 0.55, 0.95)), sealed = ramp(k, 0.28, 0.4);
        g.save(); g.clip(path);
        if (sealed > 0) {
          g.fillStyle = rgba(p.brand2, 0.1 * sealed); g.strokeStyle = rgba(p.brand2, 0.75 * sealed); g.lineWidth = 1.3;
          g.beginPath(); g.arc(bug.x, bug.y, 12 * s * (1 - 0.25 * dead), 0, Math.PI * 2); g.fill(); g.stroke();
        }
        drawBacterium(g, bug.x, bug.y, bug.angle, s, t, p, dead);
        scene.fuse.forEach(([fx, fy], i) => {
          const q = ramp(k, 0.45 + i * 0.06, 0.56 + i * 0.06);
          if (q <= 0) return;
          if (q < 1) {
            const x = cell.x + fx + (bug.x - cell.x - fx) * smooth(q), y = cell.y + fy + (bug.y - cell.y - fy) * smooth(q);
            g.fillStyle = rgba(p.warn, 0.9); g.beginPath(); g.arc(x, y, R * 0.07, 0, Math.PI * 2); g.fill();
          }
          fusing = Math.max(fusing, Math.max(0, 1 - Math.abs(q - 1) * 5) * (1 - ramp(k, 0.92, 1)));
        });
        if (fusing > 0) {
          glow(g, bug.x, bug.y, 18 * s, "#ffe680", 0.8 * fusing);
          for (let i = 0; i < 6; i++) { const a = i * 1.047 + t * 3; g.fillStyle = `rgba(255,240,170,${fusing})`; g.beginPath(); g.arc(bug.x + Math.cos(a) * 9 * s, bug.y + Math.sin(a) * 9 * s, 1.2, 0, Math.PI * 2); g.fill(); }
        }
        g.restore();
      }
      drawGranules(g, path, pose, t, p, k >= 0 ? Math.round(6 * ramp(k, 0.45, 0.8)) : 0);
      drawNucleus(g, lobesAt(pose), R * 0.2, p);
      // 名札
      const boxY = cell.y - R * 2.1 < 14 ? cell.y + R * 2.1 : cell.y - R * 2.1, box: Pt = [clamp(cell.x, 72, w - 72), boxY];
      if (k < 0) {
        const age = t - bug.born, by = bug.y - R * 2 < 14 ? bug.y + R * 2 : bug.y - R * 2;
        drawTag(g, "走化性因子（fMLP・C5a）", [clamp(bug.x, 80, w - 80), by], [[bug.x, bug.y + (by < bug.y ? -R * 0.9 : R * 0.9)]], ramp(age, 0.4, 0.8) * (1 - ramp(age, 2.8, 3.2)), fs, p);
      } else {
        const front: Pt = [cell.x + Math.cos(toBug) * R * 1.25, cell.y + Math.sin(toBug) * R * 1.25];
        drawTag(g, "仮足", box, [front], ramp(k, 0.02, 0.06) * (1 - ramp(k, 0.24, 0.28)), fs, p);
        drawTag(g, "ファゴソーム", box, [[bug.x, bug.y]], ramp(k, 0.3, 0.34) * (1 - ramp(k, 0.46, 0.5)), fs, p);
        drawTag(g, "顆粒が融合", box, [[bug.x, bug.y]], ramp(k, 0.52, 0.56) * (1 - ramp(k, 0.86, 0.9)), fs, p);
      }
      // いまの段階
      const now = k < 0 ? 0 : k < 0.28 ? 1 : k < 0.48 ? 2 : 3;
      if (now !== lastStep) { lastStep = now; stepAt = t; }
      drawSteps(g, 14, h - fs * 4.1 - 4, Math.min(w * 0.62, 260), STEPS, now, still ? 1 : ramp(t - stepAt, 0, 0.35), fs, p, true);
    };
  },
};
