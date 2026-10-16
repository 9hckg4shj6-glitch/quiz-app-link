// スタート画面のモデル「蝸牛の進行波と音の高さの地図」：巻きをほどいた蝸牛を横に置く（左が入口＝基部、右が奥＝頂部）。
// 管は前庭階・中央階（ライスネル膜と基底膜の間、内リンパ）・鼓室階に分かれ、奥の蝸牛孔でつながる。アブミ骨が卵円窓を押すと、
// 基底膜に入口から奥へ進む波が立ち、音の高さで決まる場所で最も大きく揺れて、その先ですぐ消える（点線は揺れの包絡線）。
// 揺れた場所の有毛細胞が光り、聴神経へ信号が走る。基底膜の色は「その場所が受けもつ音の高さ」。
// 左上に本当の渦巻きの形と今の場所、右上に今の音の波形を出す。8,000 → 2,000 → 500 → 125 Hz を約3.4秒ずつ。
// 揺れは実際よりずっとゆっくり描く。動きを減らす設定では 2,000 Hz の1枚。
import { cachedLayer, clamp, drawPanel, drawSteps, drawTag, font, glow, ramp, rgba, smooth, PANEL, type Palette, type StartModel } from "./common";

const TONES = [
  { hz: 8000, step: "8,000 Hz（高い音）は\n入口のすぐ近くが揺れる", cycles: 7 },
  { hz: 2000, step: "2,000 Hz は\n入口寄りが揺れる", cycles: 4.5 },
  { hz: 500, step: "500 Hz は\n奥寄りが揺れる", cycles: 2.6 },
  { hz: 125, step: "125 Hz（低い音）は\nいちばん奥の近くが揺れる", cycles: 1.4 },
];
const TONE_SEC = 3.4;
const STILL_AT = TONE_SEC * 1.5;
const OMEGA = Math.PI * 2 * 1.25;   // 見せる揺れの速さ（実際の周波数ではない）
const PANEL_COLORS = ["#7cc4ff", "#5fe3d1", "#8df07a", "#ffcf5a"];   // 暗い計器の上で見やすい、場所ごとの色（入口→奥）
// 基部（0, 約20,000 Hz）〜頂部（1, 約20 Hz）のどこで最も揺れるか（対数の目盛り）
const place = (hz: number): number => Math.log(20000 / hz) / Math.log(1000);
const placeColors = (p: Palette): string[] => [p.brand2, p.brand, p.good, p.warn];

export const cochlea: StartModel = {
  id: "cochlea",
  label: "蝸牛",
  note: "いま動いているのは<b>蝸牛の基底膜</b>（巻きをほどいた図）。音の振動は入口から奥へ進む波になり、高い音ほど入口の近く、低い音ほど奥で大きく揺れます。揺れた場所の有毛細胞が、その高さの音を聴神経へ伝えます。",
  create(w, h, still) {
    const fs = clamp(h * 0.035, 11, 13), k = h / 230;
    const xb = w * 0.1, xa = w * 0.95, len = xa - xb, cy = h * 0.56, Hb = h * 0.17, Ha = h * 0.1, amp = h * 0.085;
    const half = (u: number): number => Hb + (Ha - Hb) * u;
    const uEnd = (len - Ha * 0.8) / len;                           // 基底膜は頂部の手前で切れる（蝸牛孔）
    const reiss = (u: number): number => cy - half(u) * 0.38;      // ライスネル膜
    const Ri = Math.min(h * 0.14, 36), ix = 12 + Ri, iy = 8 + Ri;   // 左上の渦巻き
    const spiral = (s: number): [number, number] => { const th = -Math.PI / 2 + s * 2.6 * Math.PI * 2, r = Ri * (1 - 0.8 * s); return [ix + Math.cos(th) * r, iy + Math.sin(th) * r]; };
    const pw = Math.min(176, w * 0.42), ph = h * 0.27, px = w - pw - 10, py = 8;
    const t0 = still ? STILL_AT : 0;

    const base = cachedLayer(w, h, (g, p) => {
      // 管：前庭階・中央階・鼓室階の色分け
      const duct = new Path2D();
      duct.moveTo(xb, cy - Hb); duct.lineTo(xa, cy - Ha); duct.arc(xa, cy, Ha, -Math.PI / 2, Math.PI / 2); duct.lineTo(xb, cy + Hb); duct.closePath();
      g.save(); g.shadowColor = "rgba(10,20,40,0.16)"; g.shadowBlur = 10 * k; g.shadowOffsetY = 3 * k; g.fillStyle = p.card; g.fill(duct); g.restore();
      g.save(); g.clip(duct);
      g.fillStyle = rgba(p.brand2, 0.09); g.fillRect(xb, cy - Hb - 2, len + Ha, Hb * 2 + 4);
      g.fillStyle = rgba(p.good, 0.1); g.beginPath();
      for (let x = xb; x <= xb + len * uEnd; x += 4) g.lineTo(x, reiss((x - xb) / len));
      g.lineTo(xb + len * uEnd, cy); g.lineTo(xb, cy); g.closePath(); g.fill();
      g.restore();
      g.strokeStyle = rgba(p.text, 0.32); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(xb, cy - Hb); g.lineTo(xa, cy - Ha); g.arc(xa, cy, Ha, -Math.PI / 2, Math.PI / 2); g.lineTo(xb, cy + Hb); g.stroke();
      g.strokeStyle = rgba(p.good, 0.55); g.lineWidth = 0.9; g.beginPath();
      for (let x = xb; x <= xb + len * uEnd; x += 4) g.lineTo(x, reiss((x - xb) / len));
      g.stroke();
      g.font = font(fs - 3, 700); g.fillStyle = rgba(p.muted, 0.95); g.textAlign = "left";
      g.fillText("前庭階", xb + 8, cy - Hb + fs * 0.95); g.fillText("中央階", xb + 8, reiss(0) + fs * 0.95 - 2); g.fillText("鼓室階", xb + 8, cy + Hb - 6);
      g.textAlign = "right"; g.fillText("蝸牛孔", xa + Ha * 0.4, cy - Ha - 4);
      g.font = font(fs - 2, 800); g.fillStyle = rgba(p.text, 0.7);
      g.textAlign = "left"; g.fillText("入口（基部）", xb, cy - Hb - 6);
      g.textAlign = "right"; g.fillText("奥（頂部）", xa - Ha * 0.4, cy - Ha - 4 - fs);
      // 渦巻き：場所ごとの色で、入口（外側）から奥（中心）へ
      const colors = placeColors(p);
      g.lineCap = "round";
      for (let i = 0; i < 120; i++) {
        const s0 = i / 120, s1 = (i + 1) / 120, [x0, y0] = spiral(s0), [x1, y1] = spiral(s1);
        const ci = Math.min(colors.length - 2, Math.floor(s0 * (colors.length - 1)));
        g.strokeStyle = rgba(colors[ci + (s0 * (colors.length - 1) - ci > 0.5 ? 1 : 0)], 0.75); g.lineWidth = (3.4 - 1.8 * s0) * k;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
      g.font = font(fs - 3, 700); g.fillStyle = rgba(p.muted, 0.95); g.textAlign = "left"; g.fillText("実際は渦巻き", ix + Ri + 6, iy + 3);
    });

    return (g, time, _dt, p) => {
      const t = time + t0, ti = Math.floor(t / TONE_SEC) % TONES.length, tone = TONES[ti], local = t % TONE_SEC;
      const env = smooth(ramp(local, 0, 0.6)) * (1 - smooth(ramp(local, TONE_SEC - 0.6, TONE_SEC)));
      const uc = place(tone.hz), colors = placeColors(p);
      const reach = (u: number): number => Math.exp(-(((u - uc) / (u <= uc ? 0.2 : 0.04)) ** 2));   // 奥側はすぐ消える
      const disp = (u: number): number => amp * env * reach(u) * Math.sin(OMEGA * t - Math.PI * 2 * 2.4 * (u / uc) ** 1.5);
      const thick = (u: number): number => (0.8 + 2.6 * u) * k;   // 基底膜の幅（奥ほど広い）を太さで見せる
      base(g, p);
      // 入口の窓：卵円窓（上）はアブミ骨に押され、正円窓（下）は逆向きにふくらむ
      const s = 2.8 * k * env * Math.sin(OMEGA * t), oval = [cy - Hb * 0.85, cy - Hb * 0.25], round = [cy + Hb * 0.25, cy + Hb * 0.85];
      g.strokeStyle = rgba(p.text, 0.32); g.lineWidth = 1.5; g.beginPath();
      g.moveTo(xb, cy - Hb); g.lineTo(xb, oval[0]); g.moveTo(xb, oval[1]); g.lineTo(xb, round[0]); g.moveTo(xb, round[1]); g.lineTo(xb, cy + Hb); g.stroke();
      g.strokeStyle = rgba(p.brand2, 0.8); g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(xb, oval[0]); g.quadraticCurveTo(xb + 2 * s, (oval[0] + oval[1]) / 2, xb, oval[1]); g.stroke();
      g.beginPath(); g.moveTo(xb, round[0]); g.quadraticCurveTo(xb - 2 * s, (round[0] + round[1]) / 2, xb, round[1]); g.stroke();
      // アブミ骨：底板・2本の脚・頭
      const foot = xb - 2.5 + s, mid = (oval[0] + oval[1]) / 2, spanY = (oval[1] - oval[0]) * 0.36, headX = foot - Math.min(26 * k, xb * 0.62);
      g.fillStyle = rgba(p.muted, 0.35); g.strokeStyle = rgba(p.text, 0.6); g.lineWidth = 1.2;
      g.beginPath(); g.ellipse(foot - 1.5, mid, 2.2, spanY + 2, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      g.lineWidth = 2; g.beginPath(); g.moveTo(foot - 2, mid - spanY); g.bezierCurveTo(headX + 6, mid - spanY, headX + 2, mid - 4, headX, mid);
      g.bezierCurveTo(headX + 2, mid + 4, headX + 6, mid + spanY, foot - 2, mid + spanY); g.stroke();
      g.fillStyle = rgba(p.text, 0.55); g.beginPath(); g.arc(headX - 1.5, mid, 3 * k, 0, Math.PI * 2); g.fill();
      // 包絡線（どこまで大きく揺れうるか）
      g.setLineDash([3, 3]); g.strokeStyle = rgba(p.text, 0.3 * env); g.lineWidth = 1;
      for (const sign of [-1, 1]) {
        g.beginPath();
        for (let x = xb + 1; x <= xb + len * uEnd; x += 3) { const u = (x - xb) / len; g[x > xb + 1 ? "lineTo" : "moveTo"](x, cy + sign * amp * env * reach(u)); }
        g.stroke();
      }
      g.setLineDash([]);
      // 聴神経：揺れた場所から信号が下へ走る
      for (let x = xb + 8; x <= xb + len * uEnd; x += 9 * k) {
        const u = (x - xb) / len, y0 = cy + disp(u) + thick(u), y1 = cy + half(u) - 3, act = env * reach(u) ** 3;
        g.strokeStyle = rgba(p.muted, 0.18 + 0.4 * act); g.lineWidth = 0.8; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke();
        if (act > 0.15) for (let j = 0; j < 2; j++) {
          const q = (t * 1.8 + j * 0.5 + x * 0.01) % 1, y = y0 + (y1 - y0) * q;
          glow(g, x, y, 4 * k, p.warn, 0.7 * act); g.fillStyle = `rgba(255,243,196,${act})`; g.beginPath(); g.arc(x, y, 1.3, 0, Math.PI * 2); g.fill();
        }
      }
      // 基底膜：場所ごとの色、奥ほど太い帯
      const pts: [number, number, number][] = [];
      for (let x = xb + 1; x <= xb + len * uEnd; x += 2) { const u = (x - xb) / len; pts.push([x, cy + disp(u), thick(u)]); }
      const grad = g.createLinearGradient(xb, 0, xb + len * uEnd, 0);
      colors.forEach((c, i) => grad.addColorStop(i / (colors.length - 1), rgba(c, 0.85)));
      g.beginPath();
      pts.forEach(([x, y, tw], i) => (i ? g.lineTo(x, y - tw) : g.moveTo(x, y - tw)));
      for (let i = pts.length - 1; i >= 0; i--) g.lineTo(pts[i][0], pts[i][1] + pts[i][2]);
      g.closePath(); g.fillStyle = grad; g.fill();
      // 有毛細胞：揺れの大きいところほど光る
      const peakX = xb + uc * len;
      glow(g, peakX, cy, h * 0.12, p.warn, 0.3 * env);
      for (let x = xb + 4; x <= xb + len * uEnd; x += 6 * k) {
        const u = (x - xb) / len, a = env * reach(u), y = cy + disp(u) - thick(u) - 2.6;
        g.fillStyle = rgba(p.muted, 0.4); g.beginPath(); g.arc(x, y, 1.4, 0, Math.PI * 2); g.fill();
        if (a > 0.08) { g.fillStyle = rgba(p.warn, a); g.beginPath(); g.arc(x, y, 1.4 + a * 1.2, 0, Math.PI * 2); g.fill(); }
      }
      // 渦巻きの上の今の場所
      const [mx, my] = spiral(uc);
      glow(g, mx, my, 10 * k, p.warn, 0.8 * env); g.fillStyle = rgba(p.warn, env); g.beginPath(); g.arc(mx, my, 2.6 * k, 0, Math.PI * 2); g.fill();
      // 右上の計器：今の音の波形
      drawPanel(g, px, py, pw, ph);
      const pc = PANEL_COLORS[ti];
      g.textAlign = "left"; g.font = font(fs + 2, 800); g.fillStyle = pc; g.fillText(`♪ ${tone.hz.toLocaleString("ja-JP")} Hz`, px + 10, py + fs + 6);
      const plotY = py + fs + 14, plotH = ph - fs - 22;
      g.save(); g.beginPath(); g.rect(px + 8, plotY, pw - 16, plotH); g.clip();
      g.strokeStyle = `rgba(${PANEL.grid},0.12)`; g.lineWidth = 1; g.beginPath();
      for (let x = px + 8; x < px + pw - 8; x += (pw - 16) / 8) { g.moveTo(Math.round(x) + 0.5, plotY); g.lineTo(Math.round(x) + 0.5, plotY + plotH); }
      g.moveTo(px + 8, plotY + plotH / 2); g.lineTo(px + pw - 8, plotY + plotH / 2); g.stroke();
      g.beginPath();
      for (let x = 0; x <= pw - 16; x += 1.5) { const y = plotY + plotH / 2 - Math.sin((x / (pw - 16)) * tone.cycles * Math.PI * 2 - t * 5) * plotH * 0.38 * env; g[x ? "lineTo" : "moveTo"](px + 8 + x, y); }
      g.strokeStyle = pc; g.globalAlpha = 0.25; g.lineWidth = 4; g.stroke(); g.globalAlpha = 1; g.lineWidth = 1.6; g.stroke();
      g.restore();
      // 名札（各回の初め）と、いまの説明
      drawTag(g, "基底膜：入口は狭くて硬く\n奥は広くて柔らかい", [w * 0.52, cy + Hb * 0.55], [[xb + len * 0.12, cy + 2], [xb + len * 0.85, cy + 3]], ti === 0 ? ramp(local, 0.2, 0.5) * (1 - ramp(local, 2.4, 2.8)) : 0, fs, p);
      drawSteps(g, 14, h - fs * 4.1 - 4, Math.min(w * 0.6, 250), TONES.map((x) => x.step), ti, still ? 1 : ramp(local, 0, 0.3), fs, p, true);
    };
  },
};
