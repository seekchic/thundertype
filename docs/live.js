// ============================================================
// live.js — Thunder Type（単体ページ）
//   選べるのは地点と日付だけ。字形は全部その日の気象から決まる。
//   SPECIMEN = その日の全字 / CALENDAR = 1 か月分の A を並べて雷の強さを俯瞰する
//   エンジン(bolt.js)・骨格(glyphs.js)・気象写像(weather-core.js) は index.html と共有
// ============================================================

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];


let P = { ...BASE };          // 選択中の日のパラメータ（BASE は render-core.js）
let city = CITIES[0];
let date = todayStr();
let lastW = null;
let month = null;             // { ym, source, days:Map<date,w>, params:Map<date,P> }
let VIEW = 'specimen';
let seq = 0;
let busy = false;







// 帰還雷撃 = 全字が同時に立ち上がり、多重雷撃でばたついて減衰する
function strikeStyle(sid) {
  return `<style>
    #${sid} .all { animation: ${sid}b .78s linear both; }
    @keyframes ${sid}b {
      0%{opacity:0;filter:brightness(3.4)} 2%{opacity:1;filter:brightness(3.4)}
      7%{opacity:1;filter:brightness(2.0)} 9%{opacity:.10}
      12%{opacity:1;filter:brightness(2.9)} 17%{opacity:1} 19%{opacity:.18}
      22%{opacity:1;filter:brightness(2.3)} 31%{opacity:1;filter:brightness(1.35)}
      34%{opacity:.42} 37%{opacity:1;filter:brightness(1.6)}
      56%{opacity:1;filter:brightness(1)} 61%{opacity:.72} 65%{opacity:1}
      100%{opacity:1;filter:brightness(1)}
    }
  </style>`;
}


// ---- SPECIMEN ----------------------------------------------
const cellW = () => H * P.widthRatio * 1.1 + H * 0.6;
const cellH = () => H + H * 0.72;

// 幅だけで列数を決めると縦長の画面で 4 列 9 行になってはみ出す。
// 36 字は 4/6/9/12 で割り切れるので、表示領域の縦横比に一番近い形を選ぶ
function colsFor() {
  const m = document.querySelector('main');
  const cs = getComputedStyle(m);
  const w = m.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const h = m.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const target = Math.max(0.2, w / Math.max(1, h));
  let best = 9, diff = Infinity;
  [4, 6, 9, 12].forEach((c) => {
    const a = (c * cellW()) / (Math.ceil(SET.length / c) * cellH());
    const d = Math.abs(Math.log(a / target));
    if (d < diff) { diff = d; best = c; }
  });
  return best;
}

function specimenSvg(animate) {
  const cols = colsFor();
  const rows = Math.ceil(SET.length / cols);
  const pad = H * 0.3;
  const cw = cellW(), chh = cellH();
  let body = '';
  SET.forEach((ch, i) => {
    const { parts, box } = glyphOf(ch, i);
    const x = (i % cols) * cw + (cw - box) / 2;
    const y = Math.floor(i / cols) * chh + pad * 1.2;
    body += `<g transform="translate(${x.toFixed(2)},${y.toFixed(2)})">${pathsOf(parts)}</g>`;
  });
  const sid = `sk${seq}`;
  return `<svg id="${sid}" xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 ${(cols * cw).toFixed(1)} ${(rows * chh).toFixed(1)}">
    ${animate ? strikeStyle(sid) : ''}
    <defs>${filters(P.blurBig, P.blurSmall)}</defs>
    <g class="all">${layered(body)}</g>
  </svg>`;
}

// ---- CALENDAR ----------------------------------------------
const CW = 150, CH = 172, HEAD = 34;

function calendarSvg(animate) {
  const ym = date.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const last = daysInMonth(ym);
  const firstDow = new Date(y, m - 1, 1).getDay();
  const rows = Math.ceil((firstDow + last) / 7);
  const days = month && month.ym === ym ? month.params : new Map();

  // ぼかしは月内の平均で共有する
  let bb = 0, bs = 0, n = 0;
  days.forEach((p) => { bb += p.blurBig; bs += p.blurSmall; n++; });
  bb = n ? bb / n : P.blurBig;
  bs = n ? bs / n : P.blurSmall;

  let head = '';
  DOW.forEach((d, i) => {
    head += `<text x="${(i * CW + CW / 2).toFixed(1)}" y="20" text-anchor="middle"
      font-family="ui-monospace,monospace" font-size="15" letter-spacing="2"
      fill="#e8ecf3" opacity=".3">${d}</text>`;
  });

  let body = '', chrome = '';
  for (let d = 1; d <= last; d++) {
    const idx = firstDow + d - 1;
    const cx = (idx % 7) * CW;
    const cy = HEAD + Math.floor(idx / 7) * CH;
    const ds = `${ym}-${String(d).padStart(2, '0')}`;
    const p = days.get(ds);

    chrome += `<g class="cell" data-date="${ds}" style="cursor:pointer">
      <rect x="${cx}" y="${cy}" width="${CW}" height="${CH}" fill="transparent"/>
      <text x="${cx + 11}" y="${cy + 22}" font-family="ui-monospace,monospace" font-size="14"
        fill="#e8ecf3" opacity="${ds === date ? '.95' : '.32'}">${String(d).padStart(2, '0')}</text>
      ${ds === date ? `<rect x="${cx + 3}" y="${cy + 3}" width="${CW - 6}" height="${CH - 6}"
        fill="none" stroke="#e8ecf3" stroke-opacity=".35" stroke-width="1.5"/>` : ''}
    </g>`;

    if (!p) continue;
    const { parts, box } = glyphOf('A', d, p);
    const gx = cx + (CW - box) / 2;
    const gy = cy + 40;
    body += `<g>${layered(`<g transform="translate(${gx.toFixed(1)},${gy.toFixed(1)})">`
      + `${pathsOf(parts)}</g>`, p)}</g>`;
  }

  const sid = `sk${seq}`;
  return `<svg id="${sid}" xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 ${7 * CW} ${HEAD + rows * CH}">
    ${animate ? strikeStyle(sid) : ''}
    <defs>${filters(bb, bs)}</defs>
    ${head}
    <g class="all">${body}</g>
    ${chrome}
  </svg>`;
}

// ---- 描画 ---------------------------------------------------
const $ = (id) => document.getElementById(id);

function paint(animate) {
  if (animate) seq++;
  const el = $('sheet');
  el.innerHTML = VIEW === 'calendar' ? calendarSvg(animate) : specimenSvg(animate);
  // 幅 100% だけだと縦にはみ出すので、残りの高さからも上限をかける
  const m = document.querySelector('main');
  const cs = getComputedStyle(m);
  const availH = m.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const vb = el.querySelector('svg').viewBox.baseVal;
  el.style.maxWidth = `${Math.round(availH * (vb.width / vb.height))}px`;
  document.body.style.background = P.bg;

  if (VIEW === 'calendar') {
    el.querySelector('svg').onclick = (e) => {
      const cell = e.target.closest('[data-date]');
      if (!cell) return;
      date = cell.dataset.date;
      $('date').value = date;
      setView('specimen');
      load();
    };
  }
  if (!animate) return;
  // 閃光は SVG の中ではなく画面全体に敷く。SVG 内だと標本の矩形だけが光って
  // 「四角い板が光った」ように見え、周囲が照らされる感じにならない
  const fl = $('flash');
  fl.style.background = P.glow1;
  fl.classList.remove('on');
  void fl.offsetWidth;
  fl.classList.add('on');
}

// ---- イントロ（ホーム画面）----------------------------------
// 都市 / 時刻 / 日付を稲妻で組む。時計は生きていて、秒が変わった桁だけ
// 新しい放電で引き直され、分が変わると全体が落雷する
let introOn = true;
let strikeTimer = 0;
let ambientTimer = 0;

// 選択中の都市のローカル時刻。閲覧者の時計ではなく現地の時計を出す
const cityTime = () => new Intl.DateTimeFormat('en-GB', {
  timeZone: city.tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(new Date());

const INTRO_LINES = [
  { key: 'city', scale: 0.3 },
  { key: 'time', scale: 1 },
  { key: 'date', scale: 0.3 },
];
const INTRO_GAP = H * 0.42;

const introText = (key) =>
  (key === 'city' ? (city.roman || 'TOKYO') : key === 'time' ? cityTime() : date);

// 小さい行は枝を間引く。縮小して置くと、字の大きさに対して枝の密度が
// そのまま残るので、荒れた日に都市名や日付が枝に埋もれて読めなくなる
// 大きい行は字間を詰める。巨大な字を詰めて組むほど画面を圧して見える
const forLine = (p, scale) => (scale >= 0.5 ? { ...p, tracking: p.tracking * 0.34 } : {
  ...p,
  tracking: p.tracking * 1.6,      // 小さい行は逆に開いてラベルらしくする
  branchDensity: p.branchDensity * 0.3,
  branchGen: Math.min(p.branchGen, 1),
  branchLen: p.branchLen * 0.6,
  rough: p.rough * 0.7,
});

function introSvg(animate) {
  const p = P;
  const laid = INTRO_LINES.map((l, i) => ({
    ...l,
    lp: forLine(p, l.scale),
    ...layoutLine(introText(l.key), forLine(p, l.scale), i * 811 + 17, l.key === 'time'),
  }));
  const W = Math.max(...laid.map((l) => l.width * l.scale));
  const Ht = laid.reduce((s, l) => s + H * l.scale, 0) + INTRO_GAP * (laid.length - 1);

  let y = 0, body = '';
  laid.forEach((l) => {
    const x = (W - l.width * l.scale) / 2;
    const inner = `<g transform="translate(${x.toFixed(2)},${y.toFixed(2)}) scale(${l.scale})">`
      + `${layered(l.body, l.lp)}</g>`;
    body += l.key === 'time' ? `<g id="introTime">${inner}</g>` : inner;
    y += H * l.scale + INTRO_GAP;
  });

  const sid = `in${seq}`;
  const pad = H * 0.5;
  return `<svg id="${sid}" xmlns="http://www.w3.org/2000/svg"
      viewBox="${-pad} ${-pad} ${(W + pad * 2).toFixed(1)} ${(Ht + pad * 2).toFixed(1)}">
    ${animate ? strikeStyle(sid) : ''}
    <defs>${filters(p.blurBig, p.blurSmall)}</defs>
    <g class="all">${body}</g>
  </svg>`;
}

const restart = (el, cls) => {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
};

function paintIntro(animate) {
  if (!introOn) return;
  if (animate) seq++;
  $('introArt').innerHTML = introSvg(animate);
  $('intro').style.background = P.bg;
  if (!animate) return;
  paintBolts();                     // 落雷ごとに新しい雷を引き直す
  $('introFlash').style.background = P.glow1;
  restart($('introFlash'), 'on');
  restart($('introBlast'), 'on');   // 白の瞬間的なカット
  restart($('introArt'), 'punch');  // 寄り→揺れ
  scheduleStrike();
}

// 落雷は「ときどき」。等間隔だと機械的に見えるし、毎分だと目が休まらない
function scheduleStrike() {
  clearTimeout(strikeTimer);
  strikeTimer = setTimeout(() => {
    if (!introOn) return;
    paintIntro(true);               // 中で次の落雷を予約し直す
  }, 50000 + Math.random() * 130000);   // 50〜180 秒
}

// ---- 落雷そのもの -------------------------------------------
// 落雷のたびに、画面を縦断する強い雷を毎回ランダムに引き直す。
// これは演出なので天気とは切り離し、常に激しい設定で描く
function boltOpts() {
  return {
    ...optsOf(P),
    stem: 7, tipLen: 70, simplify: 2.5, taper: 0.3, fall: 0.4,
    depth: 5, rough: 0.105, wobble: 0.42,
    // 密に枝を出すと根っこのように見える。長く・少なくすると分岐した稲妻に見える
    branchGen: 2, branchDensity: 1.9,
    branchLen: 1.9,           // px 空間なので実距離。0.3 だと 30px しか伸びない
    branchAngle: 34,
  };
}

const boltPaint = () => ({
  ...P,
  glowAmt: Math.max(1.15, P.glowAmt),
  spread: Math.max(1.8, P.spread),
});

// 上端の外から入って、横に流れながら下りる。
// wide=true は「遠くの雷」用で、画面のどこにでも落ちて横にも大きく流れる
function boltPath(w, h, rnd, wide) {
  // 主役は中央に落とす。わずかに散らして毎回同じ位置に見えないようにする
  const x0 = wide ? w * (-0.05 + rnd() * 1.1) : w * (0.44 + rnd() * 0.12);
  // 横流れは控えめに。大きく流すと中央から落ちている感じが崩れる
  const drift = (rnd() - 0.5) * w * (wide ? 0.5 : 0.16);
  const yEnd = h * (wide ? 0.3 + rnd() * 0.6 : 0.5 + rnd() * 0.5);
  const y0 = -h * 0.06;
  const n = 4;
  const pts = [[x0, y0]];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    pts.push([x0 + drift * t + (rnd() - 0.5) * w * 0.07, y0 + (yEnd - y0) * t]);
  }
  return pts;
}

function paintBolts() {
  const svg = $('bolts');
  if (!svg) return;
  const w = window.innerWidth, h = window.innerHeight;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const rnd = mulberry32((Math.random() * 1e9) | 0);
  const o = boltOpts();
  const bp = boltPaint();
  let body = '';
  // 中央に集めるので二条は重なって団子になりやすい。頻度を落とす
  const n = rnd() < 0.25 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const parts = buildBolt([boltPath(w, h, rnd)], o, (rnd() * 1e9) | 0);
    body += parts.map((q) => `<path d="${toPath(q.poly)}"/>`).join('');
  }
  svg.innerHTML = `<defs>${filters(Math.max(9, P.blurBig), P.blurSmall, 'b')}</defs>`
    + `<g class="bolt">${layered(body, bp, 'b')}</g>`;
  scheduleAmbient(3000);            // 直後に遠雷が重なると散らかるので少し空ける
}

// ---- 遠雷（合間に走る弱い雷）--------------------------------
// 主役の落雷は数十秒に一度。その合間に、細くて短命な雷を走らせて空を生かす。
// 文字は描き替えず、閃光もごく弱いので読んでいる邪魔にならない
function paintAmbient() {
  const svg = $('bolts2');
  if (!svg) return;
  const w = window.innerWidth, h = window.innerHeight;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const rnd = mulberry32((Math.random() * 1e9) | 0);
  const o = {
    ...boltOpts(),
    stem: 3.6, taper: 0.18, depth: 4,
    branchGen: 1, branchDensity: 1.2, branchLen: 1.2,
  };
  const bp = { ...boltPaint(), glowAmt: 0.8, spread: 1.2 };
  const parts = buildBolt([boltPath(w, h, rnd, true)], o, (rnd() * 1e9) | 0);
  const body = parts.map((q) => `<path d="${toPath(q.poly)}"/>`).join('');
  svg.innerHTML = `<defs>${filters(Math.max(7, P.blurBig * 0.8), P.blurSmall, 'a')}</defs>`
    + `<g class="bolt2">${layered(body, bp, 'a')}</g>`;
  restart($('introFlash'), 'dim');  // 空がわずかに明るむ程度
}

function scheduleAmbient(min = 2000) {
  clearTimeout(ambientTimer);
  ambientTimer = setTimeout(() => {
    if (!introOn) return;
    paintAmbient();
    scheduleAmbient();
  }, min + Math.random() * 4000);   // 2〜6 秒
}




// 1 秒ごと。行幅が固定なので時刻の行だけ差し替えれば済む。
// シードは文字コードと桁位置から決まるので、変わっていない桁は同じ形に再生成される
function tickIntro() {
  if (!introOn) return;
  const now = cityTime();
  const g = $('introTime');
  if (!g) return;
  // introSvg と同じ行パラメータで組み直す。素の P だと字間が 3 倍近く広がって
  // 桁が離れ、行幅が変わるので中央揃えの位置までずれる
  const lp = forLine(P, 1);
  const l = layoutLine(now, lp, 811 + 17, true);
  const inner = g.firstElementChild;
  if (inner) inner.innerHTML = layered(l.body, lp);
}

function dismissIntro() {
  if (!introOn) return;
  introOn = false;
  clearTimeout(strikeTimer);
  clearTimeout(ambientTimer);
  $('intro').classList.add('gone');
  setTimeout(() => $('intro').remove(), 700);
}

// ---- 読み出し表示 -------------------------------------------
const stat = (label, value) => `<div class="st"><span>${label}</span><b>${value}</b></div>`;

function paintReadout(w) {
  const q = charge(w);
  const modelled = w.source === 'model';
  $('charge').style.setProperty('--v', `${Math.min(100, (q / 1.25) * 100).toFixed(0)}%`);
  $('chargeNum').textContent = q.toFixed(2);
  $('stats').innerHTML = [
    modelled && w.capeMax != null ? stat('CAPE', `${Math.round(w.capeMax)} J/KG`) : '',
    w.thunderHours ? stat('STORM', `${w.thunderHours} H`) : '',
    stat('WIND', `${(w.windMax ?? 0).toFixed(1)} KM/H`),
    stat('TEMP', `${(w.tempMax ?? 0).toFixed(1)} °C`),
    stat('HUM', `${Math.round(w.humidMean ?? 0)} %`),
    stat('RAIN', `${(w.precipSum ?? 0).toFixed(1)} MM`),
    modelled ? '' : '<div class="st warn">NO CAPE FOR THIS DATE — ESTIMATED FROM RAIN / WIND / HUMIDITY</div>',
  ].join('');
}

function paintMonthReadout() {
  if (!month) return;
  const qs = [...month.days.values()].map(charge);
  const capes = [...month.days.values()].map((w) => w.capeMax).filter((v) => v != null);
  const avg = qs.length ? qs.reduce((a, b) => a + b, 0) / qs.length : 0;
  const peak = qs.length ? Math.max(...qs) : 0;
  $('charge').style.setProperty('--v', `${Math.min(100, (avg / 1.25) * 100).toFixed(0)}%`);
  $('chargeNum').textContent = avg.toFixed(2);
  $('stats').innerHTML = [
    stat('MONTH', month.ym),
    stat('DAYS', String(month.days.size)),
    capes.length ? stat('PEAK CAPE', `${Math.round(Math.max(...capes))} J/KG`) : '',
    stat('CHARGED DAYS', `${qs.filter((q) => q >= 0.5).length}`),
    stat('PEAK', peak.toFixed(2)),
    month.source === 'model' ? '' :
      '<div class="st warn">NO CAPE FOR THIS MONTH — ESTIMATED FROM RAIN / WIND / HUMIDITY</div>',
  ].join('');
}

// ---- 取得 ---------------------------------------------------

async function load(animate = true) {
  if (busy) return;
  busy = true;
  $('app').classList.add('loading');
  try {
    const w = await fetchWeather(date, city);
    lastW = w;
    const p = paramsFor(w, date);
    delete p._charge;
    P = p;
    paintReadout(w);
    paintIntro(true);        // データが届いた瞬間に本物の字形で落雷し直す
    $('err').textContent = '';
  } catch (e) {
    $('err').textContent = `COULD NOT FETCH — ${e.message}`;
  }
  $('app').classList.remove('loading');
  busy = false;
  paint(animate);
}

async function loadMonth(animate = true) {
  const ym = date.slice(0, 7);
  if (busy) return;
  busy = true;
  $('app').classList.add('loading');
  try {
    if (!month || month.ym !== ym || month.city !== city.roman) {
      const r = await fetchMonth(ym, city);
      const params = new Map();
      r.days.forEach((w, ds) => {
        const p = paramsFor(w, ds);
        delete p._charge;
        params.set(ds, p);
      });
      month = { ym, city: city.roman, source: r.source, days: r.days, params };
    }
    // 背景は月の平均的な色に寄せる（選択日の色のままだと月替わりで飛ぶ）
    const sel = month.params.get(date);
    if (sel) P = sel;
    paintMonthReadout();
    $('err').textContent = '';
  } catch (e) {
    $('err').textContent = `COULD NOT FETCH — ${e.message}`;
  }
  $('app').classList.remove('loading');
  busy = false;
  paint(animate);
}

const refresh = (animate = true) => (VIEW === 'calendar' ? loadMonth(animate) : load(animate));

// ---- UI -----------------------------------------------------
function setView(v) {
  VIEW = v;
  document.querySelectorAll('.view').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  $('dateLbl').textContent = v === 'calendar' ? 'Month' : 'Date';
}

// カレンダーでは前後ボタンを月送りにする
function shiftMonth(ds, n) {
  const [y, m, d] = ds.split('-').map(Number);
  const t = new Date(y, m - 1 + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  const day = Math.min(d, last);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function boot() {
  const sel = $('city');
  CITIES.forEach((c, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = c.en || c.roman;
    sel.appendChild(o);
  });
  sel.onchange = (e) => { city = CITIES[+e.target.value]; month = null; refresh(); };

  const d = $('date');
  d.value = date;
  d.min = '1940-01-01';
  d.max = maxDateStr();
  d.onchange = () => { date = d.value; refresh(); };

  const go = (s) => { date = s; d.value = s; refresh(); };
  $('prev').onclick = () => go(VIEW === 'calendar' ? shiftMonth(date, -1) : shiftDate(date, -1));
  $('next').onclick = () => go(VIEW === 'calendar' ? shiftMonth(date, 1) : shiftDate(date, 1));
  $('today').onclick = () => go(todayStr());
  $('again').onclick = () => paint(true);

  document.querySelectorAll('.view').forEach((b) => (b.onclick = () => {
    if (VIEW === b.dataset.view) return;
    setView(b.dataset.view);
    refresh();
  }));

  $('infoBtn').onclick = () => $('info').showModal();
  $('infoClose').onclick = () => $('info').close();
  $('info').addEventListener('click', (e) => {
    // 背景（dialog 自身）をクリックしたら閉じる
    if (e.target === $('info')) $('info').close();
  });

  // 列数が変わるときだけ字を作り直す。変わらない場合は上限幅の再計算で足りる
  let cols = colsFor();
  let t = 0;
  const onResize = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const c = colsFor();
      if (VIEW === 'specimen' && c !== cols) { cols = c; paint(false); return; }
      cols = c;
      const m = document.querySelector('main');
      const cs = getComputedStyle(m);
      const availH = m.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const svg = $('sheet').querySelector('svg');
      if (!svg) return;
      const vb = svg.viewBox.baseVal;
      $('sheet').style.maxWidth = `${Math.round(availH * (vb.width / vb.height))}px`;
    }, 140);
  };
  window.addEventListener('resize', onResize);
  new ResizeObserver(onResize).observe(document.querySelector('main'));

  // ---- イントロ ----
  // 取得前は静かに置くだけ。ここで落とすと、直後のデータ到着でもう一度落ちて
  // 入口で2連発になる。落雷は「その日の字形が入った瞬間」の1回にする
  paintIntro(false);
  scheduleAmbient();   // 合間の遠雷は取得を待たずに走らせる
  setInterval(tickIntro, 1000);
  const leave = (e) => {
    if (!introOn) return;
    if (e.type === 'keydown' && (e.metaKey || e.ctrlKey || e.altKey)) return;
    dismissIntro();
  };
  $('intro').addEventListener('click', leave);
  window.addEventListener('keydown', leave);

  setView('specimen');
  paint(false);   // 取得前は静かな骨格を出しておく
  load();
}

boot();
