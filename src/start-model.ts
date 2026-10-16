// スタート画面のモデル「キネシン」：小胞を背負ったキネシンが、微小管の上を2つの頭で交互に歩く。
// 前の頭に ATP が入るとネックリンカーが前へ倒れ、後ろの頭が前の頭を追い越して 16 nm 先のβチューブリンに着く
// （重心は 1歩 8 nm）。着いたあと、後ろになった頭からリン酸が離れる。奥の微小管は向きが逆なので、逆向きに歩く。
// 色は CSS 変数から読むので、ライト／ダークの切り替えに追従する。動きを減らす設定では、歩いている途中の1枚だけを描く。

const STEP = 22;              // 8 nm（チューブリン二量体1つ分）を何 px で描くか
const BEAD = STEP / 2;        // α・βチューブリン1つ分
const PERIOD = 0.5;           // 1歩にかける秒数（実物は約 0.01 秒。見えるように遅くしている）
const DWELL = 0.42;           // 1歩のうち、両方の頭が付いて止まっている割合
const LEAD = STEP * 6;        // 画面の左外から歩いて入ってくる距離
const CARGO_R = 24;
const BACK_SCALE = 0.55;

interface Palette { head: string; cargo: string; track: string; trackDark: string; atp: string; ink: string }
interface Spring { x: number; y: number; vx: number; vy: number; ready: boolean }

function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
  return {
    head: v("--brand", "#147d8f"), cargo: v("--brand2", "#1f6feb"), track: v("--line", "#e2e7f6"),
    trackDark: v("--muted", "#5b6488"), atp: v("--gold", "#d99a00"), ink: v("--text", "#141931"),
  };
}

const ease = (x: number): number => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);

function dot(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;
}

// 微小管の側面：3本のプロトフィラメントを、らせんのずれを付けて並べる。奇数番目がβチューブリン。
function drawTrack(g: CanvasRenderingContext2D, width: number, y: number, p: Palette): void {
  for (let row = 0; row < 3; row++) {
    const shift = (row * BEAD) / 3;
    for (let k = -2; k * BEAD < width + BEAD * 2; k++) {
      const beta = k % 2 !== 0;
      dot(g, k * BEAD + shift, y + row * 9, BEAD * 0.47, beta ? p.trackDark : p.track, beta ? 0.45 : 0.95);
    }
  }
}

// 時刻 t の歩き方。center は2つの頭の中点。両方の頭が付いている間、頭はβチューブリンの真上にある。
function pose(t: number, span: number, offset: number) {
  const n = Math.floor(t / PERIOD), f = t / PERIOD - n;
  const e = f < DWELL ? 0 : ease((f - DWELL) / (1 - DWELL));
  const center = ((STEP * (n + e) + offset) % span) - LEAD;
  return { f, e, center, moving: center - BEAD + STEP * e, bound: center + BEAD - STEP * e, lift: Math.sin(Math.PI * e) * 20 };
}

function drawWalker(g: CanvasRenderingContext2D, t: number, span: number, offset: number, trackY: number, s: Spring, dt: number, p: Palette): void {
  const { f, e, center, moving, bound, lift } = pose(t, span, offset);
  const headY = trackY - BEAD * 0.47 - 6;
  const joint = { x: center, y: headY - 18 - lift * 0.25 };

  // 小胞はバネでつないで、歩くたびに少し遅れて揺れる。画面の端で折り返したら一緒に移す。
  const tx = center, ty = trackY - 74;
  if (!s.ready) Object.assign(s, { x: tx, y: ty, vx: 0, vy: 0, ready: true });
  if (Math.abs(tx - s.x) > span / 2) s.x += Math.sign(tx - s.x) * span;
  s.vx += (60 * (tx - s.x) - 9 * s.vx) * dt; s.vy += (60 * (ty - s.y) - 9 * s.vy) * dt;
  s.x += s.vx * dt; s.y += s.vy * dt;

  // ストーク（コイルドコイル）：2本の鎖が巻き合うように描く
  g.lineWidth = 1.6; g.strokeStyle = p.head;
  for (const phase of [0, Math.PI]) {
    g.beginPath();
    for (let i = 0; i <= 16; i++) {
      const k = i / 16, x = joint.x + (s.x - joint.x) * k, y = joint.y + (s.y + CARGO_R - 2 - joint.y) * k;
      const w = Math.sin(k * 11 + phase) * 1.8;
      if (i) g.lineTo(x + w, y); else g.moveTo(x + w, y);
    }
    g.stroke();
  }
  // 頭とネックリンカー。動いている頭は、付いている頭の向こう側を通るので薄く描く。
  const heads = [{ x: moving, y: headY - lift, alpha: e > 0 ? 0.7 : 1 }, { x: bound, y: headY, alpha: 1 }];
  g.lineWidth = 2.4;
  for (const h of heads) {
    g.globalAlpha = h.alpha; g.strokeStyle = p.head;
    g.beginPath(); g.moveTo(h.x, h.y - 4); g.quadraticCurveTo((h.x + joint.x) / 2, joint.y + 2, joint.x, joint.y); g.stroke();
    g.fillStyle = p.head; g.beginPath(); g.ellipse(h.x, h.y, 9, 6.5, 0, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
  }
  // ATP が前の頭に入る（踏み出す直前）／着いたあと、後ろの頭からリン酸が離れる
  if (f > DWELL - 0.18 && f < DWELL) {
    const k = (f - DWELL + 0.18) / 0.18;
    dot(g, bound + 18 * (1 - k), headY - 24 * (1 - k), 3.2, p.atp, k);
  }
  if (f < 0.24) {
    const k = f / 0.24;
    dot(g, moving - 4 - 10 * k, headY - 6 - 22 * k, 2.4, p.atp, 0.8 * (1 - k));
  }
  // 小胞（中の小さな粒は運んでいる物質）
  dot(g, s.x, s.y, CARGO_R, p.cargo, 0.16);
  g.lineWidth = 2; g.strokeStyle = p.cargo; g.globalAlpha = 0.75;
  g.beginPath(); g.arc(s.x, s.y, CARGO_R, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05 + t * 0.4, r = 8 + (i % 3) * 3.5;
    dot(g, s.x + Math.cos(a) * r, s.y + Math.sin(a) * r, 2.2, p.cargo, 0.7);
  }
}

// スタート画面を描いたあとに呼ぶ。戻り値の関数で止める（画面を閉じるとき）。
export function mountKinesin(canvas: HTMLCanvasElement): () => void {
  const g = canvas.getContext("2d");
  if (!g) return () => {};
  const bg = document.createElement("canvas");
  const front: Spring = { x: 0, y: 0, vx: 0, vy: 0, ready: false };
  const back: Spring = { x: 0, y: 0, vx: 0, vy: 0, ready: false };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let palette = readPalette(), width = 0, height = 0, t = 0, last = 0, raf = 0, frames = 0, stopped = false;

  const layout = () => ({ frontY: height * 0.8, backY: height * 0.36, span: Math.ceil((width + LEAD * 2) / (STEP * 2)) * STEP * 2 });
  const renderTracks = () => {
    const b = bg.getContext("2d"); if (!b) return;
    const dpr = Math.min(2, devicePixelRatio || 1), { frontY, backY } = layout();
    bg.width = canvas.width; bg.height = canvas.height;
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 奥の微小管は左右を反転して小さく描く（向きが逆なので、キネシンは左へ歩く）
    b.save(); b.translate(width, backY); b.scale(-BACK_SCALE, BACK_SCALE); b.globalAlpha = 0.45;
    drawTrack(b, width / BACK_SCALE, 0, palette); b.restore();
    drawTrack(b, width, frontY, palette);
  };
  const draw = (dt: number) => {
    const dpr = Math.min(2, devicePixelRatio || 1), { frontY, backY, span } = layout();
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); g.drawImage(bg, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 細胞質に浮かぶ小さな粒
    for (let i = 0; i < 16; i++) {
      const x = ((i * 97.3 + t * (4 + (i % 5))) % (width + 40)) - 20, y = ((i * 53.7) % height) + Math.sin(t * 0.7 + i) * 4;
      dot(g, x, y, 1.5 + (i % 3), palette.trackDark, 0.12);
    }
    g.save(); g.translate(width, backY); g.scale(-BACK_SCALE, BACK_SCALE); g.globalAlpha = 0.5;
    // 開いた瞬間から画面の中にいるよう、手前は左から3割、奥は5割あたりから歩き始める（STEP の倍数でずらす）
    const backWidth = width / BACK_SCALE, backSpan = Math.ceil((backWidth + LEAD * 2) / (STEP * 2)) * STEP * 2;
    const start = (w: number, at: number): number => LEAD + Math.round((w * at) / STEP) * STEP;
    drawWalker(g, t * 0.8, backSpan, start(backWidth, 0.5), 0, back, dt, palette); g.restore();
    drawWalker(g, t, span, start(width, 0.3), frontY, front, dt, palette);
  };
  const resize = () => {
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (!rect.width || !rect.height) return;
    width = rect.width; height = rect.height;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    front.ready = back.ready = false;
    renderTracks();
    if (reduce) { t = PERIOD * (DWELL + 0.55); draw(0); }
  };
  const tick = (now: number) => {
    if (stopped) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    if (width && document.visibilityState === "visible") {
      // ライト／ダークの切り替えに追従する（色の読み直しは1秒に1回程度で足りる）
      if (++frames % 60 === 0) {
        const next = readPalette();
        if (JSON.stringify(next) !== JSON.stringify(palette)) { palette = next; renderTracks(); }
      }
      t += dt; draw(dt);
    }
    raf = requestAnimationFrame(tick);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  if (!reduce) raf = requestAnimationFrame(tick);
  return () => { stopped = true; cancelAnimationFrame(raf); observer.disconnect(); };
}
