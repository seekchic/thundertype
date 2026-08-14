// ============================================================
// bolt.js — 人工雷（放電経路）生成エンジン
//   骨格ポリライン → 電化（fractal / walk）→ 分岐 → 可変幅リボン(ポリゴン)
//   出力ポリゴンは SVG path と TTF contour で共用する
// ============================================================

const DEG = Math.PI / 180;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function cumLen(p) {
  const c = [0];
  for (let i = 1; i < p.length; i++) c[i] = c[i - 1] + dist(p[i - 1], p[i]);
  return c;
}

// 骨格が閉ループか（O・B の腹・8 など）。閉ならテーパーを切ってカウンターを作る
const isClosed = (p) => p.length > 3 && dist(p[0], p[p.length - 1]) < 0.5;

// ---- 中点変位法 --------------------------------------------
// 線分を半分に割り、中点だけを法線方向へ ±amp*長さ ずらす。これを depth 回。
// 元の頂点は動かないので、字形の角（=可読性の要所）が保たれる。
function displace(pts, depth, amp, decay, rnd) {
  let cur = pts.map((p) => [p[0], p[1]]);
  let a = amp;
  for (let d = 0; d < depth; d++) {
    const out = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const p = cur[i], q = cur[i + 1];
      const dx = q[0] - p[0], dy = q[1] - p[1];
      const L = Math.hypot(dx, dy) || 1;
      const off = (rnd() * 2 - 1) * a * L;
      out.push([(p[0] + q[0]) / 2 - (dy / L) * off, (p[1] + q[1]) / 2 + (dx / L) * off], q);
    }
    cur = out;
    a *= decay;
  }
  return cur;
}

// ---- 偏向ランダムウォーク（先駆放電の近似）------------------
// 目標点へ向かう単位ベクトルを毎歩 ±wander 度だけ回して進む
function walkPath(pts, o, rnd) {
  const step = Math.max(1.2, o.step);
  const out = [[pts[0][0], pts[0][1]]];
  let pos = out[0].slice();
  for (let ti = 1; ti < pts.length; ti++) {
    const tgt = pts[ti];
    let guard = 0;
    while (dist(pos, tgt) > step * 1.15 && guard++ < 500) {
      let dx = tgt[0] - pos[0], dy = tgt[1] - pos[1];
      const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      const ang = (rnd() * 2 - 1) * o.wander * DEG;
      const c = Math.cos(ang), s = Math.sin(ang);
      pos = [pos[0] + (dx * c - dy * s) * step, pos[1] + (dx * s + dy * c) * step];
      out.push(pos);
    }
    pos = [tgt[0], tgt[1]];
    out.push(pos);
  }
  return out;
}

// ---- Ramer–Douglas–Peucker 間引き ---------------------------
// 閉ループは始点=終点で基準線が退化し全点が捨てられるので、半分ずつ処理して繋ぐ
function simplify(pts, eps) {
  if (eps <= 0 || pts.length < 4) return pts;
  if (!isClosed(pts)) return rdp(pts, eps);
  const m = Math.floor(pts.length / 2);
  return rdp(pts.slice(0, m + 1), eps).concat(rdp(pts.slice(m), eps).slice(1));
}

function rdp(pts, eps) {
  if (eps <= 0 || pts.length < 3) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [x1, y1] = pts[s], [x2, y2] = pts[e];
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
    let best = -1, bi = -1;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((pts[i][0] - x1) * dy - (pts[i][1] - y1) * dx) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps) { keep[bi] = true; stack.push([s, bi], [bi, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// ---- 1D 値ノイズ（幹の太さ変調用）--------------------------
function hash1(i, s) {
  let h = Math.imul(i ^ s, 374761393);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x, s) {
  const i = Math.floor(x), f = x - i;
  const a = hash1(i, s), b = hash1(i + 1, s);
  return a + (b - a) * f * f * (3 - 2 * f);
}

// 3 オクターブ。0..1 でだいたい 0.5 中心
function fbm1(x, s) {
  return 0.57 * vnoise(x, s) + 0.29 * vnoise(x * 2.17, s + 17) + 0.14 * vnoise(x * 4.31, s + 91);
}

// ---- 平滑化した接線角 --------------------------------------
// ジグザグの局所接線ではなく「字画としての向き」を取る。
// 生の接線で筆幅コントラストを掛けると太さが高周波でバタつくため。
function smoothAngles(pts, cl, win) {
  const n = pts.length, out = new Array(n);
  const half = Math.max(0, win) / 2;
  let j = 0, k = 0;
  for (let i = 0; i < n; i++) {
    while (j < i && cl[i] - cl[j] > half) j++;
    while (k < n - 1 && cl[k] - cl[i] < half) k++;
    const a = j === k ? pts[Math.max(0, i - 1)] : pts[j];
    const b = j === k ? pts[Math.min(n - 1, i + 1)] : pts[k];
    out[i] = Math.atan2(b[1] - a[1], b[0] - a[0]);
  }
  return out;
}

// ---- 端点が他の画に接しているか ----------------------------
// 自由端だけを尖らせるための判定。H の横棒や T の縦棒のように他の画へ
// 突き当たる端まで尖らせると、接合部が細って字が弱くなる。
function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-9) return dist(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

function isFreeEnd(p, strokes, self, tol) {
  for (let j = 0; j < strokes.length; j++) {
    if (j === self) continue;
    const s = strokes[j];
    for (let i = 0; i < s.length - 1; i++) {
      if (distToSeg(p, s[i], s[i + 1]) < tol) return false;
    }
  }
  return true;
}

// ---- 経路上の点と接線 --------------------------------------
function sampleAt(pts, cl, t) {
  const target = cl[cl.length - 1] * t;
  let i = 1;
  while (i < cl.length - 1 && cl[i] < target) i++;
  const seg = cl[i] - cl[i - 1] || 1;
  const f = (target - cl[i - 1]) / seg;
  const a = pts[i - 1], b = pts[i];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const m = Math.hypot(dx, dy) || 1;
  return { p: [a[0] + dx * f, a[1] + dy * f], tx: dx / m, ty: dy / m };
}

// ---- 分岐（再帰）------------------------------------------
// 幹の途中から枝を出し、枝からさらに枝を出す。世代ごとに短く・細くなる。
function branchesOf(spine, o, rnd, gen, out) {
  if (gen >= o.branchGen || o.branchDensity <= 0) return;
  const cl = cumLen(spine);
  const total = cl[cl.length - 1];
  if (total < 6) return;

  const raw = (total / 100) * o.branchDensity * Math.pow(0.75, gen);
  let n = Math.floor(raw) + (rnd() < raw % 1 ? 1 : 0);

  for (let i = 0; i < n; i++) {
    const { p, tx, ty } = sampleAt(spine, cl, 0.08 + rnd() * 0.86);
    const side = rnd() < 0.5 ? 1 : -1;
    const ang = side * o.branchAngle * (0.5 + rnd() * 0.9) * DEG;
    let dx = tx * Math.cos(ang) - ty * Math.sin(ang);
    let dy = tx * Math.sin(ang) + ty * Math.cos(ang);
    dy += o.fall;                                  // 落下（重力/主放電方向）バイアス
    if (o.sweep > 0) { dx += tx * o.sweep * 1.8; dy += ty * o.sweep * 1.8; } // 後退角
    const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;

    const L = o.branchLen * 100 * (0.35 + rnd() * 1.15) * Math.pow(0.6, gen);
    if (L < 3) continue;

    let seg = [[p[0], p[1]], [p[0] + dx * L, p[1] + dy * L]];
    seg = displace(seg, Math.max(1, o.depth - 1), o.rough * 1.6, o.decay, rnd);
    if (o.simplify > 0) seg = simplify(seg, o.simplify);

    const w = o.stem * Math.pow(o.branchWidth, gen + 1);
    out.push({ line: seg, w0: w, w1: 0, kind: 'branch', gen });
    branchesOf(seg, o, rnd, gen + 1, out);
  }
}

// ---- 可変幅リボン → ポリゴン -------------------------------
// 中心線を左右にオフセットして 1 本の輪郭にする。
// 閉じた中心線ならリング状（外周＋内周が0幅のスリットで繋がる）＝カウンターになる。
// 太さは 3 段掛け: テーパー(w0→w1) × 筆幅コントラスト(角度) × ノイズ変動(弧長)
function ribbon(pts, cfg) {
  const n = pts.length;
  if (n < 2) return [];
  const closed = isClosed(pts);
  const cl = cumLen(pts);
  const total = cl[n - 1] || 1;
  const ang = cfg.contrast > 0 ? smoothAngles(pts, cl, cfg.smooth) : null;
  const pen = cfg.penAngle * DEG;

  // 先端の絞り長は「その端の実際の太さ」に比例させる。固定長のままだと、
  // 筆幅コントラストで既に細い横画（E の腕・5 と 7 の頭・2 の台）が
  // 6:1 の長い針になって痩せて見える
  const cfAt = (i) => (ang
    ? (1 - cfg.contrast) + cfg.contrast * Math.abs(Math.sin(ang[i] - pen))
    : 1);
  const span = total * (cfg.tipA && cfg.tipB ? 0.3 : 0.5);
  const TIP_RATIO = 4.5;      // 太さの何倍まで絞るか
  const limA = Math.min(cfg.tipLen, span, TIP_RATIO * cfg.w0 * cfAt(0));
  const limB = Math.min(cfg.tipLen, span, TIP_RATIO * cfg.w1 * cfAt(n - 1));
  const L = [], R = [];
  for (let i = 0; i < n; i++) {
    // 接線は前後の点差分。閉じた線なら継ぎ目で巻き込んで折れを消す
    let a, b;
    if (i === 0) { a = closed ? pts[n - 2] : pts[0]; b = pts[1]; }
    else if (i === n - 1) { a = pts[n - 2]; b = closed ? pts[1] : pts[n - 1]; }
    else { a = pts[i - 1]; b = pts[i + 1]; }
    const ax = b[0] - a[0], ay = b[1] - a[1];
    const m = Math.hypot(ax, ay) || 1;
    const nx = -ay / m, ny = ax / m;
    const t = cl[i] / total;
    // 公称幅（先端 0 に収束させたい枝のため、変調は倍率として掛ける）
    let nominal = cfg.w0 + (cfg.w1 - cfg.w0) * Math.pow(t, cfg.pow);
    // 自由端を尖らせる。1.3 乗で細長い針状にする（1 未満だと鈍い円錐になる）
    if (cfg.tipLen > 0 && (cfg.tipA || cfg.tipB)) {
      let f = 1;
      if (cfg.tipA && limA > 0 && cl[i] < limA) f = Math.min(f, Math.pow(cl[i] / limA, 1.3));
      if (cfg.tipB && limB > 0 && total - cl[i] < limB) {
        f = Math.min(f, Math.pow((total - cl[i]) / limB, 1.3));
      }
      nominal *= f;
    }
    // 平筆: 筆の縁と画の向きが平行なら細く、直交なら太く
    const cf = ang
      ? (1 - cfg.contrast) + cfg.contrast * Math.abs(Math.sin(ang[i] - pen))
      : 1;
    let mod = cf;
    if (cfg.wobble > 0) {
      // 変動幅を cf でスケールする。掛け算のままだと細い画でノイズが谷に入った瞬間に
      // 線が消えて字が途切れる（S や E の横画で顕著）
      const nz = fbm1(cl[i] * cfg.wobbleScale, cfg.seed) * 2 - 1;
      mod *= 1 + cfg.wobble * nz * (0.35 + 0.65 * cf);
    }
    const w = (nominal * Math.max(0.2, mod)) / 2;
    L.push([pts[i][0] + nx * w, pts[i][1] + ny * w]);
    R.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
  }
  return L.concat(R.reverse());
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

// 先端テーパーは弧長方向に効くので、点が 2 個しかない直線は「両端」しか無く
// 全ての点の幅が 0 になって線ごと消える（電化しない設定で H・T・N などが消えた）。
// 内側に点を入れて胴を持たせる
function ensureBody(pts, min = 9) {
  if (pts.length >= min || pts.length < 2) return pts;
  const k = Math.ceil((min - 1) / (pts.length - 1));
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    for (let j = 1; j <= k; j++) {
      out.push([a[0] + (b[0] - a[0]) * (j / k), a[1] + (b[1] - a[1]) * (j / k)]);
    }
  }
  return out;
}

// ---- 骨格ストローク群 → 雷 ---------------------------------
// 戻り値: [{ poly, line, kind, gen }]
// poly は全て同一巻き方向に揃える（nonzero で和集合になり、重なりが穴にならない）
function buildBolt(strokes, o, seed) {
  const rnd = mulberry32(seed);
  const parts = [];

  strokes.forEach((s, si) => {
    const closed = isClosed(s);
    const tol = o.stem * 0.9;
    const tipA = !closed && o.tipLen > 0 && isFreeEnd(s[0], strokes, si, tol);
    const tipB = !closed && o.tipLen > 0 && isFreeEnd(s[s.length - 1], strokes, si, tol);
    let sp = s.map((p) => [p[0], p[1]]);
    if (o.growth === 'walk') sp = walkPath(sp, o, rnd);
    else if (o.growth === 'fractal') sp = displace(sp, o.depth, o.rough, o.decay, rnd);
    if (o.simplify > 0) sp = simplify(sp, o.simplify);
    sp = ensureBody(sp);          // 間引き後に入れる。RDP は直線を 2 点に戻すため
    if (closed) sp[sp.length - 1] = [sp[0][0], sp[0][1]];

    parts.push({
      line: sp, w0: o.stem, w1: closed ? o.stem : o.stem * o.taper,
      kind: 'main', gen: -1, tipA, tipB,
    });
    branchesOf(sp, o, rnd, 0, parts);
  });

  return parts.map((p, idx) => {
    let poly = ribbon(p.line, {
      w0: p.w0, w1: p.w1, pow: p.kind === 'main' ? 1.4 : 0.75,
      contrast: o.contrast, penAngle: o.penAngle, smooth: o.smooth,
      tipA: p.tipA, tipB: p.tipB, tipLen: o.tipLen,
      // 枝は細いので変動は控えめに（同じ振幅だと途中で消える）
      wobble: p.kind === 'main' ? o.wobble : o.wobble * 0.6,
      wobbleScale: o.wobbleScale,
      seed: (seed + idx * 7919) | 0,
    });
    if (signedArea(poly) < 0) poly = poly.reverse();
    return { poly, line: p.line, kind: p.kind, gen: p.gen };
  });
}
