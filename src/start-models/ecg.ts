// スタート画面のモデル「刺激伝導系と心電図」：左の心臓で、洞結節の興奮が心房に広がり、房室結節で少し待ってから
// ヒス束→右脚・左脚→プルキンエ線維と伝わる。右の心電図には同じ瞬間の波（P・QRS・T）が描かれ、描かれた波の名前が光る。
// 興奮した部分は黄色く光り、さめると戻る。収縮は電気より少し遅れて起こる（心房→心室）。
// 実際の約半分の速さで動かす（生理的な1拍＝1秒を2.2秒かけて見せる）。動きを減らす設定では、QRSの途中の1枚だけを描く。
import { bump, font, glow, ramp, rgba, type Palette, type StartModel } from "./common";

const SLOW = 2.2;            // 生理的な1秒を何秒かけて見せるか
const STILL_AT = 3.205;      // 止め絵の瞬間（4拍目、心室に興奮が広がっている途中）
const BEATS_ON_STRIP = 2.2;  // 心電図の画面に入る拍の数
const SAMPLES = 400;         // 心電図を1秒あたり何点で描くか（拍ごとに同じ点を通るので、R波の高さがぶれない）

type Pt = readonly [number, number];   // 心臓の枠（0〜1）の中の座標。左右は見る人から見た向き（右心房が左）
const SA: Pt = [0.27, 0.13], AV: Pt = [0.47, 0.41];
// 伝導路と、興奮が通る時刻（1拍の中の秒）
const PATHS: { pts: readonly Pt[]; from: number; to: number }[] = [
  { pts: [SA, [0.34, 0.25], [0.41, 0.34], AV], from: 0, to: 0.07 },        // 洞結節→房室結節
  { pts: [SA, [0.45, 0.15], [0.63, 0.2]], from: 0, to: 0.06 },             // 左心房へ
  { pts: [AV, [0.5, 0.5]], from: 0.15, to: 0.17 },                          // ヒス束
  { pts: [[0.5, 0.5], [0.465, 0.62], [0.48, 0.74], [0.52, 0.86], [0.42, 0.9], [0.26, 0.8], [0.17, 0.6]], from: 0.17, to: 0.235 },  // 右脚→プルキンエ線維
  { pts: [[0.5, 0.5], [0.525, 0.6], [0.54, 0.72], [0.58, 0.84], [0.68, 0.9], [0.83, 0.79], [0.89, 0.6]], from: 0.17, to: 0.235 },  // 左脚→プルキンエ線維
];
const WAVES = [{ name: "P", at: 0.06, height: 0.15 }, { name: "QRS", at: 0.19, height: 1 }, { name: "T", at: 0.44, height: 0.3 }];

const gauss = (x: number, mu: number, s: number): number => Math.exp(-(((x - mu) / s) ** 2) / 2);
// 1拍の中の時刻 tau（0〜1秒）での心電図の高さ（R波の頂点がほぼ1）
const ecgAt = (tau: number): number =>
  0.15 * gauss(tau, 0.06, 0.022) - 0.1 * gauss(tau, 0.165, 0.008) + gauss(tau, 0.19, 0.012) - 0.24 * gauss(tau, 0.214, 0.01) + 0.3 * gauss(tau, 0.44, 0.045);

interface Heart { atria: Path2D; ventricles: Path2D; septum: Path2D; lengths: number[][] }

function buildHeart(): Heart {
  const atria = new Path2D();
  atria.moveTo(0.47, 0.29); atria.ellipse(0.29, 0.29, 0.18, 0.15, 0, 0, Math.PI * 2);   // 右心房
  atria.moveTo(0.86, 0.27); atria.ellipse(0.69, 0.27, 0.17, 0.13, 0, 0, Math.PI * 2);   // 左心房
  const ventricles = new Path2D();
  ventricles.moveTo(0.12, 0.44); ventricles.lineTo(0.9, 0.44);
  ventricles.bezierCurveTo(0.95, 0.66, 0.8, 0.9, 0.6, 0.97);
  ventricles.bezierCurveTo(0.4, 0.98, 0.1, 0.72, 0.12, 0.44);
  ventricles.closePath();
  const septum = new Path2D();
  septum.moveTo(0.5, 0.44); septum.quadraticCurveTo(0.46, 0.72, 0.6, 0.93);
  // 伝導路ごとの、始点からの累積の長さ
  const lengths = PATHS.map(({ pts }) => pts.reduce<number[]>((acc, q, i) => [...acc, i ? acc[i - 1] + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0], []));
  return { atria, ventricles, septum, lengths };
}

// 伝導路を始点から f（0〜1）の割合まで引き、先端の位置を返す
function traceTo(g: CanvasRenderingContext2D, pts: readonly Pt[], cum: number[], f: number): Pt {
  const goal = cum[cum.length - 1] * f;
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] >= goal) {
      const k = (goal - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      const tip: Pt = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
      g.lineTo(tip[0], tip[1]); g.stroke();
      return tip;
    }
    g.lineTo(pts[i][0], pts[i][1]);
  }
  g.stroke();
  return pts[pts.length - 1];
}

// 興奮が広がる様子：部屋の形で切り抜いた円を、中心から広げる
function spread(g: CanvasRenderingContext2D, room: Path2D, c: Pt, r: number, on: number, front: boolean, p: Palette, px: number): void {
  g.save(); g.clip(room);
  g.fillStyle = rgba(p.warn, 0.32 * on); g.beginPath(); g.arc(c[0], c[1], r, 0, Math.PI * 2); g.fill();
  if (front) { g.strokeStyle = rgba(p.warn, 0.8); g.lineWidth = 2.4 * px; g.stroke(); }
  g.restore();
}

function drawHeart(g: CanvasRenderingContext2D, heart: Heart, tau: number, p: Palette, size: number, ox: number, oy: number): void {
  // 収縮は電気より少し遅れる：心房（P波のあと）→心室（QRSからT波の終わりまで）
  const squeeze = 0.02 * bump(tau, 0.1, 0.2) + 0.04 * bump(tau, 0.22, 0.5);
  const s = size * (1 - squeeze), px = 1 / s;
  g.save();
  g.translate(ox + size / 2, oy + size / 2); g.scale(s, s); g.translate(-0.5, -0.5);
  g.lineCap = "round"; g.lineJoin = "round";
  // 上大静脈と大動脈
  g.lineWidth = 0.075;
  g.strokeStyle = rgba(p.brand2, 0.2); g.beginPath(); g.moveTo(0.25, 0.01); g.lineTo(0.25, 0.2); g.stroke();
  g.strokeStyle = rgba(p.bad, 0.2); g.beginPath(); g.moveTo(0.56, 0.4); g.quadraticCurveTo(0.52, 0.02, 0.8, 0.06); g.stroke();
  // 心房・心室・中隔
  g.lineWidth = 1.4 * px; g.strokeStyle = rgba(p.bad, 0.5);
  g.fillStyle = rgba(p.bad, 0.1); g.fill(heart.atria); g.stroke(heart.atria);
  g.fillStyle = rgba(p.bad, 0.13); g.fill(heart.ventricles); g.stroke(heart.ventricles);
  g.lineWidth = 4 * px; g.strokeStyle = rgba(p.bad, 0.3); g.stroke(heart.septum);
  // 心房は洞結節から、心室は中隔の下の方から興奮が広がり、心室の付け根が最後になる
  const atrial = ramp(tau, 0, 0.09), atrialOn = 1 - ramp(tau, 0.16, 0.28);
  if (atrial > 0 && atrialOn > 0) spread(g, heart.atria, SA, atrial * 0.72, atrialOn, atrial < 1, p, px);
  const ventricular = ramp(tau, 0.17, 0.235), ventricularOn = 1 - ramp(tau, 0.36, 0.52);
  if (ventricular > 0 && ventricularOn > 0) spread(g, heart.ventricles, [0.52, 0.74], ventricular * 0.52, ventricularOn, ventricular < 1, p, px);
  // 伝導路：ふだんは淡く、興奮が通ったところは明るく、先端は光の点
  g.lineWidth = 1.4 * px; g.strokeStyle = rgba(p.warn, 0.35);
  PATHS.forEach((path, i) => traceTo(g, path.pts, heart.lengths[i], 1));
  PATHS.forEach((path, i) => {
    const f = ramp(tau, path.from, path.to), on = 1 - ramp(tau, path.to, path.to + 0.12);
    if (f <= 0 || on <= 0) return;
    g.lineWidth = 2.6 * px; g.strokeStyle = rgba(p.warn, 0.95 * on);
    const tip = traceTo(g, path.pts, heart.lengths[i], f);
    if (f < 1) glow(g, tip[0], tip[1], 0.05, p.warn, 0.9);
  });
  // 洞結節は拍の初めに、房室結節は興奮を待たせている間に光る
  const nodes: [Pt, number][] = [[SA, 1 - ramp(tau, 0.02, 0.12)], [AV, ramp(tau, 0.06, 0.08) * (1 - ramp(tau, 0.15, 0.2))]];
  for (const [[x, y], on] of nodes) {
    if (on > 0) glow(g, x, y, 0.03 + 0.05 * on, p.warn, 0.55 * on);
    g.fillStyle = rgba(p.warn, 0.55 + 0.45 * on); g.beginPath(); g.arc(x, y, 0.022, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

export const ecg: StartModel = {
  id: "ecg",
  label: "刺激伝導系",
  note: "いま動いているのは<b>刺激伝導系</b>。洞結節の興奮が心房に広がり（P波）、房室結節で少し待ってから、ヒス束・脚・プルキンエ線維で心室へ一気に伝わります（QRS）。心室の興奮がさめるのがT波です（実際の約半分の速さ）。",
  create(width, height, still) {
    const heart = buildHeart();
    const size = Math.min(height * 0.9, width * 0.42);
    const ox = Math.max(10, width * 0.03), oy = (height - size) / 2;
    // 心電図の画面：見る幅 W に BEATS_ON_STRIP 拍。カーソルが左から右へ掃き、少し先を消しながら描き直す
    const x0 = ox + size + 16, W = width - 14 - x0, perSec = W / BEATS_ON_STRIP, gap = 14, span = (W - gap) / perSec;
    const mid = height * 0.6, amp = height * 0.32, top = height * 0.12, bottom = height * 0.9, grid = 0.2 * perSec;
    const t0 = still ? STILL_AT * SLOW : 0;
    const xAt = (sec: number): number => x0 + (((sec * perSec) % W) + W) % W;

    return (g, time, _dt, p) => {
      const tp = (time + t0) / SLOW, tau = tp % 1;
      drawHeart(g, heart, tau, p, size, ox, oy);
      // 方眼（0.2秒ごと）
      g.strokeStyle = rgba(p.bad, 0.1); g.lineWidth = 1; g.beginPath();
      for (let x = x0; x <= x0 + W + 0.5; x += grid) { g.moveTo(x, top); g.lineTo(x, bottom); }
      for (let k = Math.ceil((top - mid) / grid); mid + k * grid <= bottom; k++) { g.moveTo(x0, mid + k * grid); g.lineTo(x0 + W, mid + k * grid); }
      g.stroke();
      // 波形：1/SAMPLES 秒ごとの点を結ぶ。右端から左端へ戻るところで線を切る
      g.strokeStyle = p.good; g.lineWidth = 1.8; g.lineJoin = "round"; g.beginPath();
      let prevX = Infinity;
      for (let k = Math.ceil((tp - span) * SAMPLES); k <= tp * SAMPLES; k++) {
        const sec = k / SAMPLES, x = xAt(sec), y = mid - amp * ecgAt(((sec % 1) + 1) % 1);
        if (x < prevX) g.moveTo(x, y); else g.lineTo(x, y);
        prevX = x;
      }
      g.stroke();
      const headX = xAt(tp), headY = mid - amp * ecgAt(tau);
      glow(g, headX, headY, 10, p.good, 0.55);
      g.fillStyle = p.good; g.beginPath(); g.arc(headX, headY, 2.4, 0, Math.PI * 2); g.fill();
      // 波の名前：描かれた瞬間は心臓と同じ黄色で光り、だんだん落ち着いた色に戻る
      g.font = font(11, 700); g.textAlign = "center";
      for (let n = Math.floor(tp) - 2; n <= Math.floor(tp); n++) {
        for (const w of WAVES) {
          const age = tp - (n + w.at);
          if (age < 0 || age > span) continue;
          const x = xAt(n + w.at), y = mid - amp * w.height - 9;
          g.fillStyle = rgba(p.muted, 0.75); g.fillText(w.name, x, y);
          const fresh = 1 - age / 0.6;
          if (fresh > 0) { g.fillStyle = rgba(p.warn, fresh); g.fillText(w.name, x, y); }
        }
      }
    };
  },
};
