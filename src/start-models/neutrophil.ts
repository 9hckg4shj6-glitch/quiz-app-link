// スタート画面のモデル「好中球の追跡と貪食」：赤血球のあいだを、好中球が細菌を追って這う。
// 細菌が出すホルミルペプチドや補体C5aの濃い方へ向かい（走化性）、追いつくと仮足で包み込んで
// ファゴソームに取り込み、消化する（貪食）。食べ終えると、別の場所に現れた次の細菌を追う。
// 好中球は分葉した核（3葉）と細かい顆粒で描く。細菌は逃げるが、好中球の方が少し速いので必ず捕まる。
// 色は CSS 変数から読むので、ライト／ダークの切り替えに追従する。動きを減らす設定では、追いつく直前の1枚だけを描く。
import { clamp, rgba, type Palette, type StartModel } from "./common";

const CELL_R = 26;            // 好中球の半径
const CHASE_SPEED = 40;       // 好中球の這う速さ（px/秒）。這う周期で 0.85〜1.1 倍に揺れる
const TURN_RATE = 1.7;        // 向きを変える速さ（rad/秒）
const WANDER_SPEED = 18;      // 細菌のふだんの泳ぐ速さ
const FLEE_SPEED = 16;        // 好中球が近いときに足される逃げる速さ
const FLEE_RANGE = 90;
const ENGULF_SEC = 1.6;       // 包み込んでから消化し終えるまで

interface Rbc { x: number; y: number; r: number; tilt: number; squash: number; vx: number; vy: number; spin: number }
interface Scene {
  cell: { x: number; y: number; heading: number };
  bug: { x: number; y: number; angle: number; seed: number; born: number };
  eaten: number | null;   // 包み込み始めた時刻（追っている間は null）
  catchAt: { x: number; y: number };
  rbcs: Rbc[];
}

const rand = (min: number, max: number): number => min + Math.random() * (max - min);
const angleDiff = (a: number, b: number): number => Math.atan2(Math.sin(b - a), Math.cos(b - a));

function spawnBug(scene: Scene, width: number, height: number, t: number): void {
  // 好中球から遠い側に出す
  const x = scene.cell.x < width / 2 ? rand(width * 0.6, width - 30) : rand(30, width * 0.4);
  scene.bug = { x, y: rand(30, height - 30), angle: rand(0, Math.PI * 2), seed: rand(0, 100), born: t };
}

function makeScene(width: number, height: number): Scene {
  const count = clamp(Math.round((width * height) / 9000), 5, 14);
  const rbcs = Array.from({ length: count }, (): Rbc => ({
    x: rand(0, width), y: rand(0, height), r: rand(11, 15), tilt: rand(0, Math.PI), squash: Math.random() < 0.3 ? rand(0.35, 0.55) : rand(0.85, 1),
    vx: rand(-6, 6), vy: rand(-3, 3), spin: rand(-0.2, 0.2),
  }));
  // 開いた瞬間から追いかけている場面にする（細菌は最初から見えている）
  return {
    cell: { x: width * 0.28, y: height * 0.55, heading: 0 },
    bug: { x: width * 0.8, y: height * 0.4, angle: Math.PI, seed: rand(0, 100), born: -10 },
    eaten: null, catchAt: { x: 0, y: 0 }, rbcs,
  };
}

function step(scene: Scene, t: number, dt: number, width: number, height: number): void {
  const { cell, bug } = scene;
  for (const c of scene.rbcs) {
    c.x += c.vx * dt; c.y += c.vy * dt; c.tilt += c.spin * dt;
    if (c.x < -20) c.x += width + 40; else if (c.x > width + 20) c.x -= width + 40;
    if (c.y < -20) c.y += height + 40; else if (c.y > height + 20) c.y -= height + 40;
  }
  if (scene.eaten !== null) {
    // 包み込んでいる間は、細菌を細胞の中へ引き込みながら、好中球はほとんど止まる
    const k = Math.min(1, (t - scene.eaten) / ENGULF_SEC);
    bug.x += (cell.x - Math.cos(cell.heading) * 4 - bug.x) * Math.min(1, dt * 3);
    bug.y += (cell.y - Math.sin(cell.heading) * 4 - bug.y) * Math.min(1, dt * 3);
    if (k >= 1) { scene.eaten = null; spawnBug(scene, width, height, t); }
    return;
  }
  // 細菌：ふらふら泳ぎ、好中球が近いと逃げる。壁際では内側へ戻る
  const dx = bug.x - cell.x, dy = bug.y - cell.y, dist = Math.hypot(dx, dy) || 1;
  const wander = bug.seed + t * 0.9;
  let vx = Math.cos(wander * 1.3 + Math.sin(wander * 0.7) * 2) * WANDER_SPEED;
  let vy = Math.sin(wander * 1.1 + Math.cos(wander * 0.5) * 2) * WANDER_SPEED;
  if (dist < FLEE_RANGE) { const f = FLEE_SPEED * (1 - dist / FLEE_RANGE); vx += (dx / dist) * f; vy += (dy / dist) * f; }
  const margin = 24;
  if (bug.x < margin) vx += 30; else if (bug.x > width - margin) vx -= 30;
  if (bug.y < margin) vy += 30; else if (bug.y > height - margin) vy -= 30;
  bug.x = clamp(bug.x + vx * dt, 8, width - 8); bug.y = clamp(bug.y + vy * dt, 8, height - 8);
  bug.angle += angleDiff(bug.angle, Math.atan2(vy, vx)) * Math.min(1, dt * 4);
  // 好中球：細菌の方へ少しずつ向きを変えながら這う
  const target = Math.atan2(bug.y - cell.y, bug.x - cell.x);
  cell.heading += clamp(angleDiff(cell.heading, target), -TURN_RATE * dt, TURN_RATE * dt);
  const speed = CHASE_SPEED * (0.85 + 0.25 * Math.sin(t * 3));
  cell.x = clamp(cell.x + Math.cos(cell.heading) * speed * dt, CELL_R, width - CELL_R);
  cell.y = clamp(cell.y + Math.sin(cell.heading) * speed * dt, CELL_R, height - CELL_R);
  if (Math.hypot(bug.x - cell.x, bug.y - cell.y) < CELL_R * 0.95 && t - bug.born > 0.6) { scene.eaten = t; scene.catchAt = { x: bug.x, y: bug.y }; }
}

function drawRbc(g: CanvasRenderingContext2D, c: Rbc, p: Palette): void {
  // 赤血球は両凹の円盤：縁が厚く、真ん中が薄い（中央の淡い部分）。斜めのものは楕円に見える
  g.save(); g.translate(c.x, c.y); g.rotate(c.tilt); g.scale(1, c.squash);
  g.fillStyle = rgba(p.bad, 0.2); g.beginPath(); g.arc(0, 0, c.r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = rgba(p.bad, 0.32); g.lineWidth = c.r * 0.42; g.beginPath(); g.arc(0, 0, c.r * 0.74, 0, Math.PI * 2); g.stroke();
  g.restore();
}

function drawBug(g: CanvasRenderingContext2D, scene: Scene, t: number, p: Palette): void {
  const { bug } = scene;
  const inside = scene.eaten !== null ? Math.min(1, (t - scene.eaten) / ENGULF_SEC) : 0;
  const alpha = Math.min(1, (t - bug.born) / 0.6) * (1 - inside * 0.9);
  if (scene.eaten === null) {
    // 細菌が出す物質の濃さ（好中球はこの濃い方へ向かう）
    const glow = g.createRadialGradient(bug.x, bug.y, 0, bug.x, bug.y, 70);
    glow.addColorStop(0, rgba(p.good, 0.16 * alpha)); glow.addColorStop(1, rgba(p.good, 0));
    g.fillStyle = glow; g.beginPath(); g.arc(bug.x, bug.y, 70, 0, Math.PI * 2); g.fill();
  }
  g.save(); g.translate(bug.x, bug.y); g.rotate(bug.angle); g.globalAlpha = alpha;
  // 鞭毛：後ろへ波打つ
  g.strokeStyle = p.good; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-8, 0);
  for (let i = 1; i <= 10; i++) g.lineTo(-8 - i * 2.2, Math.sin(t * 14 - i * 0.9) * 2.4);
  g.stroke();
  // 桿菌の体
  g.fillStyle = p.good; g.beginPath(); g.ellipse(0, 0, 9, 4.2, 0, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1; g.restore();
  if (scene.eaten !== null) {
    // ファゴソーム：取り込んだ細菌を膜で包む
    g.strokeStyle = rgba(p.brand2, 0.55 * (1 - inside * 0.6)); g.lineWidth = 1.4;
    g.beginPath(); g.arc(bug.x, bug.y, 9 + inside * 2, 0, Math.PI * 2); g.stroke();
  }
}

function drawCell(g: CanvasRenderingContext2D, scene: Scene, t: number, p: Palette): void {
  const { cell } = scene;
  const engulfing = scene.eaten !== null ? 1 - Math.min(1, (t - scene.eaten) / ENGULF_SEC) : 0;
  const reachTo = scene.eaten !== null ? Math.atan2(scene.catchAt.y - cell.y, scene.catchAt.x - cell.x) : cell.heading;
  // 輪郭：ゆらぐ膜に、進む向き（包み込むときは細菌の方）へ張り出す仮足を足す
  g.beginPath();
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const lead = Math.max(0, Math.cos(a - reachTo)) ** 3;
    const r = CELL_R * (1 + 0.07 * Math.sin(3 * a + t * 2.1) + 0.05 * Math.sin(5 * a - t * 2.7) + lead * (0.32 + engulfing * 0.18));
    const x = cell.x + Math.cos(a) * r, y = cell.y + Math.sin(a) * r;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
  g.fillStyle = rgba(p.brand, 0.16); g.fill();
  g.strokeStyle = rgba(p.brand, 0.65); g.lineWidth = 1.6; g.stroke();
  // 顆粒
  for (let i = 0; i < 16; i++) {
    const a = i * 2.4 + t * 0.15, r = CELL_R * (0.25 + ((i * 37) % 10) / 16);
    g.fillStyle = rgba(p.brand, 0.4); g.beginPath(); g.arc(cell.x + Math.cos(a) * r, cell.y + Math.sin(a) * r, 1.3, 0, Math.PI * 2); g.fill();
  }
  // 分葉核：3つの葉を細い糸でつなぎ、進む向きの少し後ろに置く
  const back = cell.heading + Math.PI, side = cell.heading + Math.PI / 2;
  const cx = cell.x + Math.cos(back) * CELL_R * 0.18, cy = cell.y + Math.sin(back) * CELL_R * 0.18;
  const lobes = [-1, 0, 1].map((k) => ({
    x: cx + Math.cos(side) * k * CELL_R * 0.36 + Math.cos(back) * Math.abs(k) * CELL_R * 0.12,
    y: cy + Math.sin(side) * k * CELL_R * 0.36 + Math.sin(back) * Math.abs(k) * CELL_R * 0.12,
  }));
  g.strokeStyle = rgba(p.brand2, 0.5); g.lineWidth = 2;
  g.beginPath(); g.moveTo(lobes[0].x, lobes[0].y); g.lineTo(lobes[1].x, lobes[1].y); g.lineTo(lobes[2].x, lobes[2].y); g.stroke();
  g.fillStyle = rgba(p.brand2, 0.5);
  for (const l of lobes) { g.beginPath(); g.arc(l.x, l.y, CELL_R * 0.21, 0, Math.PI * 2); g.fill(); }
}

export const neutrophil: StartModel = {
  id: "neutrophil",
  label: "好中球の貪食",
  note: "いま動いているのは<b>好中球</b>。細菌が出すホルミルペプチドや補体C5aの濃い方へ這って追いかけ（走化性）、追いつくと仮足で包んで食べます（貪食）。",
  create(width, height, still) {
    const scene = makeScene(width, height);
    if (still) {
      // 追いつく直前の1枚：好中球が仮足を伸ばし、目の前に細菌がいる
      scene.cell = { x: width * 0.42, y: height * 0.55, heading: 0 };
      scene.bug = { ...scene.bug, x: width * 0.42 + CELL_R * 1.9, y: height * 0.5, angle: 0 };
    }
    return (g, t, dt, p) => {
      if (dt) step(scene, t, dt, width, height);
      for (const c of scene.rbcs) drawRbc(g, c, p);
      // 追っている細菌は細胞の下、取り込んだ細菌は細胞の上に描く
      if (scene.eaten === null) drawBug(g, scene, t, p);
      drawCell(g, scene, t, p);
      if (scene.eaten !== null) drawBug(g, scene, t, p);
    };
  },
};
