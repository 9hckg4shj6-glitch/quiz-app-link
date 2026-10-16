// スタート画面のモデル「ATP合成酵素（化学浸透）」：ミトコンドリア内膜を横に置き、上がマトリックス、下が膜間腔。
// 左の電子伝達系が電子を受けわたしながら H⁺ を膜間腔へくみ出す → H⁺ は濃度差で ATP合成酵素の a サブユニットの
// 半チャネルから入り、cリング（c サブユニット8個）に乗って1周し、反対の半チャネルからマトリックスへ抜ける。
// H⁺ 1個ごとに回転子（cリング＋γ軸）が 1/8 回転。頭部（α3β3）は b の柄で固定され、γ の向きに合わせて
// β が「空（O）→ ADP＋Pi をゆるく持つ（L）→ 固く持って ATP にする（T）」と形を変え、120° ごとに ATP を1個放す（1回転で3個）。
// 右上の計器に、通った H⁺・回転数・できた ATP を数える。動きを減らす設定では ATP を放した直後の1枚を描く。
import { PANEL, cachedLayer, clamp, drawPanel, drawSteps, drawTag, font, glow, ramp, rgba, roundRect, smooth, type Palette, type Pt, type StartModel } from "./common";

const STEP = 0.42, MOVE = 0.24;   // H⁺ 1個ぶんの周期と、そのうち回っている時間
const STILL_AT = 2.22;
const CAPTION_SEC = 3.2;
const STEPS = [
  "電子伝達系がH⁺を\n膜間腔へくみ出す",
  "H⁺が濃度差で\naサブユニットから戻る",
  "H⁺1個ごとに回転子が\n1/8回転する",
  "軸の向きでβが形を変え\nADP＋PiからATPを作る",
];
const hash = (n: number): number => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };

function proton(g: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, p: Palette): void {
  if (a <= 0.02) return;
  g.fillStyle = rgba(p.warn, 0.85 * a); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = `rgba(255,255,255,${0.9 * a})`; g.lineWidth = Math.max(1, r * 0.32);
  g.beginPath(); g.moveTo(x - r * 0.5, y); g.lineTo(x + r * 0.5, y); g.moveTo(x, y - r * 0.5); g.lineTo(x, y + r * 0.5); g.stroke();
}

// 立体的な楕円体（左上から光が当たる）
function blob(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string, alpha: number, p: Palette): void {
  const grad = g.createRadialGradient(x - rx * 0.35, y - ry * 0.4, Math.min(rx, ry) * 0.1, x, y, Math.max(rx, ry));
  grad.addColorStop(0, rgba(color, 0.25 * alpha)); grad.addColorStop(1, rgba(color, 0.7 * alpha));
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fillStyle = rgba(p.card, alpha); g.fill(); g.fillStyle = grad; g.fill();
  g.strokeStyle = rgba(color, 0.85 * alpha); g.lineWidth = 1; g.stroke();
}

export const atpSynthase: StartModel = {
  id: "atp",
  label: "ATP合成酵素",
  note: "いま動いているのは<b>ATP合成酵素</b>。電子伝達系がくみ出したH⁺が濃度差で戻るたびに、膜の中の回転子（cリング）と軸が回り、上の頭部（F₁）のβが形を変えてADP＋PiからATPを作ります。1回転でATPは3個です。",
  create(w, h, still) {
    const fs = clamp(h * 0.035, 11, 13), k = h / 230;
    const yTop = h * 0.58, yBot = h * 0.72, cx = w * 0.5, rc = h * 0.13, chX = cx + rc + 9;
    const yH = h * 0.3, hx = h * 0.19, hy = h * 0.15, etcX = w * 0.14, etcW = Math.min(w * 0.11, 52 * k);
    const pr = 3.2 * k;
    const pool = Array.from({ length: 22 }, (_, i) => ({ x: hash(i) * w, y: yBot + 8 + hash(i + 50) * (h - yBot - 18), s: hash(i + 99) * 10 }));
    const few = Array.from({ length: 5 }, (_, i) => ({ x: w * (0.3 + 0.12 * i), y: yTop - 16 - hash(i + 7) * h * 0.12, s: i * 2 }));
    const t0 = still ? STILL_AT : 0;

    const base = cachedLayer(w, h, (g, p) => {
      g.fillStyle = rgba(p.brand2, 0.03); g.fillRect(0, 0, w, yTop);
      const ims = g.createLinearGradient(0, yBot, 0, h); ims.addColorStop(0, rgba(p.warn, 0.1)); ims.addColorStop(1, rgba(p.warn, 0.04));
      g.fillStyle = ims; g.fillRect(0, yBot, w, h - yBot);
      // 脂質二重膜：頭（丸）と2本の尾。タンパク質のところは空ける
      const step = 6.4 * k, headR = 2.5 * k, midY = (yTop + yBot) / 2;
      for (let x = 3; x < w; x += step) {
        if (Math.abs(x - etcX) < etcW * 0.62 || (x > cx - rc - 5 && x < chX + 12)) continue;
        g.strokeStyle = rgba(p.muted, 0.3); g.lineWidth = 0.8;
        for (const [y0, y1] of [[yTop + headR * 2, midY - 1.5], [yBot - headR * 2, midY + 1.5]]) {
          for (const dx of [-1.2, 1.2]) { g.beginPath(); g.moveTo(x + dx, y0); g.quadraticCurveTo(x + dx + 1.2, (y0 + y1) / 2, x + dx, y1); g.stroke(); }
        }
        for (const y of [yTop + headR, yBot - headR]) {
          const hg = g.createRadialGradient(x - headR * 0.3, y - headR * 0.3, 0.2, x, y, headR);
          hg.addColorStop(0, rgba(p.warn, 0.3)); hg.addColorStop(1, rgba(p.warn, 0.6));
          g.fillStyle = hg; g.beginPath(); g.arc(x, y, headR, 0, Math.PI * 2); g.fill();
        }
      }
      // 電子伝達系の複合体
      const etc = new Path2D();
      roundRect(etc, etcX - etcW / 2, yTop - h * 0.07, etcW, yBot - yTop + h * 0.13, etcW * 0.38);
      g.save(); g.shadowColor = "rgba(10,20,40,0.18)"; g.shadowBlur = 8 * k; g.fillStyle = p.card; g.fill(etc); g.restore();
      const eg = g.createLinearGradient(etcX - etcW / 2, 0, etcX + etcW / 2, 0);
      eg.addColorStop(0, rgba(p.muted, 0.3)); eg.addColorStop(0.4, rgba(p.muted, 0.14)); eg.addColorStop(1, rgba(p.muted, 0.36));
      g.fillStyle = eg; g.fill(etc); g.strokeStyle = rgba(p.muted, 0.7); g.lineWidth = 1; g.stroke(etc);
      g.font = font(fs - 3, 700); g.fillStyle = rgba(p.text, 0.65); g.textAlign = "center"; g.fillText("電子", etcX, midY - 2); g.fillText("伝達系", etcX, midY + fs - 3);
      g.textAlign = "left"; g.fillStyle = rgba(p.muted, 0.95);
      g.fillText("マトリックス（H⁺が少ない）", 12, yTop - h * 0.1 - 4); g.fillText("膜間腔（H⁺が多い）", 12, h - 8);
    });

    return (g, time, _dt, p) => {
      const t = time + t0, n = Math.floor(t / STEP), turn = n + smooth(clamp((t - n * STEP) / MOVE, 0, 1));
      const theta = (turn * Math.PI * 2) / 8, third = Math.floor(turn / (8 / 3)), capIdx = Math.floor(t / CAPTION_SEC) % STEPS.length;
      base(g, p);
      // 漂う H⁺（膜間腔に多く、マトリックスに少ない）
      for (const q of pool) proton(g, q.x + Math.sin(t * 0.6 + q.s) * 8, q.y + Math.cos(t * 0.5 + q.s) * 4, pr, 0.55, p);
      for (const q of few) proton(g, q.x + Math.sin(t * 0.5 + q.s) * 6, q.y + Math.cos(t * 0.4 + q.s) * 3, pr, 0.4, p);
      // 電子伝達系：電子（青）が受けわたされ、そのたびに H⁺ を下へくみ出す
      for (let i = 0; i < 3; i++) {
        const q = (t * 0.7 + i / 3) % 1, x = etcX - etcW * 0.6 + etcW * 1.2 * q, y = yTop - h * 0.04 + Math.sin(q * Math.PI * 3) * 3;
        glow(g, x, y, 5 * k, p.brand2, 0.6); g.fillStyle = p.brand2; g.beginPath(); g.arc(x, y, 1.8 * k, 0, Math.PI * 2); g.fill();
      }
      for (let j = Math.floor(t / 0.6) - 3; j <= Math.floor(t / 0.6); j++) {
        const q = (t - j * 0.6) / 1.8;
        if (q < 0 || q > 1) continue;
        const sx = etcX + (hash(j) - 0.5) * etcW, ex = etcX + (hash(j + 3) - 0.5) * etcW * 2.4;
        const y = yTop - h * 0.1 + (yBot + h * 0.1 - (yTop - h * 0.1)) * q, x = q < 0.3 ? sx : q > 0.7 ? etcX + (ex - etcX) * ((q - 0.7) / 0.3) : etcX;
        proton(g, x, y, pr, Math.min(1, q * 6) * (1 - ramp(q, 0.85, 1)), p);
      }
      // 固定子：a サブユニット（2つの半チャネル）と b の柄
      const aX = cx + rc + 2, aW = 16 * k;
      roundRect(g, aX, yTop - 6, aW, yBot - yTop + 12, 5); g.fillStyle = p.card; g.fill();
      g.fillStyle = rgba(p.brand2, 0.32); g.fill(); g.strokeStyle = rgba(p.brand2, 0.7); g.lineWidth = 1; g.stroke();
      g.strokeStyle = rgba(p.warn, 0.4); g.setLineDash([2, 2]); g.beginPath(); g.moveTo(chX - 2, yBot + 6); g.lineTo(chX - 2, (yTop + yBot) / 2 + 3); g.moveTo(chX + 2, (yTop + yBot) / 2 - 3); g.lineTo(chX + 2, yTop - 6); g.stroke(); g.setLineDash([]);
      g.strokeStyle = rgba(p.brand2, 0.55); g.lineWidth = 2.4 * k; g.lineCap = "round"; g.lineJoin = "round";
      for (const off of [-2, 2]) {
        g.beginPath(); g.moveTo(chX + off, yTop - 6); g.lineTo(cx + hx + 8 + off, yH + hy * 0.4); g.lineTo(cx + hx + 8 + off, yH - hy * 0.5);
        g.quadraticCurveTo(cx + hx + 8 + off, yH - hy - 7, cx + hx * 0.25, yH - hy - 6 + off * 0.5); g.stroke();
      }
      blob(g, cx + hx * 0.18, yH - hy - 6, hx * 0.3, hy * 0.2, p.brand2, 1, p);   // δ（頭部を押さえる）
      // 頭部（α3β3）の奥側
      const subs = [0, 1, 2, 3, 4, 5].map((j) => { const a = (j * Math.PI) / 3 - Math.PI / 3; return { j, x: cx + hx * 0.66 * Math.sin(a), depth: Math.cos(a), beta: j % 2 === 1 }; });
      const drawSub = (s: { j: number; x: number; depth: number; beta: boolean }, alpha: number): void => {
        const state = s.beta ? (third + (s.j - 1) / 2) % 3 : -1;   // 0＝空、1＝ADP＋Pi、2＝ATP（固く持つ）
        const squeeze = state === 2 ? 0.88 : state === 0 ? 1.05 : 1;
        blob(g, s.x, yH, hx * 0.32 * squeeze * (0.75 + 0.25 * Math.max(0, s.depth)), hy * 0.95 * squeeze, s.beta ? p.brand : p.brand2, alpha, p);
        if (s.beta && s.depth > 0.2) {
          const my = yH + hy * 0.15;
          if (state === 1) { g.fillStyle = rgba(p.good, 0.85 * alpha); g.beginPath(); g.arc(s.x - 3 * k, my, 3 * k, 0, Math.PI * 2); g.fill(); g.fillStyle = rgba(p.warn, 0.9 * alpha); g.beginPath(); g.arc(s.x + 3.5 * k, my - 2, 1.8 * k, 0, Math.PI * 2); g.fill(); }
          if (state === 2) { glow(g, s.x, my, 9 * k, p.good, 0.6 * alpha); g.fillStyle = rgba(p.good, alpha); g.beginPath(); g.arc(s.x, my, 3.4 * k, 0, Math.PI * 2); g.fill(); }
        }
      };
      subs.filter((s) => s.depth < 0).sort((a, b) => a.depth - b.depth).forEach((s) => drawSub(s, 0.75));
      // 回転子：γ 軸（曲がっているので回ると先端が振れる）・ε・cリング
      const e = hx * 0.2 * Math.sin(theta), front = Math.cos(theta) > 0;
      g.strokeStyle = rgba(p.bad, front ? 0.85 : 0.6); g.lineWidth = rc * 0.3; g.lineCap = "round";
      g.beginPath(); g.moveTo(cx, yTop - 4); g.quadraticCurveTo(cx + e * 0.2, (yTop + yH) / 2, cx + e, yH - hy * 0.2); g.stroke();
      blob(g, cx, yTop - 6, rc * 0.55, 5 * k, p.bad, 1, p);
      // cリング：上下のふた（楕円）と、手前ほど濃い c サブユニット。H⁺ を乗せたものは黄色の点
      const capRy = rc * 0.22;
      g.fillStyle = p.card; g.fillRect(cx - rc, yTop - 3, rc * 2, yBot - yTop + 6);
      g.fillStyle = rgba(p.bad, 0.12); g.fillRect(cx - rc, yTop - 3, rc * 2, yBot - yTop + 6);
      g.beginPath(); g.ellipse(cx, yBot + 3, rc, capRy, 0, 0, Math.PI); g.fillStyle = rgba(p.bad, 0.3); g.fill();
      const cs = Array.from({ length: 8 }, (_, i) => theta + (i * Math.PI) / 4).map((a) => ({ a, depth: Math.cos(a) })).sort((x, y) => x.depth - y.depth);
      for (const { a, depth } of cs) {
        if (depth < -0.2) continue;
        const x = cx + rc * Math.sin(a), wd = ((Math.PI * 2 * rc) / 8) * Math.max(0.15, depth) * 0.85;
        const cg = g.createLinearGradient(x - wd / 2, 0, x + wd / 2, 0);
        cg.addColorStop(0, rgba(p.bad, 0.35 + 0.3 * depth)); cg.addColorStop(0.5, rgba(p.bad, 0.2 + 0.25 * depth)); cg.addColorStop(1, rgba(p.bad, 0.45 + 0.3 * depth));
        roundRect(g, x - wd / 2, yTop - 2, wd, yBot - yTop + 4, wd / 2); g.fillStyle = cg; g.fill();
        const toStator = Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)));
        if (depth > 0.1 && toStator > 0.45) proton(g, x, (yTop + yBot) / 2, pr * 0.8, depth, p);
      }
      g.beginPath(); g.ellipse(cx, yTop - 3, rc, capRy, 0, 0, Math.PI * 2); g.fillStyle = p.card; g.fill(); g.fillStyle = rgba(p.bad, 0.4); g.fill(); g.strokeStyle = rgba(p.bad, 0.7); g.stroke();
      // 頭部の手前側（半透明にして、中で回る γ が見えるようにする）
      subs.filter((s) => s.depth >= 0).sort((a, b) => a.depth - b.depth).forEach((s) => drawSub(s, s.depth > 0.9 ? 0.62 : 0.85));
      // H⁺ の通り道：膜間腔から a サブユニットの下の半チャネルへ入り、上の半チャネルからマトリックスへ抜ける
      for (let j = n - 3; j <= n + 3; j++) {
        const due = j * STEP, before = (due - t) / 1.3, after = (t - due - 0.1) / 1.3;
        if (before > 0 && before < 1) {
          const sx = chX + (hash(j) - 0.5) * w * 0.5, sy = yBot + (h - yBot) * (0.4 + 0.45 * hash(j + 7)), q = 1 - before;
          proton(g, sx + (chX - 2 - sx) * q * q, sy + (yBot + 4 - sy) * q * q, pr, 0.5 + 0.5 * q, p);
        } else if (after > 0 && after < 1) {
          proton(g, chX + 2 + after * (22 + 26 * hash(j + 3)) * k, yTop - 6 - after * (24 + 18 * hash(j + 5)) * k, pr, 1 - after, p);
        }
      }
      // ADP＋Pi が開いた β へ入り、できた ATP が出ていく（120° ごと）
      let made = 0;
      for (let q = third - 2; q <= third; q++) {
        if (q < 1) continue;
        const at = Math.floor((8 * q) / 3) * STEP + ((8 * q) / 3 - Math.floor((8 * q) / 3)) * MOVE, age = t - at;
        if (age < 0 || age > 1.8) continue;
        const side = q % 2 ? 1 : -1, x = cx + side * (hx * 0.55 + age * 10 * k), y = yH - hy * 0.5 - age * 10 * k, a = Math.min(1, age / 0.15) * (1 - age / 1.8);
        glow(g, x, y - 3, 15 * k, p.good, 0.35 * a);
        g.font = font(fs - 1, 800); g.textAlign = "center"; g.fillStyle = rgba(p.good, a); g.fillText("ATP", x, y);
        made = Math.max(made, 1 - age / 0.6);
      }
      const inPhase = (t % (STEP * 8 / 3)) / (STEP * 8 / 3);
      if (inPhase > 0.15 && inPhase < 0.65) {
        const q = smooth(ramp(inPhase, 0.15, 0.6)), sx = cx - hx * 1.4, sy = yH + hy * 0.6;
        g.fillStyle = rgba(p.good, 0.8 * (1 - q * 0.3)); g.beginPath(); g.arc(sx + (cx - sx) * q, sy + (yH + hy * 0.15 - sy) * q, 2.8 * k, 0, Math.PI * 2); g.fill();
        g.fillStyle = rgba(p.warn, 0.85); g.beginPath(); g.arc(sx + 7 * k + (cx + 3 - sx - 7 * k) * q, sy + 4 + (yH + hy * 0.1 - sy - 4) * q, 1.8 * k, 0, Math.PI * 2); g.fill();
      }
      // 計器：通った H⁺・回転・ATP
      const pw = Math.min(150, w * 0.3), ph = fs * 5.4, px = w - pw - 10, py = 8;
      drawPanel(g, px, py, pw, ph);
      const rows: [string, string, string][] = [["H⁺", String(n), PANEL.amber], ["回転", (turn / 8).toFixed(2), PANEL.ink], ["ATP", String(third), PANEL.green]];
      rows.forEach(([label, value, color], i) => {
        const y = py + fs * 1.35 + i * fs * 1.25;
        g.font = font(fs - 2, 700); g.textAlign = "left"; g.fillStyle = PANEL.ink; g.fillText(label, px + 10, y);
        g.font = font(fs, 800); g.textAlign = "right"; g.fillStyle = color; g.fillText(value, px + pw - 10, y);
      });
      if (made > 0) glow(g, px + pw - 22, py + fs * 3.6, 16, PANEL.green, 0.4 * made);
      g.font = font(fs - 3, 700); g.textAlign = "left"; g.fillStyle = PANEL.amber; g.fillText("H⁺8個→1回転→ATP3個", px + 10, py + ph - 7);
      // 名札と説明（4つを順に）
      const capLocal = t % CAPTION_SEC, tagA = ramp(capLocal, 0.25, 0.5) * (1 - ramp(capLocal, CAPTION_SEC - 0.4, CAPTION_SEC - 0.1));
      const tags: [string, Pt, Pt][] = [
        ["電子伝達系", [Math.max(64, etcX + etcW * 0.4), yTop - h * 0.2], [etcX, yTop - h * 0.06]],
        ["aサブユニット（H⁺の通り道）", [Math.min(w - 92, cx + rc + w * 0.2), yBot + (h - yBot) * 0.45], [chX, yBot]],
        ["回転子（cリング＋γ）", [Math.max(80, cx - rc - w * 0.16), yBot + (h - yBot) * 0.45], [cx - rc * 0.5, yBot]],
        ["β（ここでATPを作る）", [Math.min(w - 80, cx + hx + w * 0.17), yTop - h * 0.14], [cx + hx * 0.3, yH + hy * 0.3]],
      ];
      const [label, box, at] = tags[capIdx];
      drawTag(g, label, box, [at], tagA, fs, p);
      drawSteps(g, 14, 12, Math.min(w * 0.4, px - 30), STEPS, capIdx, still ? 1 : ramp(capLocal, 0, 0.3), fs, p);
    };
  },
};
