// スタート画面のモデル「反復投与と定常状態・負荷投与」：飲み薬（1-コンパートメント、吸収は消失の12倍速い）で、
// 投与間隔＝半減期のとき。① 維持量だけ：1回目は有効域（最小有効濃度〜最小中毒濃度）に届かず、飲むたびに積み上がって、
// 半減期の約4〜5倍で毎回同じ山と谷をくり返す定常状態になる。② 初回だけ2倍（負荷量）にすると、最初から定常状態の高さに届く
// （①の線を淡く重ねて比べる）。線の色は今いる域（中毒域・有効域・無効域）、右端の帯にも今の濃度を出す。
// 動きを減らす設定では、①を描き終えた1枚を描く。
import { PANEL, clamp, drawPanel, drawSteps, font, glow, ramp, rgba, roundRect, type Palette, type StartModel } from "./common";

const KE = Math.LN2, KA = 12 * Math.LN2;   // 消失と吸収の速さ（1 = 投与間隔 = 半減期）
const MEC = 0.92, MTC = 1.95, TOP = 2.3;   // 最小有効濃度・最小中毒濃度・目盛りの上端（1回分を飲んだときの量を基準にした値）
const SCENES = [
  { doses: 8, load: 1, draw: 9.5, hold: 1.6, name: "維持量だけ" },
  { doses: 5, load: 2, draw: 6.5, hold: 1.8, name: "初回に負荷量（2倍）" },
];
const STEPS = [
  "維持量だけ：1回目では\n有効域に届かない",
  "飲むたびに少しずつ\n積み上がっていく",
  "半減期の4〜5倍で\n定常状態になる",
  "初回だけ多め（負荷量）に\n飲むと…",
  "最初から定常状態の\n高さに届く",
];
const FADE = 0.5;
// 1回分を飲んでから tau 後の濃度（Bateman 式）
const once = (tau: number): number => (tau <= 0 ? 0 : (KA / (KA - KE)) * (Math.exp(-KE * tau) - Math.exp(-KA * tau)));
const level = (x: number, doses: number, load: number): number => {
  let c = 0;
  for (let i = 0; i <= Math.min(doses - 1, Math.floor(x)); i++) c += (i === 0 ? load : 1) * once(x - i);
  return c;
};

// 立体的なカプセル（2色の殻とつや）
function capsule(g: CanvasRenderingContext2D, x: number, y: number, s: number, p: Palette, alpha: number): void {
  g.save(); g.translate(x, y); g.rotate(0.6); g.globalAlpha *= alpha;
  const L = 6 * s, R = 3 * s;
  g.save(); roundRect(g, -L, -R, L * 2, R * 2, R); g.clip();
  g.fillStyle = p.brand; g.fillRect(-L, -R, L, R * 2); g.fillStyle = p.warn; g.fillRect(0, -R, L, R * 2);
  const shade = g.createLinearGradient(0, -R, 0, R); shade.addColorStop(0, "rgba(255,255,255,0.45)"); shade.addColorStop(0.45, "rgba(255,255,255,0)"); shade.addColorStop(1, "rgba(0,0,0,0.2)");
  g.fillStyle = shade; g.fillRect(-L, -R, L * 2, R * 2);
  g.restore();
  roundRect(g, -L, -R, L * 2, R * 2, R); g.strokeStyle = "rgba(0,0,0,0.18)"; g.lineWidth = 0.8; g.stroke();
  g.restore();
}

export const dosing: StartModel = {
  id: "dosing",
  label: "反復投与",
  note: "いま動いているのは<b>反復投与</b>の血中濃度。半減期ごとに同じ量を飲むと、上がり下がりしながら積み上がり、半減期の約4〜5倍で<b>定常状態</b>になります。初回だけ多め（負荷量）にすると、最初から届きます。",
  create(w, h, still) {
    const fs = clamp(h * 0.035, 11, 13), k = h / 230;
    const x0 = 34, x1 = w - 34, yT = h * 0.28, yB = h - fs * 2.4 - 6;
    // 定常状態の山と谷（十分な回数を飲み続けたときの最後の1区間から求める）
    let peak = 0, trough = Infinity;
    for (let s = 0; s <= 100; s++) { const c = level(40 + s / 100, 60, 1); peak = Math.max(peak, c); trough = Math.min(trough, c); }
    const Y = (c: number): number => yB - ((yB - yT) * c) / TOP;
    const scenes = SCENES.map((s) => ({ ...s, span: s.draw + s.hold + FADE }));
    const cycle = scenes.reduce((a, s) => a + s.span, 0);
    const t0 = still ? SCENES[0].draw + 0.5 : 0;

    const curve = (g: CanvasRenderingContext2D, doses: number, load: number, X: (d: number) => number, end: number): void => {
      g.beginPath();
      for (let x = 0; x <= end; x += 0.02) g[x ? "lineTo" : "moveTo"](X(x), Y(level(x, doses, load)));
      g.lineTo(X(end), Y(level(end, doses, load)));
    };

    return (g, time, _dt, p) => {
      let local = (time + t0) % cycle, si = 0;
      while (local > scenes[si].span) { local -= scenes[si].span; si++; }
      const sc = scenes[si], X = (d: number): number => x0 + ((x1 - x0) * d) / 8;
      const pen = ((sc.doses + 0.4) * Math.min(local, sc.draw)) / sc.draw - 0.4, end = Math.max(0, pen), c = level(end, sc.doses, sc.load);
      const alpha = 1 - ramp(local, sc.draw + sc.hold, sc.span);
      g.save(); g.globalAlpha = alpha;
      // 域の色分け（中毒域・有効域）と名前
      g.fillStyle = rgba(p.bad, 0.08); g.fillRect(x0, yT, x1 - x0, Y(MTC) - yT);
      g.fillStyle = rgba(p.good, 0.1); g.fillRect(x0, Y(MTC), x1 - x0, Y(MEC) - Y(MTC));
      g.font = font(fs - 3, 800); g.textAlign = "right";
      g.fillStyle = rgba(p.bad, 0.85); g.fillText("中毒域", x1 - 5, yT + fs - 2);
      g.fillStyle = rgba(p.good, 0.95); g.fillText("有効域", x1 - 5, Y(MTC) + fs);
      g.fillStyle = rgba(p.muted, 0.95); g.fillText("無効域", x1 - 5, yB - 5);
      // 軸と目盛り（半減期ごと。4・5 は定常状態に近づくところ）
      g.strokeStyle = rgba(p.muted, 0.15); g.lineWidth = 1;
      for (let i = 1; i <= 8; i++) { g.beginPath(); g.moveTo(Math.round(X(i)) + 0.5, yT); g.lineTo(Math.round(X(i)) + 0.5, yB); g.stroke(); }
      g.strokeStyle = rgba(p.muted, 0.6); g.lineWidth = 1.2; g.beginPath(); g.moveTo(x0, yT - 4); g.lineTo(x0, yB); g.lineTo(x1, yB); g.stroke();
      g.font = font(fs - 3, 700); g.textAlign = "left"; g.fillStyle = rgba(p.muted, 0.95); g.fillText("血中濃度", x0 + 5, yT - 6);
      g.textAlign = "center";
      for (let i = 1; i <= 8; i++) {
        const reached = pen >= i, key = si === 0 && (i === 4 || i === 5);
        g.font = font(fs - 2, reached && key ? 800 : 600); g.fillStyle = reached && key ? p.brand2 : rgba(p.muted, reached ? 0.95 : 0.4);
        g.fillText(String(i), X(i), yB + fs + 1);
      }
      g.textAlign = "right"; g.font = font(fs - 3, 700); g.fillStyle = rgba(p.muted, 0.95); g.fillText("時間（半減期ごと）", x1, yB + fs * 2.2);
      // 定常状態の山と谷
      const ss = si === 0 ? ramp(pen, 3.5, 5) : ramp(pen, 0.6, 1.2);
      g.setLineDash([4, 4]); g.strokeStyle = rgba(p.brand2, 0.25 + 0.55 * ss); g.lineWidth = 1;
      for (const v of [peak, trough]) { g.beginPath(); g.moveTo(x0, Y(v)); g.lineTo(x1, Y(v)); g.stroke(); }
      g.setLineDash([]);
      if (ss > 0) { g.font = font(fs - 2, 800); g.textAlign = "left"; g.fillStyle = rgba(p.brand2, ss); g.fillText("定常状態", X(si === 0 ? 5.2 : 2.2), Y(peak) - 5); }
      // ②では①の線を淡く重ねて比べる
      if (si === 1) {
        g.setLineDash([3, 3]); g.strokeStyle = rgba(p.muted, 0.55); g.lineWidth = 1.2;
        curve(g, 8, 1, X, Math.min(8, Math.max(0, pen))); g.stroke(); g.setLineDash([]);
      }
      // 濃度の線：色は今いる域。下に淡い塗り、先端は光
      if (pen > 0) {
        curve(g, sc.doses, sc.load, X, end);
        const zone = g.createLinearGradient(0, Y(TOP), 0, yB), at = (v: number): number => clamp((Y(v) - Y(TOP)) / (yB - Y(TOP)), 0, 1);
        zone.addColorStop(0, p.bad); zone.addColorStop(at(MTC), p.bad); zone.addColorStop(at(MTC) + 0.001, p.good);
        zone.addColorStop(at(MEC), p.good); zone.addColorStop(Math.min(1, at(MEC) + 0.001), p.muted); zone.addColorStop(1, p.muted);
        g.lineJoin = "round"; g.strokeStyle = zone; g.globalAlpha = alpha * 0.25; g.lineWidth = 5; g.stroke();
        g.globalAlpha = alpha; g.lineWidth = 2.2; g.stroke();
        g.lineTo(X(end), yB); g.lineTo(X(0), yB); g.closePath();
        const fill = g.createLinearGradient(0, yT, 0, yB); fill.addColorStop(0, rgba(p.brand2, 0.16)); fill.addColorStop(1, rgba(p.brand2, 0));
        g.fillStyle = fill; g.fill();
        if (local < sc.draw) {
          const hx = X(end), hy = Y(c);
          g.setLineDash([2, 3]); g.strokeStyle = rgba(p.muted, 0.4); g.lineWidth = 1; g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx, yB); g.stroke(); g.setLineDash([]);
          glow(g, hx, hy, 12 * k, p.brand2, 0.55); g.fillStyle = p.brand2; g.beginPath(); g.arc(hx, hy, 2.8 * k, 0, Math.PI * 2); g.fill();
        }
      }
      // 1回分の薬：飲むときに上から落ちてきて、線に溶ける（負荷量は大きく）
      for (let i = 0; i < sc.doses; i++) {
        const u = (pen - (i - 0.38)) / 0.38;
        if (u < 0 || u > 1.6) continue;
        const x = X(i), landY = Y(level(i, sc.doses, sc.load)), y = yT - 10 + (landY - yT + 6) * Math.min(1, u) ** 2, big = i === 0 && sc.load > 1;
        capsule(g, x, y, (big ? 1.5 : 1) * k, p, u <= 1 ? 1 : 1 - (u - 1) / 0.6);
        if (u > 1) { const q = (u - 1) / 0.6; g.strokeStyle = rgba(p.brand2, 0.6 * (1 - q)); g.lineWidth = 1.2; g.beginPath(); g.ellipse(x, landY, 4 + 12 * q, 2 + 5 * q, 0, 0, Math.PI * 2); g.stroke(); }
        if (big && u <= 1.2) { g.font = font(fs - 2, 800); g.textAlign = "left"; g.fillStyle = p.warn; g.fillText("×2", x + 11 * k, y - 4); }
      }
      // 右端の帯：今の濃度がどの域か
      const bx = x1 + 10, bw = 7;
      g.fillStyle = rgba(p.bad, 0.55); g.fillRect(bx, yT, bw, Y(MTC) - yT);
      g.fillStyle = rgba(p.good, 0.7); g.fillRect(bx, Y(MTC), bw, Y(MEC) - Y(MTC));
      g.fillStyle = rgba(p.muted, 0.35); g.fillRect(bx, Y(MEC), bw, yB - Y(MEC));
      const my = Y(c);
      g.fillStyle = p.text; g.beginPath(); g.moveTo(bx - 2, my); g.lineTo(bx - 8, my - 4.5); g.lineTo(bx - 8, my + 4.5); g.closePath(); g.fill();
      g.restore();
      // 計器：いまの飲み方と、いまの域
      const pw = Math.min(150, w * 0.36), ph = fs * 3.6, px = w - pw - 10, py = 8;
      drawPanel(g, px, py, pw, ph);
      const zoneName = c >= MTC ? "中毒域" : c >= MEC ? "有効域" : "無効域", zoneColor = c >= MTC ? "#ff7b8a" : c >= MEC ? PANEL.green : "#9aa3c7";
      g.textAlign = "left"; g.font = font(fs - 3, 700); g.fillStyle = si === 1 ? PANEL.amber : PANEL.ink; g.fillText(sc.name, px + 10, py + fs + 1);
      g.font = font(fs + 3, 800); g.fillStyle = pen > 0 ? zoneColor : "#9aa3c7"; g.fillText(pen > 0 ? zoneName : "飲む前", px + 10, py + fs * 2.75);
      // いまの段階
      const now = si === 0 ? (pen < 1.2 ? 0 : pen < 3.6 ? 1 : 2) : pen < 0.9 ? 3 : 4;
      const since = si === 0 ? [0, 1.2, 3.6][now] : [0, 0, 0, 0, 0.9][now];
      const fresh = still ? 1 : now === 0 || now === 3 ? ramp(local, 0, 0.3) : ramp(pen, since, since + 0.25);
      drawSteps(g, 14, 12, Math.min(w * 0.55, px - 28), STEPS, now, fresh, fs, p);
    };
  },
};
