// スタート画面のモデル「サルコメアの収縮（滑り説）」：長さは実物の比で描く（細いフィラメント 1.0 µm・A帯 1.6 µm、
// サルコメア長 2.40 → 2.05 µm）。安静時はトロポミオシンがアクチンの結合部位をふさぐ → 筋小胞体から Ca²⁺ が出て
// トロポニンに結合し、トロポミオシンがずれる → ミオシン頭部がアクチンをつかんで首を振り（パワーストローク）、離れて戻る、を
// くり返してたぐり寄せる → Ca²⁺ が筋小胞体へ回収されると元の長さに戻る。Z線からはタイチン（ばね）がのびる。
// 右上の計器にサルコメア長・I帯・H帯の長さを出し、縮んでも A帯が変わらないことを見せる。動きを減らす設定では縮む途中の1枚。
import { PANEL, clamp, drawPanel, drawSteps, drawTag, font, glow, ramp, rgba, roundRect, smooth, stepOf, timeWarp, type Pt, type StartModel } from "./common";

const SL_REST = 2.4, SL_SHORT = 2.05, ACTIN = 1.0, A_BAND = 1.6, BARE = 0.08;   // µm
const BOUNDS = [0, 0.14, 0.28, 0.6, 0.74, 1];
const SHOW_SEC = [1.5, 1.6, 2.6, 1.6, 2.4];
const STILL_U = 0.45;
const STEPS = [
  "安静：トロポミオシンが\nアクチンの結合部位をふさぐ",
  "筋小胞体からCa²⁺が出て\nトロポニンに結合する",
  "ミオシン頭部がアクチンをつかみ\n首を振ってたぐり寄せる",
  "I帯とH帯は短くなり\nA帯の長さは変わらない",
  "Ca²⁺が筋小胞体へ回収され\n元の長さに戻る",
];
const hash = (n: number): number => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };

export const sarcomere: StartModel = {
  id: "sarcomere",
  label: "筋の収縮",
  note: "いま動いているのは<b>サルコメア</b>。Ca²⁺がトロポニンに結合すると、ミオシン頭部がアクチンをつかんで首を振り、細いフィラメントを中央へたぐり寄せます。縮むとI帯とH帯は短くなり、A帯（ミオシンの長さ）は変わりません。",
  create(w, h, still) {
    const fs = clamp(h * 0.035, 11, 13), um = (w * 0.84) / SL_REST, cx = w / 2, cy = h * 0.555, gap = h * 0.052;
    const thinRows = [-3, -1, 1, 3].map((k) => cy + k * gap), thickRows = [-2, 0, 2].map((k) => cy + k * gap);
    const bead = Math.max(3, um * 0.026), pitch = bead * 8, helix = gap * 0.17, head = gap * 0.85;
    const srTop = h - Math.max(22, h * 0.09), srH = Math.max(12, h * 0.045);
    const warp = timeWarp(BOUNDS, SHOW_SEC), t0 = still ? warp.timeOf(STILL_U) : 0;
    const ions = Array.from({ length: 18 }, (_, i) => ({ x: w * (0.08 + 0.84 * hash(i + 1)), row: i % 4, slot: Math.floor(hash(i + 9) * 6), side: i % 2 ? 1 : -1 }));

    return (g, time, _dt, p) => {
      const t = time + t0, cyc = warp.at(t), u = cyc - Math.floor(cyc), now = stepOf(BOUNDS, u);
      const c = u < 0.28 ? 0 : u < 0.74 ? smooth(ramp(u, 0.28, 0.6)) : 1 - smooth(ramp(u, 0.76, 0.98));
      const ca = ramp(u, 0.14, 0.26) * (1 - ramp(u, 0.74, 0.86)), cycling = u > 0.28 && u < 0.74 ? (u < 0.6 ? 1 : 0.5) : 0;
      const sl = SL_REST - (SL_REST - SL_SHORT) * c, L = sl * um, A = A_BAND * um, act = ACTIN * um;
      const zs = [-2, -1, 0, 1].map((k) => cx + (k + 0.5) * L), ms = [-1, 0, 1].map((k) => cx + k * L);
      // 筋小胞体（下の管）
      const sr = g.createLinearGradient(0, srTop, 0, srTop + srH);
      sr.addColorStop(0, rgba(p.brand2, 0.22)); sr.addColorStop(1, rgba(p.brand2, 0.1));
      g.fillStyle = sr; g.strokeStyle = rgba(p.brand2, 0.45); g.lineWidth = 1;
      roundRect(g, -10, srTop, w + 20, srH, srH / 2); g.fill(); g.stroke();
      g.font = font(fs - 2, 700); g.textAlign = "right"; g.fillStyle = rgba(p.brand2, 0.9); g.fillText("筋小胞体", w - 12, srTop + srH / 2 + 3.5);
      // タイチン：Z線からミオシンの端までのばね（縮むと巻きが詰まる）
      g.strokeStyle = rgba(p.muted, 0.45); g.lineWidth = 0.9;
      for (const m of ms) for (const y of thickRows) for (const side of [-1, 1]) {
        const from = m + side * L / 2, to = m + side * A / 2, n = 7;
        g.beginPath();
        for (let i = 0; i <= 40; i++) { const k = i / 40, x = from + (to - from) * k; g[i ? "lineTo" : "moveTo"](x, y + 3.2 + Math.sin(k * n * Math.PI * 2) * 1.6); }
        g.stroke();
      }
      // 細いフィラメント：2本のアクチンのらせん（手前の玉ほど明るい）、溝のトロポミオシン、ところどころのトロポニン
      const troponin: Pt[] = [];
      for (const z of zs) for (const dir of [-1, 1]) {
        const end = z + dir * act;
        if (Math.max(z, end) < -10 || Math.min(z, end) > w + 10) continue;
        for (const [r, y] of thinRows.entries()) {
          const beads: [number, number, number][] = [];
          for (let s = bead * 0.5; s < act; s += bead) {
            const x = z + dir * s, phi = (s / pitch) * Math.PI * 2 + r;
            beads.push([x, y + Math.sin(phi) * helix, Math.cos(phi)], [x + dir * bead * 0.5, y - Math.sin(phi) * helix, -Math.cos(phi)]);
          }
          beads.sort((a, b) => a[2] - b[2]);
          for (const [x, by, depth] of beads) { g.fillStyle = rgba(p.brand, 0.5 + 0.35 * depth); g.beginPath(); g.arc(x, by, bead * 0.55, 0, Math.PI * 2); g.fill(); }
          const shift = ca * helix * 0.8;
          g.strokeStyle = rgba(p.text, 0.45); g.lineWidth = 1.1; g.beginPath();
          for (let s = 0; s <= act; s += 2) { const x = z + dir * s; g[s ? "lineTo" : "moveTo"](x, y + Math.cos((s / pitch) * Math.PI * 2 + r) * helix * 0.7 - shift); }
          g.stroke();
          for (let s = pitch * 0.5; s < act; s += pitch * 0.5) {
            const x = z + dir * s, ty = y + Math.cos((s / pitch) * Math.PI * 2 + r) * helix * 0.7 - shift;
            troponin.push([x, ty]);
            g.fillStyle = ca > 0.3 ? rgba(p.warn, 0.55 + 0.45 * ca) : rgba(p.muted, 0.7); g.beginPath(); g.arc(x, ty, bead * 0.65, 0, Math.PI * 2); g.fill();
          }
        }
      }
      // 太いフィラメント：ミオシンの軸と頭部。頭部は「つかむ→首を振る→離れて戻る」をくり返す
      let pickedHead: Pt | null = null;
      for (const [mi, m] of ms.entries()) {
        if (m + A / 2 < -10 || m - A / 2 > w + 10) continue;
        for (const [ri, y] of thickRows.entries()) {
          let i = 0;
          for (let s = BARE * um; s <= A / 2 - 2; s += bead * 2.2, i++) {
            for (const side of [-1, 1]) {
              const dirY = (i + (side > 0 ? 1 : 0)) % 2 ? -1 : 1, bx = m + side * s, by = y + dirY * 2.2, rowY = y + dirY * (gap - bead * 0.6);
              const phase = (t * 1.5 + hash(mi * 100 + ri * 30 + i * 2 + (side > 0 ? 1 : 0))) % 1;
              const attached = cycling > 0 && ca > 0.5 && phase < 0.58 * cycling;
              let tx: number, ty: number;
              if (attached) {
                const k = phase / 0.58, ang = (40 + 55 * k) * (Math.PI / 180);   // つかんだまま首を振る：先端が中央（M線）の方へ動く
                tx = bx + side * head * Math.cos(ang); ty = rowY;
                if (!pickedHead && mi === 1 && ri === 2 && side > 0 && i > 3) pickedHead = [tx, ty];
              } else {
                const back = cycling > 0 ? clamp((phase - 0.58) / 0.42, 0, 1) : 1, ang = (95 - 55 * back) * (Math.PI / 180);
                const rest = ca > 0.5 ? 0 : 1;
                tx = bx + side * head * 0.8 * Math.cos(ang * (1 - rest) + rest * 0.95); ty = by + dirY * head * 0.72 * Math.sin(ang * (1 - rest) + rest * 0.95);
              }
              g.strokeStyle = rgba(p.brand2, attached ? 0.95 : 0.6); g.lineWidth = 1.2; g.beginPath(); g.moveTo(bx, by); g.lineTo(tx, ty); g.stroke();
              g.fillStyle = attached ? rgba(p.brand2, 0.95) : rgba(p.brand2, 0.65);
              g.beginPath(); g.ellipse(tx, ty, bead * 0.8, bead * 0.55, Math.atan2(ty - by, tx - bx), 0, Math.PI * 2); g.fill();
              if (attached) glow(g, tx, ty, bead * 1.8, p.warn, 0.35);
            }
          }
          const shaft = g.createLinearGradient(0, y - 3, 0, y + 3);
          shaft.addColorStop(0, rgba(p.brand2, 0.75)); shaft.addColorStop(0.5, rgba(p.brand2, 0.95)); shaft.addColorStop(1, rgba(p.brand2, 0.7));
          g.strokeStyle = shaft; g.lineWidth = 5; g.lineCap = "round"; g.beginPath(); g.moveTo(m - A / 2, y); g.lineTo(m + A / 2, y); g.stroke(); g.lineCap = "butt";
        }
        g.strokeStyle = rgba(p.muted, 0.55); g.lineWidth = 1.2; g.beginPath(); g.moveTo(m, cy - 2.5 * gap); g.lineTo(m, cy + 2.5 * gap); g.stroke();
      }
      // Z線（ジグザグ。α-アクチニンでつながる）
      for (const z of zs) {
        g.strokeStyle = rgba(p.text, 0.08); g.lineWidth = 7; g.beginPath(); g.moveTo(z, cy - 3.6 * gap); g.lineTo(z, cy + 3.6 * gap); g.stroke();
        g.strokeStyle = rgba(p.text, 0.7); g.lineWidth = 2; g.lineJoin = "round"; g.beginPath();
        for (let j = 0; j <= 16; j++) g[j ? "lineTo" : "moveTo"](z + (j % 2 ? 2.6 : -2.6), cy - 3.6 * gap + (j * 7.2 * gap) / 16);
        g.stroke();
      }
      // Ca²⁺：筋小胞体から出てトロポニンへ、終わると戻る
      ions.forEach((ion, i) => {
        const e = smooth(ramp(u, 0.14 + i * 0.004, 0.25 + i * 0.004)) * (1 - smooth(ramp(u, 0.74 + i * 0.005, 0.86 + i * 0.005)));
        if (e <= 0.01) return;
        const target = troponin[(ion.row * 7 + ion.slot * 5 + i * 3) % Math.max(1, troponin.length)] ?? [ion.x, cy];
        const x = ion.x + (target[0] - ion.x) * e, y = srTop + (target[1] - srTop) * e;
        glow(g, x, y, 5, p.warn, 0.6); g.fillStyle = "#fff3c4"; g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fill();
      });
      // 目盛り：上に I帯・A帯・I帯、下に H帯。短くなる帯は縮んでいる間だけ黄色
      const zl = cx - L / 2, zr = cx + L / 2, hz = L / 2 - act, yTop = cy - 4.4 * gap, yBot = cy + 4.1 * gap;
      const shrinking = c > 0.02 && c < 0.98 ? p.warn : rgba(p.muted, 0.95);
      const bracket = (a: number, b: number, y: number, label: string, color: string, below: boolean): void => {
        const tick = below ? -4 : 4;
        g.strokeStyle = color; g.lineWidth = 1.4; g.beginPath(); g.moveTo(a, y + tick); g.lineTo(a, y); g.lineTo(b, y); g.lineTo(b, y + tick); g.stroke();
        g.fillStyle = color; g.fillText(label, (a + b) / 2, below ? y + fs + 2 : y - 5);
      };
      g.font = font(fs - 1, 800); g.textAlign = "center";
      bracket(cx - A / 2, cx + A / 2, yTop, "A帯 1.6 µm（一定）", p.brand2, false);
      bracket(zl + 2, cx - A / 2 - 2, yTop, "I帯", shrinking, false);
      bracket(cx + A / 2 + 2, zr - 2, yTop, "I帯", shrinking, false);
      if (hz > 3) bracket(cx - hz, cx + hz, yBot, "H帯", shrinking, true);
      else { g.fillStyle = shrinking; g.fillText("H帯はほぼ消える", cx, yBot + fs + 2); }
      // 計器：サルコメア長と、I帯・H帯の長さ
      const pw = Math.min(150, w * 0.32), ph = fs * 4.4, px = w - pw - 10, py = 8;
      drawPanel(g, px, py, pw, ph);
      g.textAlign = "left"; g.font = font(fs - 3, 700); g.fillStyle = PANEL.ink; g.fillText("サルコメア長", px + 10, py + fs + 1);
      g.font = font(fs + 4, 800); g.fillStyle = PANEL.green; g.fillText(`${sl.toFixed(2)} µm`, px + 10, py + fs * 2.65);
      g.font = font(fs - 3, 700); g.fillStyle = c > 0.02 && c < 0.98 ? PANEL.amber : PANEL.ink;
      g.fillText(`I帯 ${(sl - A_BAND).toFixed(2)}　H帯 ${Math.max(0, sl - 2 * ACTIN).toFixed(2)} µm`, px + 10, py + ph - 8);
      // 名札
      // 名札は H帯の目盛りの左右に出す（下の段のトロポニン・頭部を指す）
      const tagY = yBot + fs * 0.6, left: Pt = [Math.max(70, w * 0.17), tagY], right: Pt = [Math.min(w - 76, w * 0.82), tagY];
      const lowRow = troponin.filter(([, y]) => y > cy + 2 * gap);
      const ionShown = lowRow.reduce<Pt | null>((best, q) => (!best || Math.abs(q[0] - w * 0.3) < Math.abs(best[0] - w * 0.3) ? q : best), null);
      if (ionShown) drawTag(g, "Ca²⁺ → トロポニン", left, [ionShown], ramp(u, 0.17, 0.2) * (1 - ramp(u, 0.26, 0.28)), fs, p);
      if (pickedHead) drawTag(g, "ミオシン頭部の首振り", right, [pickedHead], ramp(u, 0.3, 0.33) * (1 - ramp(u, 0.56, 0.6)), fs, p);
      drawTag(g, "筋小胞体へ回収", left, [[left[0], srTop]], ramp(u, 0.76, 0.79) * (1 - ramp(u, 0.9, 0.93)), fs, p);
      drawSteps(g, 14, 12, Math.min(w * 0.6, px - 30), STEPS, now, still ? 1 : ramp(u, BOUNDS[now], BOUNDS[now] + 0.012), fs, p);
    };
  },
};
