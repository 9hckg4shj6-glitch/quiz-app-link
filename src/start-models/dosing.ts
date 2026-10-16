// スタート画面のモデル「反復投与と定常状態」：半減期ごとに同じ量を飲むと、血中濃度は上がり下がりしながら積み上がり、
// 半減期の約4〜5倍で、毎回同じ山と谷をくり返す定常状態になる（点線）。飲み薬（1-コンパートメント、吸収は消失の12倍速い）で計算する。
// 8回分を約9秒で描き、少し見せてから消えてくり返す。動きを減らす設定では、描き終えた1枚を描く。
import { font, glow, ramp, rgba, type StartModel } from "./common";

const DOSES = 8;
const DRAW_SEC = 9, HOLD_END = 11.2, LOOP = 12;
const STILL_AT = 10;
const KE = Math.LN2, KA = 12 * Math.LN2;   // 消失と吸収の速さ（1 = 投与間隔 = 半減期）
// 1回分を飲んでから tau 後の濃度（Bateman 式）
const once = (tau: number): number => (tau <= 0 ? 0 : (KA / (KA - KE)) * (Math.exp(-KE * tau) - Math.exp(-KA * tau)));
const level = (x: number): number => { let c = 0; for (let i = 0; i <= Math.min(DOSES - 1, Math.floor(x)); i++) c += once(x - i); return c; };

export const dosing: StartModel = {
  id: "dosing",
  label: "反復投与",
  note: "いま動いているのは<b>反復投与</b>の血中濃度。半減期ごとに同じ量を飲むと、上がり下がりしながら積み上がり、半減期の約4〜5倍で<b>定常状態</b>になります。くり返して定着させる点は、復習と同じです。",
  create(w, h, still) {
    const x0 = 34, x1 = w - 18, yBase = h - 34, yTop = 30;
    // 定常状態の山と谷（十分な回数を飲み続けたときの最後の1区間から求める）
    let peak = 0, trough = Infinity;
    for (let k = 0; k <= 50; k++) { const x = 40 + k / 50; let c = 0; for (let i = 0; i <= 40; i++) c += once(x - i); peak = Math.max(peak, c); trough = Math.min(trough, c); }
    const X = (dose: number): number => x0 + ((x1 - x0) * dose) / DOSES;
    const Y = (c: number): number => yBase - ((yBase - yTop - 14) * c) / peak;
    const t0 = still ? STILL_AT : 0;

    return (g, time, _dt, p) => {
      // pen は描き終えたところ（投与間隔の単位）。最初の1回分が落ちてくるのを見せるため、少し手前から始める
      const tt = (time + t0) % LOOP, pen = ((DOSES + 0.4) * Math.min(tt, DRAW_SEC)) / DRAW_SEC - 0.4, end = Math.max(0, pen);
      g.save(); g.globalAlpha = 1 - ramp(tt, HOLD_END, LOOP);
      // 軸と、半減期の目盛り（4・5 は定常状態に近づくところ）
      g.strokeStyle = rgba(p.muted, 0.5); g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x0, yTop - 6); g.lineTo(x0, yBase); g.lineTo(x1, yBase); g.stroke();
      g.font = font(10); g.fillStyle = rgba(p.muted, 0.95); g.textAlign = "left";
      g.fillText("血中濃度", x0 + 6, yTop - 10);
      g.textAlign = "right"; g.fillText("時間（半減期ごと）", x1, yBase + 26);
      g.textAlign = "center";
      for (let i = 1; i <= DOSES; i++) {
        const reached = pen >= i, key = i === 4 || i === 5;
        g.fillStyle = reached && key ? p.brand2 : rgba(p.muted, reached ? 0.95 : 0.4);
        g.font = font(10, reached && key ? 800 : 600); g.fillText(String(i), X(i), yBase + 13);
      }
      // 定常状態の山と谷：4〜5回目を過ぎると濃くなる
      const ss = ramp(pen, 3.5, 5);
      g.setLineDash([4, 4]); g.strokeStyle = rgba(p.brand2, 0.2 + 0.55 * ss); g.lineWidth = 1;
      for (const c of [peak, trough]) { g.beginPath(); g.moveTo(x0, Y(c)); g.lineTo(x1, Y(c)); g.stroke(); }
      g.setLineDash([]);
      if (ss > 0) { g.font = font(11, 700); g.textAlign = "right"; g.fillStyle = rgba(p.brand2, ss); g.fillText("定常状態", x1, Y(peak) - 6); }
      // 濃度の線と、その下の淡い塗り
      g.beginPath(); g.moveTo(x0, yBase);
      for (let x = 0; x <= end; x += 0.02) g.lineTo(X(x), Y(level(x)));
      g.lineTo(X(end), Y(level(end)));
      g.strokeStyle = p.brand2; g.lineWidth = 2; g.lineJoin = "round"; g.stroke();
      g.lineTo(X(end), yBase); g.closePath();
      const fill = g.createLinearGradient(0, yTop, 0, yBase);
      fill.addColorStop(0, rgba(p.brand2, 0.16)); fill.addColorStop(1, rgba(p.brand2, 0));
      g.fillStyle = fill; g.fill();
      if (tt < DRAW_SEC) { glow(g, X(end), Y(level(end)), 12, p.brand2, 0.5); g.fillStyle = p.brand2; g.beginPath(); g.arc(X(end), Y(level(end)), 2.6, 0, Math.PI * 2); g.fill(); }
      // 1回分の薬：飲むときに上から落ちてきて、線に溶ける
      for (let i = 0; i < DOSES; i++) {
        const u = (pen - (i - 0.35)) / 0.35;   // 0〜1 で落ちる、1 を過ぎると消える
        if (u < 0 || u > 1.6) continue;
        const x = X(i), y = yTop - 8 + (Y(level(i)) - yTop + 4) * Math.min(1, u) ** 2, a = u <= 1 ? 1 : 1 - (u - 1) / 0.6;
        g.save(); g.translate(x, y); g.rotate(0.6); g.globalAlpha *= a;
        g.fillStyle = p.brand; g.beginPath(); g.arc(-3, 0, 3, Math.PI / 2, (Math.PI * 3) / 2); g.lineTo(0, -3); g.lineTo(0, 3); g.closePath(); g.fill();
        g.fillStyle = p.warn; g.beginPath(); g.arc(3, 0, 3, -Math.PI / 2, Math.PI / 2); g.lineTo(0, 3); g.lineTo(0, -3); g.closePath(); g.fill();
        g.restore();
      }
      g.restore();
    };
  },
};
