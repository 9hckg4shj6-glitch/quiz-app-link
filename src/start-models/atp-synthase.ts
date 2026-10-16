// スタート画面のモデル「ATP合成酵素」：ミトコンドリア内膜を横に置き、上がマトリックス、下が膜間腔（H⁺が多い）。
// H⁺ が1個、固定子（aサブユニット）を通って流れ込むたびに、膜の中の cリング（8個のcサブユニット）と軸（γ）が 1/8 回転する。
// 上の頭部（F₁）は動かず、軸の向きに合わせて β サブユニットが形を変え、120° 回るごとに ATP を1個放す（1回転で3個）。
// 動きを減らす設定では、ATP を放した直後の1枚を描く。
import { clamp, font, glow, rgba, smooth, type StartModel } from "./common";

const STEP = 0.42, MOVE = 0.24;   // H⁺ 1個ぶんの周期と、そのうち回っている時間
const STILL_AT = 2.22;
const hash = (n: number): number => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };

export const atpSynthase: StartModel = {
  id: "atp",
  label: "ATP合成酵素",
  note: "いま動いているのは<b>ATP合成酵素</b>。膜の内外のH⁺の濃度差でH⁺が流れ込むたびに、膜の中の回転子（cリング）と軸が回り、上の頭部（F₁）が軸の向きに合わせて形を変えてATPを作ります。1回転でATPは3個です。",
  create(w, h, still) {
    const cx = w * 0.5, yTop = h * 0.6, yBot = h * 0.76, rc = h * 0.14;
    const yH = h * 0.29, rx = h * 0.21, ry = h * 0.155;
    const chX = cx + rc + 10;   // H⁺ の通り道（固定子）
    const bg = Array.from({ length: 16 }, (_, i) => ({
      x: Math.random() * w, y: i < 13 ? yBot + 10 + Math.random() * (h - yBot - 22) : 14 + Math.random() * (yTop - 30), s: Math.random() * 10,
    }));
    const t0 = still ? STILL_AT : 0;

    return (g, time, _dt, p) => {
      const t = time + t0, n = Math.floor(t / STEP), turn = n + smooth(clamp((t - n * STEP) / MOVE, 0, 1));
      const theta = (turn * Math.PI * 2) / 8;
      const proton = (x: number, y: number, a: number): void => { g.fillStyle = rgba(p.warn, a); g.fillText("H⁺", x, y); };
      g.font = font(10, 700); g.textAlign = "center";
      // 脂質二重膜（タンパク質のところは空ける）
      for (let x = 4; x < w; x += 6.5) {
        if (x > cx - rc - 6 && x < chX + 12) continue;
        g.strokeStyle = rgba(p.muted, 0.2); g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, yTop + 4); g.lineTo(x, (yTop + yBot) / 2 - 2); g.moveTo(x, yBot - 4); g.lineTo(x, (yTop + yBot) / 2 + 2); g.stroke();
        g.fillStyle = rgba(p.muted, 0.35);
        g.beginPath(); g.arc(x, yTop + 2.4, 2.4, 0, Math.PI * 2); g.arc(x, yBot - 2.4, 2.4, 0, Math.PI * 2); g.fill();
      }
      // 漂う H⁺：下（膜間腔）に多く、上（マトリックス）に少ない
      for (const b of bg) proton(b.x + Math.sin(t * 0.6 + b.s) * 8, b.y + Math.cos(t * 0.5 + b.s) * 4, 0.45);
      // 流れ込む H⁺：固定子へ近づき、回転の1段ぶんで上へ抜けていく
      for (let k = n - 3; k <= n + 3; k++) {
        const due = k * STEP, before = (due - t) / 1.4, after = (t - due - 0.1) / 1.4;
        if (before > 0 && before < 1) {
          const sx = chX + (hash(k) - 0.5) * w * 0.55, sy = yBot + (h - yBot) * (0.4 + 0.45 * hash(k + 7)), u = 1 - before;
          proton(sx + (chX - sx) * u * u, sy + (yBot + 6 - sy) * u * u, 0.5 + 0.5 * u);
        } else if (after > 0 && after < 1) {
          proton(chX + after * (24 + 30 * hash(k + 3)), yTop - 6 - after * (24 + 20 * hash(k + 5)), 1 - after);
        }
      }
      // 頭部 F₁：α と β が交互。β は軸の向きで形が変わる（空 → ADP＋Pi → ATP を作る → 放す）
      const third = Math.floor(turn / (8 / 3));
      ([[-0.62, 0], [0.62, 3], [-0.21, 1], [0.21, 2]] as const).forEach(([u, slot]) => {
        const beta = slot % 2 === 1, state = (third + slot) % 3;
        const a = beta ? [0.18, 0.3, 0.48][state] : 0.13, shrink = beta && state === 2 ? 0.9 : 1;
        g.fillStyle = rgba(p.brand2, a); g.strokeStyle = rgba(p.brand2, 0.45); g.lineWidth = 1;
        g.beginPath(); g.ellipse(cx + u * rx, yH, rx * 0.3, ry * 0.92 * shrink, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      });
      // 固定子：aサブユニットと、頭部を押さえる b の柄
      g.fillStyle = rgba(p.brand2, 0.3); g.fillRect(cx + rc + 3, yTop - 4, 14, yBot - yTop + 8);
      g.strokeStyle = rgba(p.brand2, 0.4); g.lineWidth = 5; g.lineCap = "round"; g.lineJoin = "round";
      g.beginPath(); g.moveTo(chX, yTop - 4); g.lineTo(cx + rx + 7, yH + ry * 0.4); g.lineTo(cx + rx + 7, yH - ry * 0.5);
      g.quadraticCurveTo(cx + rx + 7, yH - ry - 6, cx + rx * 0.3, yH - ry - 4); g.stroke();
      // 回転子：軸（γ）は少し曲がっているので、回ると先端が左右に振れる。cリングは手前のサブユニットほど濃い
      const e = rx * 0.18 * Math.sin(theta);
      g.strokeStyle = rgba(p.brand, 0.75); g.lineWidth = rc * 0.32;
      g.beginPath(); g.moveTo(cx, yTop - 2); g.quadraticCurveTo(cx + e * 0.2, (yTop + yH) / 2, cx + e, yH + ry * 0.1); g.stroke();
      g.fillStyle = rgba(p.brand, 0.1); g.fillRect(cx - rc, yTop - 3, rc * 2, yBot - yTop + 6);
      const subunits = Array.from({ length: 8 }, (_, i) => theta + (i * Math.PI) / 4).filter((a) => Math.cos(a) > 0).sort((a, b) => Math.cos(a) - Math.cos(b));
      for (const a of subunits) {
        const depth = Math.cos(a), x = cx + rc * Math.sin(a), wd = ((Math.PI * 2 * rc) / 8) * depth * 0.85;
        g.strokeStyle = rgba(p.brand, 0.25 + 0.5 * depth); g.lineWidth = wd;
        g.beginPath(); g.moveTo(x, yTop + wd / 2 - 1); g.lineTo(x, yBot - wd / 2 + 1); g.stroke();
        g.fillStyle = rgba(p.warn, depth); g.beginPath(); g.arc(x, (yTop + yBot) / 2, 2.2, 0, Math.PI * 2); g.fill();
      }
      g.lineCap = "butt";
      // 放された ATP：120° ごとに1個、頭部から上へ浮かぶ
      for (let k = third - 2; k <= third; k++) {
        if (k < 1) continue;
        const at = Math.floor((8 * k) / 3) * STEP + ((8 * k) / 3 - Math.floor((8 * k) / 3)) * MOVE, age = t - at;
        if (age < 0 || age > 2.2) continue;
        const side = k % 2 ? 1 : -1, x = cx + side * (rx * 0.45 + age * 10), y = yH - ry * 0.6 - age * 18;
        const a = Math.min(1, age / 0.15) * (1 - age / 2.2);
        glow(g, x, y - 4, 16, p.good, 0.3 * a);
        g.font = font(11, 800); g.fillStyle = rgba(p.good, a); g.fillText("ATP", x, y);
      }
      // 名前
      g.font = font(10); g.fillStyle = rgba(p.muted, 0.95); g.textAlign = "left";
      g.fillText("マトリックス", 12, 16); g.fillText("膜間腔（H⁺が多い）", 12, h - 8);
      g.textAlign = "right";
      g.fillText("F₁（ATPを作る）", cx - rx - 8, yH + 4);
      g.fillText("cリング（回る）", cx - rc - 8, yBot + 16);
    };
  },
};
