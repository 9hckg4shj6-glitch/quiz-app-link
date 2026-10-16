// スタート画面のモデル「刺激伝導系と心電図」。
// 左：心臓の四腔断面（見る人から見て左が右心房・右心室。右心系の血は青、左心系の血は赤）。心房と心室の間には
//   線維輪（電気を通さない）があり、そこを貫くのはヒス束だけ。洞結節→心房筋（バッハマン束で左心房へ）→房室結節で遅れる
//   →ヒス束→右脚（調節帯を通って右室の自由壁へ）・左脚→プルキンエ線維、と光の粒が走り、心筋には興奮の波面が広がる。
//   心筋の興奮は「心内膜側から心外膜側へ・中隔から・心尖から心基部へ」。さめるのは逆に心外膜側・心基部から（T波が上向きになる理由）。
//   電気のあとに収縮が起こり（心房→心室）、心室が縮む間は房室弁が閉じる。
// 右：心電図のモニター（II誘導）。描いている波（P・PQ・QRS・ST・T）を光らせ、下に今の出来事を1行で出す。
// 時間：大事な瞬間ほどゆっくり見せる（1拍の中で速さを変える）。動きを減らす設定では QRS の途中の1枚を描く。
import { bump, clamp, font, glow, ramp, rgba, smooth, type Palette, type StartModel } from "./common";

type Pt = readonly [number, number];

// ---- 形（心臓の枠を 0〜1 とした座標） ----
const OUTER: Pt[] = [[0.205, 0.16], [0.13, 0.22], [0.085, 0.33], [0.1, 0.45], [0.12, 0.53], [0.15, 0.66], [0.25, 0.79], [0.42, 0.9], [0.6, 0.965], [0.7, 0.95], [0.8, 0.86], [0.88, 0.72], [0.9, 0.58], [0.875, 0.46], [0.86, 0.36], [0.83, 0.24], [0.76, 0.165], [0.64, 0.14], [0.5, 0.15], [0.36, 0.14], [0.27, 0.14]];
const RA: Pt[] = [[0.235, 0.205], [0.165, 0.245], [0.128, 0.34], [0.138, 0.43], [0.165, 0.492], [0.29, 0.485], [0.405, 0.474], [0.422, 0.4], [0.412, 0.29], [0.36, 0.222], [0.3, 0.2]];
const LA: Pt[] = [[0.48, 0.215], [0.472, 0.33], [0.48, 0.468], [0.64, 0.457], [0.82, 0.443], [0.835, 0.36], [0.805, 0.255], [0.74, 0.193], [0.62, 0.178], [0.53, 0.19]];
const RV: Pt[] = [[0.17, 0.53], [0.3, 0.518], [0.415, 0.51], [0.44, 0.6], [0.47, 0.7], [0.505, 0.79], [0.535, 0.845], [0.47, 0.852], [0.36, 0.805], [0.25, 0.725], [0.185, 0.635]];
const LV: Pt[] = [[0.505, 0.503], [0.66, 0.49], [0.8, 0.48], [0.818, 0.56], [0.802, 0.66], [0.752, 0.76], [0.692, 0.832], [0.645, 0.866], [0.6, 0.832], [0.562, 0.742], [0.532, 0.642], [0.512, 0.565]];
const MODERATOR: Pt[] = [[0.478, 0.72], [0.39, 0.748], [0.29, 0.77]];   // 調節帯（右脚が通る筋の橋）
const AV_A: Pt = [0.11, 0.515], AV_B: Pt = [0.88, 0.455];                // 線維輪（房室間の電気の壁）
const avY = (x: number): number => AV_A[1] + ((x - AV_A[0]) * (AV_B[1] - AV_A[1])) / (AV_B[0] - AV_A[0]);
const BAND = 0.02, MOD_W = 0.022;
const SA: Pt = [0.245, 0.176], AVN: Pt = [0.444, 0.468], BIF: Pt = [0.468, 0.535];
const TRICUSPID: [Pt, Pt] = [[0.175, avY(0.175)], [0.405, avY(0.405)]];
const MITRAL: [Pt, Pt] = [[0.5, avY(0.5)], [0.81, avY(0.81)]];
const LV_MID: Pt = [0.67, 0.66], RV_MID: Pt = [0.33, 0.67];

// ---- 伝導系（start＝始点に興奮が着く時刻［1拍の中の秒］、speed＝枠の単位/秒） ----
interface CableDef { id: string; pts: Pt[]; start: number | string; speed?: number; end?: number; width: number; twigs?: Pt }
const CABLES: CableDef[] = [
  { id: "internodal", pts: [SA, [0.3, 0.28], [0.37, 0.39], AVN], start: 0, end: 0.045, width: 0.006 },
  { id: "bachmann", pts: [[0.265, 0.163], [0.38, 0.158], [0.5, 0.163], [0.62, 0.163], [0.7, 0.172]], start: 0.004, end: 0.03, width: 0.006 },
  { id: "his", pts: [AVN, [0.452, 0.497], BIF], start: 0.13, end: 0.15, width: 0.012 },
  { id: "rb", pts: [BIF, [0.455, 0.6], [0.478, 0.68], [0.482, 0.716], [0.39, 0.748], [0.29, 0.77]], start: 0.15, speed: 16, width: 0.007, twigs: RV_MID },
  { id: "lb", pts: [BIF, [0.5, 0.575], [0.515, 0.645], [0.54, 0.73], [0.575, 0.81], [0.615, 0.862]], start: 0.15, speed: 16, width: 0.009, twigs: LV_MID },
  { id: "lvp", pts: [[0.615, 0.862], [0.65, 0.885], [0.705, 0.848], [0.768, 0.773], [0.818, 0.668], [0.835, 0.56], [0.82, 0.497]], start: "lb", speed: 13, width: 0.005, twigs: LV_MID },
  { id: "rvu", pts: [[0.29, 0.77], [0.235, 0.738], [0.17, 0.64], [0.153, 0.55]], start: "rb", speed: 13, width: 0.005, twigs: RV_MID },
  { id: "rvd", pts: [[0.29, 0.77], [0.36, 0.822], [0.47, 0.868], [0.54, 0.86]], start: "rb", speed: 13, width: 0.005, twigs: RV_MID },
];
const V_ATRIA = 4.6, V_VENTRICLE = 2.6, V_TWIG = 13;   // 心房筋・心室筋・プルキンエの末梢の伝わる速さ（枠の単位/秒）

// 名札：その部分を興奮が通る間だけ出す（at＝指す先、box＝名札の中心）
const TAGS: { text: string; at: Pt[]; box: Pt; from: number; to: number }[] = [
  { text: "洞結節", at: [SA], box: [0.12, 0.06], from: 0, to: 0.085 },
  { text: "房室結節", at: [AVN], box: [0.25, 0.33], from: 0.045, to: 0.14 },
  { text: "ヒス束", at: [[0.452, 0.5]], box: [0.25, 0.585], from: 0.125, to: 0.16 },
  { text: "右脚・左脚", at: [[0.456, 0.61], [0.503, 0.6]], box: [0.25, 0.68], from: 0.15, to: 0.178 },
  { text: "プルキンエ\n線維", at: [[0.8, 0.7]], box: [0.69, 0.62], from: 0.178, to: 0.25 },
];

// ---- 1拍の中の時間の進み方：区間ごとに「何秒かけて見せるか」 ----
const BOUNDS = [0, 0.1, 0.155, 0.235, 0.34, 0.54, 1];
const SHOW_SEC = [0.95, 0.75, 1.05, 0.45, 0.75, 0.55];
const EVENTS = [
  "洞結節が興奮し、\n心房に広がる（P波）",
  "房室結節で、伝わり方が\nゆっくりになる（PQ）",
  "ヒス束→脚→プルキンエ線維で\n心室へ一気に（QRS）",
  "心室全体が興奮中（ST）",
  "心室の興奮がさめる（T波）",
  "次の興奮まで休む（拡張期）",
];
const WAVES = [
  { name: "P", from: 0.01, to: 0.11, y: 0.17, keep: true }, { name: "PQ", from: 0.11, to: 0.155, y: 0.12, keep: false },
  { name: "QRS", from: 0.155, to: 0.235, y: 1, keep: true }, { name: "ST", from: 0.235, to: 0.34, y: 0.14, keep: false },
  { name: "T", from: 0.34, to: 0.54, y: 0.34, keep: true },
];
const STILL_TAU = 0.2;
const SAMPLES = 500;      // 心電図を1秒あたり何点で描くか（拍ごとに同じ点を通るので、波の形がぶれない）
const VISIBLE_BEATS = 1.45;
const MONITOR = { bg: "#0b1322", line: "rgba(255,255,255,0.08)", trace: "#3ef08f", grid: "62,240,143", amber: "#ffcf5a", ink: "#cfe9dc" };

const gauss = (x: number, mu: number, s: number): number => Math.exp(-(((x - mu) / s) ** 2) / 2);
// II誘導らしい形：小さな P、平らな PQ、鋭い QRS、なだらかに上がって早めに下がる T
const ecgAt = (tau: number): number =>
  0.16 * gauss(tau, 0.06, 0.021) - 0.12 * gauss(tau, 0.168, 0.0075) + gauss(tau, 0.19, 0.0105) - 0.26 * gauss(tau, 0.212, 0.0095)
  + 0.34 * gauss(tau, 0.45, tau < 0.45 ? 0.058 : 0.04);

const rgbOf = (hex: string): [number, number, number] => {
  const h = hex.replace("#", ""), f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), n = Number.parseInt(f, 16);
  return Number.isNaN(n) ? [220, 160, 40] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// Catmull-Rom の曲線で点を滑らかにつなぐ
function spline(c: CanvasPath, pts: readonly Pt[], closed: boolean): void {
  const n = pts.length, at = (i: number): Pt => pts[closed ? (i + n) % n : clamp(i, 0, n - 1)];
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    c.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
  }
  if (closed) c.closePath();
}
// 同じ曲線を細かい折れ線にする（途中まで光らせる・時刻を割り振るため）
function dense(pts: readonly Pt[], steps = 10): Pt[] {
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
const pathOf = (pts: readonly Pt[], closed: boolean): Path2D => { const p = new Path2D(); spline(p, pts, closed); return p; };

interface Cable { id: string; pts: Pt[]; cum: number[]; start: number; end: number; width: number }
interface Twig { pts: Pt[]; start: number; end: number }

function buildConduction(): { cables: Cable[]; twigs: Twig[] } {
  const cables: Cable[] = [];
  for (const d of CABLES) {
    const pts = dense(d.pts), cum = pts.reduce<number[]>((acc, q, i) => [...acc, i ? acc[i - 1] + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0], []);
    const start = typeof d.start === "string" ? (cables.find((c) => c.id === d.start)?.end ?? 0) : d.start;
    cables.push({ id: d.id, pts, cum, start, end: d.end ?? start + cum[cum.length - 1] / (d.speed ?? 1), width: d.width });
  }
  // プルキンエの末梢：幹から心筋の側へ短い枝を出し、途中で二股に分ける（毎回同じ形になるよう乱数は固定）
  let seed = 7;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const twigs: Twig[] = [];
  for (const d of CABLES) {
    if (!d.twigs) continue;
    const c = cables.find((x) => x.id === d.id)!, total = c.cum[c.cum.length - 1];
    for (let s = 0.03; s < total; s += 0.026) {
      const i = c.cum.findIndex((v) => v >= s), [x, y] = c.pts[i];
      if (d.id === "rb" && y > 0.712) break;   // 調節帯の上（右室の内腔の中）には枝を出さない
      const away = Math.atan2(y - d.twigs[1], x - d.twigs[0]) + (rnd() - 0.5) * 0.9, len = 0.02 + rnd() * 0.016;
      const mid: Pt = [x + Math.cos(away) * len * 0.6, y + Math.sin(away) * len * 0.6];
      const t0 = c.start + (s / total) * (c.end - c.start), tMid = t0 + (len * 0.6) / V_TWIG;
      for (const turn of [-0.5, 0.5]) {
        const tip: Pt = [mid[0] + Math.cos(away + turn) * len * 0.5, mid[1] + Math.sin(away + turn) * len * 0.5];
        twigs.push({ pts: [[x, y], mid, tip], start: t0, end: tMid + (len * 0.5) / V_TWIG });
      }
    }
  }
  return { cables, twigs };
}

// 心筋の各点が興奮する時刻とさめる時刻を、壁の形に沿った最短の伝わり方（ダイクストラ法）で先に求めておく
function buildField(G: number, shapes: Shapes, cables: Cable[], twigs: Twig[]): { act: Float64Array; rep: Float32Array; cells: Int32Array } {
  const m = document.createElement("canvas"); m.width = m.height = G;
  const mg = m.getContext("2d", { willReadFrequently: true })!;
  mg.scale(G, G); mg.fillStyle = "#fff"; mg.fill(shapes.outer);
  mg.globalCompositeOperation = "destination-out";
  for (const c of shapes.cavities) mg.fill(c);
  mg.lineWidth = BAND; mg.stroke(shapes.band);
  mg.globalCompositeOperation = "source-over"; mg.strokeStyle = "#fff"; mg.lineWidth = MOD_W; mg.lineCap = "round"; mg.stroke(shapes.moderator);
  const alpha = mg.getImageData(0, 0, G, G).data;
  const region = new Uint8Array(G * G);   // 1＝心房筋、2＝心室筋
  for (let i = 0; i < G * G; i++) if (alpha[i * 4 + 3] > 128) region[i] = ((i / G) | 0) + 0.5 < avY(((i % G) + 0.5) / G) * G ? 1 : 2;
  const act = new Float64Array(G * G).fill(Infinity);   // 64bit：ヒープの時刻と同じ精度で比べる（32bitだと丸めで点が抜ける）
  const cellOf = ([x, y]: Pt, want: number): number => {
    const cx = Math.round(x * G), cy = Math.round(y * G);
    for (let r = 0; r <= 5; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) === r && nx >= 0 && ny >= 0 && nx < G && ny < G && region[ny * G + nx] === want) return ny * G + nx;
    }
    return -1;
  };
  const spread = (want: number, seeds: [Pt, number][], speed: number): void => {
    const cap = G * G * 8 + seeds.length, keys = new Float64Array(cap), vals = new Int32Array(cap);
    let size = 0;
    const push = (k: number, v: number): void => {
      let i = size++;
      while (i > 0) { const p = (i - 1) >> 1; if (keys[p] <= k) break; keys[i] = keys[p]; vals[i] = vals[p]; i = p; }
      keys[i] = k; vals[i] = v;
    };
    const popTop = (): void => {
      const k = keys[--size], v = vals[size];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= size) break;
        if (c + 1 < size && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= k) break;
        keys[i] = keys[c]; vals[i] = vals[c]; i = c;
      }
      keys[i] = k; vals[i] = v;
    };
    for (const [pt, t] of seeds) { const i = cellOf(pt, want); if (i >= 0 && t < act[i]) { act[i] = t; push(t, i); } }
    const step = 1 / G / speed;
    while (size) {
      const t = keys[0], i = vals[0]; popTop();
      if (t > act[i]) continue;
      const x = i % G, y = (i / G) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
        const j = ny * G + nx, nt = t + (dx && dy ? Math.SQRT2 : 1) * step;
        if (region[j] === want && nt < act[j]) { act[j] = nt; push(nt, j); }
      }
    }
  };
  const along = (id: string): [Pt, number][] => {
    const c = cables.find((x) => x.id === id)!, total = c.cum[c.cum.length - 1];
    return c.pts.map((pt, i): [Pt, number] => [pt, c.start + (c.cum[i] / total) * (c.end - c.start)]);
  };
  spread(1, [[SA, 0], ...along("bachmann")], V_ATRIA);
  spread(2, [...["rb", "lb", "lvp", "rvu", "rvd"].flatMap(along), ...twigs.flatMap((w): [Pt, number][] => [[w.pts[1], (w.start + w.end) / 2], [w.pts[2], w.end]])], V_VENTRICLE);
  // さめる時刻：心房は興奮から一定時間後。心室は遅く興奮した所（心外膜側・心基部）ほど早くさめる
  const rep = new Float32Array(G * G), list: number[] = [];
  for (let i = 0; i < G * G; i++) {
    if (!Number.isFinite(act[i])) continue;
    list.push(i);
    rep[i] = region[i] === 1 ? act[i] + 0.13 : clamp(0.5 - 1.1 * (act[i] - 0.16), 0.4, 0.52);
  }
  return { act, rep, cells: Int32Array.from(list) };
}

interface Shapes { outer: Path2D; cavities: Path2D[]; right: Path2D[]; left: Path2D[]; band: Path2D; moderator: Path2D; myo: Path2D }
function buildShapes(): Shapes {
  const [ra, la, rv, lv] = [RA, LA, RV, LV].map((pts) => pathOf(pts, true));
  const band = new Path2D(); band.moveTo(0.06, avY(0.06)); band.lineTo(0.94, avY(0.94));
  // 心筋だけの形（evenodd で使う）：外形の中から内腔を抜き、右室の中の調節帯を足す
  const myo = new Path2D(), line = dense(MODERATOR);
  for (const pts of [OUTER, RA, LA, RV, LV]) spline(myo, pts, true);
  const side = (k: number): Pt[] => line.map(([x, y], i) => {
    const [ax, ay] = line[Math.max(0, i - 1)], [bx, by] = line[Math.min(line.length - 1, i + 1)], len = Math.hypot(bx - ax, by - ay) || 1;
    return [x - ((by - ay) / len) * k * MOD_W * 0.5, y + ((bx - ax) / len) * k * MOD_W * 0.5];
  });
  [...side(1), ...side(-1).reverse()].forEach(([x, y], i) => (i ? myo.lineTo(x, y) : myo.moveTo(x, y)));
  myo.closePath();
  return { outer: pathOf(OUTER, true), cavities: [ra, la, rv, lv], right: [ra, rv], left: [la, lv], band, moderator: pathOf(MODERATOR, false), myo };
}

function strokeTube(g: CanvasRenderingContext2D, path: Path2D, width: number, color: string, p: Palette): void {
  // 太い血管：不透明な下地→色→細い明るい線（丸みのつや）
  g.lineCap = "round"; g.lineJoin = "round";
  g.strokeStyle = p.card; g.lineWidth = width; g.stroke(path);
  g.strokeStyle = rgba(color, 0.42); g.stroke(path);
  g.strokeStyle = rgba(color, 0.6); g.lineWidth = 0.006; g.stroke(path);
  g.strokeStyle = "rgba(255,255,255,0.28)"; g.lineWidth = width * 0.22; g.stroke(path);
}

// 動かない部分（血管・心筋・内腔・線維輪・伝導系の下地）を1枚に描いておく
function drawBase(g: CanvasRenderingContext2D, s: Shapes, cables: Cable[], twigs: Twig[], p: Palette, shadowPx: number): void {
  // 大血管：奥に右肺動脈、大動脈弓と3本の枝（腕頭動脈・左総頸動脈・左鎖骨下動脈）、手前に肺動脈幹、右に上大静脈
  const tube = (pts: Pt[]): Path2D => pathOf(pts, false);
  strokeTube(g, tube([[0.56, 0.14], [0.46, 0.118], [0.36, 0.128]]), 0.05, p.brand2, p);
  for (const branch of [[[0.515, 0.05], [0.495, -0.035]], [[0.575, 0.03], [0.578, -0.045]], [[0.632, 0.04], [0.655, -0.035]]] as Pt[][]) strokeTube(g, tube(branch), 0.03, p.bad, p);
  strokeTube(g, tube([[0.5, 0.34], [0.476, 0.17], [0.5, 0.062], [0.6, 0.028], [0.69, 0.062], [0.715, 0.17]]), 0.08, p.bad, p);
  strokeTube(g, tube([[0.42, 0.38], [0.45, 0.25], [0.53, 0.165], [0.6, 0.132], [0.69, 0.118], [0.76, 0.13]]), 0.068, p.brand2, p);
  strokeTube(g, tube([[0.215, -0.03], [0.235, 0.22]]), 0.08, p.brand2, p);
  // 心筋：やわらかい影を落とした不透明な下地に筋の色、左上からの光
  g.shadowColor = "rgba(10,20,40,0.22)"; g.shadowBlur = shadowPx; g.shadowOffsetY = shadowPx * 0.3;
  g.fillStyle = p.card; g.fill(s.outer);
  g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetY = 0;
  const muscle = g.createLinearGradient(0.1, 0.15, 0.85, 0.95);
  muscle.addColorStop(0, rgba(p.bad, 0.42)); muscle.addColorStop(1, rgba(p.bad, 0.66));
  g.fillStyle = muscle; g.fill(s.outer);
  const sheen = g.createRadialGradient(0.32, 0.3, 0, 0.32, 0.3, 0.62);
  sheen.addColorStop(0, "rgba(255,255,255,0.22)"); sheen.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = sheen; g.fill(s.outer);
  // 線維輪：心房と心室の筋を電気的に分ける白い帯
  g.save(); g.clip(s.outer);
  g.strokeStyle = p.card; g.lineWidth = BAND; g.stroke(s.band);
  g.strokeStyle = rgba(p.text, 0.14); g.lineWidth = 0.003; g.stroke(s.band);
  g.restore();
  // 内腔：右心系は青、左心系は赤。縁（心内膜）を細く引く
  for (const [list, color, a] of [[s.right, p.brand2, 0.2], [s.left, p.bad, 0.16]] as const) {
    for (const c of list) {
      g.fillStyle = p.card; g.fill(c);
      g.fillStyle = rgba(color, a); g.fill(c);
      g.strokeStyle = rgba(p.bad, 0.55); g.lineWidth = 0.004; g.stroke(c);
    }
  }
  g.lineCap = "round";
  g.strokeStyle = p.card; g.lineWidth = MOD_W; g.stroke(s.moderator);
  g.strokeStyle = rgba(p.bad, 0.55); g.stroke(s.moderator);
  g.strokeStyle = rgba(p.bad, 0.85); g.lineWidth = 0.005; g.stroke(s.outer);
  // 伝導系の下地（淡い黄色）
  g.strokeStyle = rgba(p.warn, 0.5); g.lineJoin = "round";
  for (const c of cables) {
    g.lineWidth = c.width * (c.id === "internodal" ? 0.6 : 1);
    if (c.id === "internodal") g.setLineDash([0.012, 0.01]);
    g.beginPath(); c.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    g.setLineDash([]);
  }
  g.strokeStyle = rgba(p.warn, 0.35); g.lineWidth = 0.0035;
  for (const w of twigs) { g.beginPath(); w.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); }
  g.fillStyle = rgba(p.warn, 0.7);
  g.beginPath(); g.ellipse(SA[0], SA[1], 0.03, 0.012, -0.25, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(AVN[0], AVN[1], 0.022, 0.011, 0.2, 0, Math.PI * 2); g.fill();
}

// 折れ線を始点から f（0〜1）の割合まで引き、先端を返す
function partial(g: CanvasRenderingContext2D, pts: readonly Pt[], cum: number[], f: number): Pt {
  const goal = cum[cum.length - 1] * f;
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] >= goal) {
      const k = (goal - cum[i - 1]) / (cum[i] - cum[i - 1] || 1), tip: Pt = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
      g.lineTo(tip[0], tip[1]);
      return tip;
    }
    g.lineTo(pts[i][0], pts[i][1]);
  }
  return pts[pts.length - 1];
}

// 房室弁：心室が縮む間（QRS のあと〜T波の終わりごろ）は閉じ、それ以外は心室の側へ開く
function drawValve(g: CanvasRenderingContext2D, [a, b]: [Pt, Pt], closed: number, chordTo: Pt[], p: Palette): void {
  const span = Math.hypot(b[0] - a[0], b[1] - a[1]), half = span / 2, meet: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.006];
  g.lineCap = "round";
  [[a, b, 1], [b, a, -1]].forEach(([s, e, side], k) => {
    const [sx, sy] = s as Pt, [ex, ey] = e as Pt, dx = (ex - sx) / span, dy = (ey - sy) / span, turn = (side as number) * 1.25;
    const open: Pt = [sx + (dx * Math.cos(turn) - dy * Math.sin(turn)) * half * 0.95, sy + (dx * Math.sin(turn) + dy * Math.cos(turn)) * half * 0.95];
    const tip: Pt = [open[0] + (meet[0] - open[0]) * closed, open[1] + (meet[1] - open[1]) * closed];
    g.strokeStyle = rgba(p.text, 0.16); g.lineWidth = 0.0025;
    g.beginPath(); g.moveTo(tip[0], tip[1]); g.lineTo(chordTo[k][0], chordTo[k][1]); g.stroke();
    g.strokeStyle = rgba(p.text, 0.6); g.lineWidth = 0.0095;
    g.beginPath(); g.moveTo(sx, sy); g.quadraticCurveTo((sx + tip[0]) / 2 + (1 - closed) * 0.008 * (side as number), (sy + tip[1]) / 2 + 0.012 * (1 - closed), tip[0], tip[1]); g.stroke();
  });
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// 日本語を幅に収まるよう1文字ずつ折り返す
function wrap(g: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of text) { if (line && g.measureText(line + ch).width > width) { lines.push(line); line = ch; } else line += ch; }
  return line ? [...lines, line] : lines;
}

export const ecg: StartModel = {
  id: "ecg",
  label: "刺激伝導系",
  note: "いま動いているのは<b>刺激伝導系</b>。洞結節の興奮が心房に広がり（P波）、房室結節で少し待ってから、ヒス束・脚・プルキンエ線維で心室へ一気に伝わります（QRS）。心室の興奮がさめるのがT波です（大事な瞬間ほどゆっくり再生）。",
  create(w, h, still) {
    const shapes = buildShapes(), { cables, twigs } = buildConduction();
    const G = 300, field = buildField(G, shapes, cables, twigs);
    const dpr = Math.min(2, devicePixelRatio || 1);
    // 心臓の枠 S。上に大動脈弓の枝がはみ出すぶんも含めて上下の真ん中に置く
    const S = Math.min(h * 0.92, w * 0.5), ox = Math.max(6, w * 0.015), oy = (h - S * 1.02) / 2 + S * 0.055;
    // 右の列：モニターと、その下の出来事の説明
    const colX = ox + S + 10, colW = w - 10 - colX, fs = clamp(h * 0.035, 11, 13);
    const mh = Math.min(h * 0.6, colW * 0.88), my = Math.max(8, (h - mh - fs * 5.2) / 2);
    const plotX = colX + 8, plotW = colW - 16, plotY = my + 24, plotH = mh - 32, mid = plotY + plotH * 0.66, amp = plotH * 0.52;
    const perSec = plotW / VISIBLE_BEATS, gap = 10, span = (plotW - gap) / perSec;
    const xAt = (sec: number): number => plotX + (((sec * perSec) % plotW) + plotW) % plotW;
    // 見せる時間 → 1拍の中の時刻 tau の対応表（区間の境目は少しなめらかに速さを変える）
    const N = 2000, cum = new Float64Array(N + 1);
    for (let k = 0; k < N; k++) {
      const tau = (k + 0.5) / N, sig = (x: number): number => 1 / (1 + Math.exp(-x / 0.006));
      let dens = 0;
      for (let i = 0; i < SHOW_SEC.length; i++) dens += (SHOW_SEC[i] / (BOUNDS[i + 1] - BOUNDS[i])) * (sig(tau - (i ? BOUNDS[i] : -1)) - sig(tau - (i === SHOW_SEC.length - 1 ? 2 : BOUNDS[i + 1])));
      cum[k + 1] = cum[k] + dens / N;
    }
    const beatSec = cum[N];
    const physAt = (t: number): number => {
      const n = Math.floor(t / beatSec), r = t - n * beatSec;
      let lo = 0, hi = N;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= r) lo = m; else hi = m; }
      return n + (lo + (r - cum[lo]) / (cum[hi] - cum[lo] || 1)) / N;
    };
    const t0 = still ? cum[Math.round(STILL_TAU * N)] + beatSec * 3 : beatSec * 2;   // 開いた瞬間から心電図が埋まっているように2拍ぶん進めておく

    const base = document.createElement("canvas"), fieldCanvas = document.createElement("canvas");
    const pad = { top: 0.08, bottom: 0.05, side: 0.03 };   // 枠の外にはみ出す血管と影のぶん
    base.width = Math.max(1, Math.round(S * (1 + 2 * pad.side) * dpr)); base.height = Math.max(1, Math.round(S * (1 + pad.top + pad.bottom) * dpr));
    fieldCanvas.width = fieldCanvas.height = G;
    const bg = base.getContext("2d")!, fg = fieldCanvas.getContext("2d")!, img = fg.createImageData(G, G), px = img.data;
    let baseKey = "";

    return (g, time, _dt, p) => {
      const tp = physAt(time + t0), tau = tp - Math.floor(tp);
      const key = p.bad + p.brand2 + p.warn + p.card + p.text;
      if (key !== baseKey) {
        baseKey = key;
        bg.setTransform(S * dpr, 0, 0, S * dpr, pad.side * S * dpr, pad.top * S * dpr); bg.clearRect(-pad.side, -pad.top, 1 + 2 * pad.side, 1 + pad.top + pad.bottom);
        drawBase(bg, shapes, cables, twigs, p, S * dpr * 0.045);
      }
      // ---- 心臓 ----
      // 収縮は電気より遅れる。心室が縮むと心基部（房室の境目）が心尖の方へ下がる
      const atrialSq = bump(tau, 0.09, 0.2), ventSq = smooth(ramp(tau, 0.21, 0.3)) * (1 - smooth(ramp(tau, 0.44, 0.56)));
      const sx = 1 - 0.008 * atrialSq - 0.03 * ventSq, sy = 1 - 0.01 * atrialSq - 0.05 * ventSq, pivot: Pt = [0.6, 0.96];
      const toScreen = ([u, v]: Pt): Pt => [ox + S * (pivot[0] + (u - pivot[0]) * sx), oy + S * (pivot[1] + (v - pivot[1]) * sy)];
      g.save();
      g.translate(ox + S * pivot[0], oy + S * pivot[1]); g.scale(sx, sy); g.translate(-(ox + S * pivot[0]), -(oy + S * pivot[1]));
      g.drawImage(base, ox - pad.side * S, oy - pad.top * S, S * (1 + 2 * pad.side), S * (1 + pad.top + pad.bottom));
      g.translate(ox, oy); g.scale(S, S);
      // 動脈の拍動：心室が血を送り出す間、大動脈と肺動脈が明るくなる
      const eject = bump(tau, 0.24, 0.46);
      // 心筋の興奮：波面は明るい黄色の帯、興奮中はこはく色、さめると元の色に戻る
      const [wr, wg, wb] = rgbOf(p.warn), { act, rep, cells } = field;
      for (let k = 0; k < cells.length; k++) {
        const i = cells[k], d = tau - act[i], o = i * 4;
        if (d < -0.012 || tau > rep[i] + 0.03) { px[o + 3] = 0; continue; }
        const front = Math.exp(-((d / 0.0045) ** 2)), on = smooth(clamp(d / 0.006, 0, 1)) * (1 - smooth(clamp((tau - rep[i] + 0.02) / 0.05, 0, 1)));
        const af = 0.95 * front, ao = 0.5 * on, a = af + ao * (1 - af);
        if (a < 0.004) { px[o + 3] = 0; continue; }
        px[o] = (255 * af + wr * ao * (1 - af)) / a; px[o + 1] = (232 * af + wg * ao * (1 - af)) / a; px[o + 2] = (120 * af + wb * ao * (1 - af)) / a; px[o + 3] = a * 255;
      }
      fg.putImageData(img, 0, 0);
      g.save(); g.clip(shapes.myo, "evenodd"); g.imageSmoothingEnabled = true; g.drawImage(fieldCanvas, 0, 0, 1, 1); g.restore();
      drawValve(g, TRICUSPID, smooth(ramp(tau, 0.2, 0.24)) * (1 - smooth(ramp(tau, 0.5, 0.56))), [[0.27, 0.73], [0.42, 0.7]], p);
      drawValve(g, MITRAL, smooth(ramp(tau, 0.2, 0.24)) * (1 - smooth(ramp(tau, 0.5, 0.56))), [[0.63, 0.72], [0.74, 0.7]], p);
      // 伝導系：通ったところは明るく、先端は光の粒。通り終えたら少しずつ下地に戻る
      g.lineCap = "round"; g.lineJoin = "round";
      for (const c of cables) {
        const f = ramp(tau, c.start, c.end), lit = 1 - ramp(tau, c.end + 0.02, c.end + 0.1);
        if (f <= 0 || lit <= 0) continue;
        g.strokeStyle = rgba(p.warn, 0.3 * lit); g.lineWidth = c.width * 3.2; partial(g, c.pts, c.cum, f); g.stroke();
        g.strokeStyle = `rgba(255,236,150,${lit})`; g.lineWidth = c.width; const tip = partial(g, c.pts, c.cum, f); g.stroke();
        if (f < 1) { glow(g, tip[0], tip[1], 0.05, "#ffe680", 0.9); g.fillStyle = "#fffbe8"; g.beginPath(); g.arc(tip[0], tip[1], 0.008, 0, Math.PI * 2); g.fill(); }
      }
      g.lineWidth = 0.004;
      for (const w of twigs) {
        const f = ramp(tau, w.start, w.end), lit = 1 - ramp(tau, w.end + 0.03, w.end + 0.1);
        if (f <= 0 || lit <= 0) continue;
        g.strokeStyle = `rgba(255,236,150,${0.9 * lit})`; g.beginPath(); g.moveTo(w.pts[0][0], w.pts[0][1]);
        const k = f * 2;
        if (k <= 1) g.lineTo(w.pts[0][0] + (w.pts[1][0] - w.pts[0][0]) * k, w.pts[0][1] + (w.pts[1][1] - w.pts[0][1]) * k);
        else { g.lineTo(w.pts[1][0], w.pts[1][1]); g.lineTo(w.pts[1][0] + (w.pts[2][0] - w.pts[1][0]) * (k - 1), w.pts[1][1] + (w.pts[2][1] - w.pts[1][1]) * (k - 1)); }
        g.stroke();
      }
      // 結節：洞結節は拍の初めに、房室結節は興奮を待たせている間ゆっくり脈打つ
      const saOn = 1 - ramp(tau, 0.02, 0.1), avOn = ramp(tau, 0.04, 0.05) * (1 - ramp(tau, 0.13, 0.17)) * (0.75 + 0.25 * Math.sin(tau * 160));
      if (saOn > 0) glow(g, SA[0], SA[1], 0.075, "#ffe680", 0.85 * saOn);
      if (avOn > 0) glow(g, AVN[0], AVN[1], 0.06, "#ffe680", 0.85 * avOn);
      g.fillStyle = `rgba(255,240,170,${0.5 + 0.5 * Math.max(saOn, 0)})`; g.beginPath(); g.ellipse(SA[0], SA[1], 0.03, 0.012, -0.25, 0, Math.PI * 2); g.fill();
      g.fillStyle = `rgba(255,240,170,${0.5 + 0.5 * Math.max(avOn, 0)})`; g.beginPath(); g.ellipse(AVN[0], AVN[1], 0.022, 0.011, 0.2, 0, Math.PI * 2); g.fill();
      g.restore();
      // 動脈の拍動（拡大縮小の外で、血管の付け根あたりをほのかに明るく）
      if (eject > 0) { const [ax, ay] = toScreen([0.5, 0.2]); glow(g, ax, ay, S * 0.16, p.bad, 0.18 * eject); }
      // 名札
      g.font = font(fs - 1, 700); g.textAlign = "center"; g.textBaseline = "middle";
      for (const tag of TAGS) {
        const a = ramp(tau, tag.from, tag.from + 0.008) * (1 - ramp(tau, tag.to - 0.012, tag.to));
        if (a <= 0) continue;
        const lines = tag.text.split("\n"), lh = fs + 1, [bx, by] = toScreen(tag.box);
        const tw = Math.max(...lines.map((l) => g.measureText(l).width)) + 14, th = lines.length * lh + 7;
        g.globalAlpha = a;
        g.strokeStyle = rgba(p.warn, 0.9); g.lineWidth = 1;
        for (const at of tag.at) { const [x, y] = toScreen(at); g.beginPath(); g.moveTo(bx, by); g.lineTo(x, y); g.stroke(); g.fillStyle = rgba(p.warn, 1); g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill(); }
        roundRect(g, bx - tw / 2, by - th / 2, tw, th, Math.min(th / 2, 11));
        g.fillStyle = rgba(p.card, 0.94); g.fill(); g.strokeStyle = rgba(p.warn, 0.9); g.stroke();
        g.fillStyle = p.text; lines.forEach((l, i) => g.fillText(l, bx, by + 0.5 + (i - (lines.length - 1) / 2) * lh));
        g.globalAlpha = 1;
      }
      g.textBaseline = "alphabetic";

      // ---- 心電図モニター ----
      roundRect(g, colX, my, colW, mh, 12); g.fillStyle = MONITOR.bg; g.fill(); g.strokeStyle = MONITOR.line; g.lineWidth = 1; g.stroke();
      const beat = bump(tau, 0.19, 0.32);
      g.font = font(fs - 1, 800); g.textAlign = "left"; g.fillStyle = `rgba(255,93,108,${0.35 + 0.65 * beat})`; g.fillText("♥", colX + 10, my + 17);
      g.fillStyle = MONITOR.trace; g.fillText("II", colX + 10 + g.measureText("♥ ").width, my + 17);
      g.font = font(fs - 2, 700); g.textAlign = "right"; g.fillStyle = MONITOR.amber; g.fillText("スロー再生", colX + colW - 10, my + 17);
      g.save(); roundRect(g, plotX, plotY, plotW, plotH, 4); g.clip();
      // 方眼：細い線は0.04秒、太い線は0.2秒ごと
      const small = 0.04 * perSec;
      for (const [every, a] of [[1, 0.05], [5, 0.13]] as const) {
        g.strokeStyle = `rgba(${MONITOR.grid},${a})`; g.lineWidth = 1; g.beginPath();
        for (let k = 0; plotX + k * small * every <= plotX + plotW; k++) { const x = Math.round(plotX + k * small * every) + 0.5; g.moveTo(x, plotY); g.lineTo(x, plotY + plotH); }
        for (let k = -20; k <= 20; k++) { const y = Math.round(mid + k * small * every) + 0.5; if (y >= plotY && y <= plotY + plotH) { g.moveTo(plotX, y); g.lineTo(plotX + plotW, y); } }
        g.stroke();
      }
      // いま描いている波の区間をこはく色で塗る
      const beatNo = Math.floor(tp);
      for (const wave of WAVES) {
        if (tau < wave.from || tau > wave.to + 0.02) continue;
        const a = 1 - ramp(tau, wave.to, wave.to + 0.02), x1 = xAt(beatNo + wave.from), x2 = xAt(beatNo + Math.min(tau, wave.to));
        if (x2 > x1) { g.fillStyle = `rgba(255,207,90,${0.16 * a})`; g.fillRect(x1, plotY, x2 - x1, plotH); }
      }
      // 波形：古い所ほど少し暗く。光のにじみ（太い線）＋芯（細い線）
      g.lineJoin = "round"; g.lineCap = "round";
      const first = Math.ceil((tp - span) * SAMPLES), last = Math.floor(tp * SAMPLES);
      for (let k = first; k < last; k += 24) {
        const end = Math.min(last, k + 24), age = (tp - k / SAMPLES) / span, a = 0.35 + 0.65 * (1 - age);
        g.beginPath();
        let prevX = Infinity;
        for (let j = k; j <= end; j++) {
          const sec = j / SAMPLES, x = xAt(sec), y = mid - amp * ecgAt(sec - Math.floor(sec));
          if (x < prevX) g.moveTo(x, y); else g.lineTo(x, y);
          prevX = x;
        }
        g.strokeStyle = `rgba(62,240,143,${0.22 * a})`; g.lineWidth = 4; g.stroke();
        g.strokeStyle = `rgba(62,240,143,${a})`; g.lineWidth = 1.6; g.stroke();
      }
      const hx = xAt(tp), hy = mid - amp * ecgAt(tau);
      glow(g, hx, hy, 12, MONITOR.trace, 0.7); g.fillStyle = "#eafff3"; g.beginPath(); g.arc(hx, hy, 2.2, 0, Math.PI * 2); g.fill();
      // 波の名前：描いている間は光り、P・QRS・T はそのあとも淡く残す
      g.textAlign = "center";
      for (let n = beatNo - 1; n <= beatNo; n++) {
        for (const wave of WAVES) {
          const at = (wave.from + wave.to) / 2, age = tp - (n + wave.from);
          if (age < 0 || tp - (n + at) > span - 0.05) continue;
          const live = n === beatNo && tau <= wave.to + 0.02 ? 1 - ramp(tau, wave.to, wave.to + 0.04) : 0;
          const a = Math.max(live, wave.keep ? 0.45 : 0);
          if (a <= 0) continue;
          const x = xAt(n + (wave.name === "QRS" ? 0.19 : at)), y = wave.keep ? mid - amp * wave.y - 7 : mid + fs + 4;
          if (x < plotX + 8 || x > plotX + plotW - 8) continue;   // 端で切れる名前は出さない
          g.font = font(wave.keep ? fs - 1 : fs - 3, 800);
          g.fillStyle = live > 0.5 ? `rgba(255,207,90,${a})` : `rgba(207,233,220,${a})`;
          g.fillText(wave.name, x, y);
        }
      }
      g.restore();
      // ---- いまの出来事 ----
      const now = BOUNDS.findIndex((b, i) => tau >= b && tau < BOUNDS[i + 1]);
      const dotY = my + mh + fs * 1.1;
      for (let i = 0; i < EVENTS.length; i++) {
        g.fillStyle = i === now ? p.warn : rgba(p.muted, 0.4);
        g.beginPath(); g.arc(colX + 4 + i * 11, dotY, i === now ? 3.4 : 2.6, 0, Math.PI * 2); g.fill();
      }
      const fadeIn = ramp(tau, BOUNDS[now], BOUNDS[now] + Math.min(0.012, (BOUNDS[now + 1] - BOUNDS[now]) * 0.3));
      g.font = font(fs, 700); g.textAlign = "left"; g.fillStyle = rgba(p.text, 0.88 * Math.max(0.25, fadeIn));
      EVENTS[now].split("\n").flatMap((part) => wrap(g, part, colW)).slice(0, 3).forEach((line, i) => g.fillText(line, colX, dotY + fs * 1.55 + i * fs * 1.35));
    };
  },
};
