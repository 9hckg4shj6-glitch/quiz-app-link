// スタート画面のモデル「蝸牛の進行波」：巻きをほどいた蝸牛を横に置く。左の入口（基部）でアブミ骨が卵円窓を押すと、
// 基底膜に入口から奥へ進む波が立ち、音の高さで決まる場所で最も大きく揺れて、その先ですぐ消える。
// 基底膜は入口ほど幅が狭くて硬く、奥ほど広くて柔らかいので、高い音は入口の近く、低い音は奥で揺れる（音の高さの場所の地図）。
// 8,000 → 2,000 → 500 → 125 Hz を約3秒ずつ鳴らす。揺れは実際よりずっとゆっくり描く。動きを減らす設定では 2,000 Hz の1枚。
import { font, glow, ramp, rgba, smooth, type StartModel } from "./common";

const TONES: { hz: number; pitch: string }[] = [
  { hz: 8000, pitch: "高い音" }, { hz: 2000, pitch: "やや高い音" }, { hz: 500, pitch: "やや低い音" }, { hz: 125, pitch: "低い音" },
];
const TONE_SEC = 3.2;
const STILL_AT = TONE_SEC * 1.5;
const OMEGA = Math.PI * 2 * 1.3;   // 見せる揺れの速さ（実際の周波数ではない）
// 基部（0, 約20,000 Hz）〜頂部（1, 約20 Hz）のどこで最も揺れるか（対数の目盛り）
const place = (hz: number): number => Math.log(20000 / hz) / Math.log(1000);

export const cochlea: StartModel = {
  id: "cochlea",
  label: "蝸牛",
  note: "いま動いているのは<b>蝸牛の基底膜</b>（巻きをほどいた図）。音の振動は入口から奥へ進む波になり、高い音ほど入口の近く、低い音ほど奥で大きく揺れます。揺れた場所の有毛細胞が、その高さの音を伝えます。",
  create(w, h, still) {
    const xb = w * 0.13, xa = w * 0.95, len = xa - xb, cy = h * 0.47, Hb = h * 0.27, Ha = h * 0.15, amp = h * 0.12;
    const half = (u: number): number => Hb + (Ha - Hb) * u;   // 管の半分の高さ（奥ほど細い）
    const uEnd = (len - Ha * 0.6) / len;                        // 基底膜は頂部の手前で切れる（蝸牛孔）
    const t0 = still ? STILL_AT : 0;

    return (g, time, _dt, p) => {
      const t = time + t0, tone = TONES[Math.floor(t / TONE_SEC) % TONES.length], local = t % TONE_SEC;
      const env = smooth(ramp(local, 0, 0.6)) * (1 - smooth(ramp(local, TONE_SEC - 0.6, TONE_SEC)));
      const uc = place(tone.hz);
      const reach = (u: number): number => Math.exp(-(((u - uc) / (u <= uc ? 0.2 : 0.04)) ** 2));   // 奥側はすぐ消える
      const disp = (u: number): number => amp * env * reach(u) * Math.sin(OMEGA * t - Math.PI * 2 * 2.4 * (u / uc) ** 1.5);

      // 管（前庭階・鼓室階）と頂部の丸み
      g.beginPath(); g.moveTo(xb, cy - Hb); g.lineTo(xa, cy - Ha); g.arc(xa, cy, Ha, -Math.PI / 2, Math.PI / 2); g.lineTo(xb, cy + Hb);
      g.fillStyle = rgba(p.brand2, 0.06); g.fill();
      g.strokeStyle = rgba(p.text, 0.3); g.lineWidth = 1.5; g.stroke();
      // 入口の壁：卵円窓（上）はアブミ骨に押され、正円窓（下）は逆向きにふくらむ
      const s = 2.6 * env * Math.sin(OMEGA * t);
      const oval = [cy - Hb * 0.85, cy - Hb * 0.2], round = [cy + Hb * 0.2, cy + Hb * 0.85];
      g.beginPath();
      g.moveTo(xb, cy - Hb); g.lineTo(xb, oval[0]); g.moveTo(xb, oval[1]); g.lineTo(xb, round[0]); g.moveTo(xb, round[1]); g.lineTo(xb, cy + Hb);
      g.stroke();
      g.strokeStyle = rgba(p.brand2, 0.7); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(xb, oval[0]); g.quadraticCurveTo(xb + 2 * s, (oval[0] + oval[1]) / 2, xb, oval[1]); g.stroke();
      g.beginPath(); g.moveTo(xb, round[0]); g.quadraticCurveTo(xb - 2 * s, (round[0] + round[1]) / 2, xb, round[1]); g.stroke();
      // アブミ骨：底板と、頭へ集まる2本の脚
      const foot = xb - 3 + s, headX = foot - Math.min(24, xb * 0.5), mid = (oval[0] + oval[1]) / 2, spanY = (oval[1] - oval[0]) * 0.35;
      g.strokeStyle = rgba(p.text, 0.55); g.lineWidth = 2.5; g.lineCap = "round";
      g.beginPath(); g.moveTo(foot, mid - spanY); g.lineTo(foot, mid + spanY); g.stroke();
      g.lineWidth = 1.6; g.beginPath(); g.moveTo(foot, mid - spanY); g.quadraticCurveTo(headX + 4, mid - spanY, headX, mid); g.quadraticCurveTo(headX + 4, mid + spanY, foot, mid + spanY); g.stroke();
      g.lineCap = "butt";
      // 基底膜：入口ほど細く、奥ほど太い帯として描く
      const pts: [number, number, number][] = [];
      for (let x = xb + 1; x <= xb + len * uEnd; x += 2) { const u = (x - xb) / len; pts.push([x, cy + disp(u), 0.8 + 2.6 * u]); }
      g.beginPath();
      pts.forEach(([x, y, tw], i) => (i ? g.lineTo(x, y - tw) : g.moveTo(x, y - tw)));
      for (let i = pts.length - 1; i >= 0; i--) g.lineTo(pts[i][0], pts[i][1] + pts[i][2]);
      g.closePath(); g.fillStyle = rgba(p.brand, 0.7); g.fill();
      // 有毛細胞：揺れの大きいところほど光る
      const peakX = xb + uc * len;
      glow(g, peakX, cy, h * 0.11, p.warn, 0.32 * env);
      for (let x = xb + 4; x <= xb + len * uEnd; x += 7) {
        const u = (x - xb) / len, k = env * reach(u), y = cy + disp(u) - (0.8 + 2.6 * u) - 3;
        g.fillStyle = rgba(p.muted, 0.35); g.beginPath(); g.arc(x, y, 1.5, 0, Math.PI * 2); g.fill();
        if (k > 0.05) { g.fillStyle = rgba(p.warn, k); g.beginPath(); g.arc(x, y, 1.5 + k, 0, Math.PI * 2); g.fill(); }
      }
      // いま鳴っている音と、いちばん揺れる場所
      const labelY = cy - half(uc) - 9;
      g.font = font(11, 700); g.textAlign = "center"; g.fillStyle = rgba(p.warn, env);
      g.fillText(`♪ ${tone.hz.toLocaleString("ja-JP")} Hz（${tone.pitch}）`, Math.min(Math.max(peakX, 70), w - 70), labelY);
      g.strokeStyle = rgba(p.warn, 0.7 * env); g.lineWidth = 1.2; g.beginPath(); g.moveTo(peakX, labelY + 3); g.lineTo(peakX, cy - half(uc) - 1); g.stroke();
      g.font = font(10); g.fillStyle = rgba(p.muted, 0.9);
      g.textAlign = "left"; g.fillText("基部（入口）：高い音", xb - 4, cy + Hb + 16);
      g.textAlign = "right"; g.fillText("頂部（奥）：低い音", Math.min(w - 6, xa + Ha * 0.6), cy + Hb + 16);
    };
  },
};
