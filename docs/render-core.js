// ============================================================
// render-core.js — 骨格 → 稲妻の描画プリミティブ（DOM 非依存）
//   作品（docs/index.html）と frames.html（応募フレーム生成）の共有部分。
//   すべて p（パラメータ）を引数で受ける。呼び出し側の状態に触れない
// ============================================================

const H = 100;
const SET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

// 気象が決めないパラメータ（本体の Volt プリセット相当・やや細め）
const BASE = {
  growth: 'fractal', decay: 0.62, step: 6, wander: 34,
  stem: 0.056, taper: 0.72, simplify: 0.25,
  contrast: 0.56, penAngle: 14, smooth: 14, wobbleScale: 0.07,
  // 自由端の尖りは控えめに。強いと終筆が細い毛のように飛び出して、
  // 静かな日にはデザインではなく事故に見える
  tipLen: 0.1, sweep: 0.25, branchWidth: 0.5, fall: 0.25,
  widthRatio: 0.8, tracking: 0.22, blurSmall: 2.4, glow: true,
  // 取得前の静かな状態
  depth: 3, rough: 0.03, branchDensity: 0.3, branchGen: 0, branchLen: 0.12,
  branchAngle: 30, wobble: 0.15, glowAmt: 0.5, spread: 1, blurBig: 6, slant: 4,
  core: '#ffffff', glow1: '#7fb2ff', glow2: '#3d4cff', bg: '#05060a',
};

// ---- ジオメトリ / 描画 --------------------------------------
// p を引数で受ける。カレンダーでは 1 日ごとに違うパラメータで描くため
function optsOf(p) {
  return {
    growth: p.growth, depth: p.depth, rough: p.rough, decay: p.decay,
    step: p.step, wander: p.wander,
    stem: H * p.stem, taper: p.taper, simplify: p.simplify,
    contrast: p.contrast, penAngle: p.penAngle, smooth: p.smooth,
    wobble: p.wobble, wobbleScale: p.wobbleScale,
    tipLen: H * p.tipLen, sweep: p.sweep,
    branchDensity: p.branchDensity, branchAngle: p.branchAngle, branchLen: p.branchLen,
    branchGen: p.branchGen, branchWidth: p.branchWidth, fall: p.fall,
  };
}

const seedOf = (p, ch, i) => (p.seed * 2654435761 + ch.charCodeAt(0) * 8191 + i * 131) | 0;

function glyphOf(ch, i, p = P) {
  const g = GLYPHS[ch];
  const box = H * p.widthRatio * (g ? g.w : 0.5);
  if (!g) return { parts: [], box };
  const strokes = g.s.map((s) => s.map(([x, y]) => [x * box, y * H]));
  const parts = buildBolt(strokes, optsOf(p), seedOf(p, ch, i));
  if (p.slant) {
    const k = Math.tan((p.slant * Math.PI) / 180);
    parts.forEach((q) => { q.poly = q.poly.map(([x, y]) => [x + (H - y) * k, y]); });
  }
  return { parts, box };
}

const toPath = (pts) =>
  'M' + pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L') + 'Z';

const pathsOf = (parts) => parts.map((q) => `<path d="${toPath(q.poly)}"/>`).join('');

// ぼかしはフィルタ共有。1 日ごとに filter を作ると 60 個以上になって重い。
// sfx は別 SVG（カーソルの軌跡）と id が衝突しないようにするための接尾辞
function filters(big, small, sfx = '') {
  return `<filter id="fb${sfx}" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="${big}"/></filter>
    <filter id="fs${sfx}" x="-25%" y="-25%" width="150%" height="150%">
      <feGaussianBlur stdDeviation="${small}"/></filter>`;
}

function layered(body, p = P, sfx = '') {
  const sw = (m) => `stroke-width="${(p.spread * m).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round"`;
  return `
    <g fill="${p.glow2}" stroke="${p.glow2}" ${sw(2.4)} filter="url(#fb${sfx})"
       opacity="${Math.min(1, 0.5 * p.glowAmt).toFixed(2)}" fill-rule="nonzero">${body}</g>
    <g fill="${p.glow1}" stroke="${p.glow1}" ${sw(0.9)} filter="url(#fs${sfx})"
       opacity="${Math.min(1, 0.85 * p.glowAmt).toFixed(2)}" fill-rule="nonzero">${body}</g>
    <g fill="${p.core}" fill-rule="nonzero">${body}</g>`;
}

// ---- 1 行レイアウト -----------------------------------------
// tabular=true は時計用。字ごとの幅で詰めると秒が変わるたびに行幅が動いて
// 中央揃えがガタつくので、桁を固定スロットに入れる
function layoutLine(text, p, idBase, tabular) {
  const track = H * p.tracking;
  const slot = H * p.widthRatio * 0.92;
  let x = 0, body = '';
  [...text].forEach((ch, i) => {
    if (ch === ' ') { x += slot * 0.5 + track; return; }
    const digit = !tabular || /[0-9A-Z]/.test(ch);
    // 時計の区切り記号は「点」として読ませたい。コロンの点は骨格で 10 単位しかないのに
    // 枝は 12 単位あるので、そのまま電化すると片方だけ目立って中心がずれて見える
    const gp = digit ? p
      : { ...p, branchDensity: 0, branchGen: 0, tipLen: 0, rough: p.rough * 0.35, wobble: 0 };
    const { parts, box } = glyphOf(ch, idBase + i, gp);
    if (tabular) {
      const w = digit ? slot : slot * 0.45;
      // 骨格の ':' は y 0.4〜1.0 と下寄せ（本来の欧文コロン）なので数字の中心とずれる。
      // オフセットは電化後のインクではなく**骨格**から出す。インクだと枝の乱数が混ざって
      // コロンごとに違う量ずれてしまう
      let dy = 0;
      if (!digit) {
        const sk = GLYPHS[ch];
        let y0 = Infinity, y1 = -Infinity;
        if (sk) sk.s.forEach((st) => st.forEach(([, yy]) => {
          if (yy < y0) y0 = yy;
          if (yy > y1) y1 = yy;
        }));
        if (y0 < y1) dy = H / 2 - ((y0 + y1) / 2) * H;
      }
      body += `<g transform="translate(${(x + (w - box) / 2).toFixed(2)},${dy.toFixed(2)})">`
        + `${pathsOf(parts)}</g>`;
      x += w + track;
    } else {
      body += `<g transform="translate(${x.toFixed(2)},0)">${pathsOf(parts)}</g>`;
      x += box + track;
    }
  });
  return { body, width: Math.max(x - track, 1) };
}

const paramsFor = (w, ds) => ({ ...BASE, ...weatherToParams(w), seed: seedFor(ds, city) });

// 文字を格子に組む。列数の決め方は呼び出し側（表示領域に依存するため）
function gridBody(chars, cols, p, idBase = 0) {
  const cw = H * p.widthRatio * 1.1 + H * 0.6;
  const chh = H + H * 0.72;
  let body = '';
  chars.forEach((ch, i) => {
    const { parts, box } = glyphOf(ch, idBase + i, p);
    const x = (i % cols) * cw + (cw - box) / 2;
    const y = Math.floor(i / cols) * chh + H * 0.36;
    body += `<g transform="translate(${x.toFixed(2)},${y.toFixed(2)})">${pathsOf(parts)}</g>`;
  });
  return { body, w: cols * cw, h: Math.ceil(chars.length / cols) * chh };
}
