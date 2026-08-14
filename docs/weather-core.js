// ============================================================
// weather-core.js — 기상 데이터 → 폰트 파라미터 매핑（DOM 비의존）
//   作品（docs/）と制作ツールの両方から読み込む共有ロジック
//
// 데이터원: Open-Meteo (API 키 불필요, CORS 개방)
//   · 최근 92일 이내 → /v1/forecast + start_date/end_date : CAPE 실값 있음
//   · 그 이전       → /v1/archive (ERA5) : CAPE 전부 null, 뇌우 코드도 안 나옴
//                     → 강수량·풍속·습도로 근사하고 출처를 표시한다
// ============================================================

// roman はポスターの {city} トークン用（フォントに日本語グリフが無いため）
// en は英語 UI の表示名
const CITIES = [
  { name: '東京', roman: 'TOKYO', en: 'TOKYO', lat: 35.68, lon: 139.76, tz: 'Asia/Tokyo' },
  { name: '金沢（冬の雷）', roman: 'KANAZAWA', en: 'KANAZAWA — WINTER LIGHTNING',
    lat: 36.59, lon: 136.63, tz: 'Asia/Tokyo' },
  { name: '大阪', roman: 'OSAKA', en: 'OSAKA', lat: 34.69, lon: 135.50, tz: 'Asia/Tokyo' },
  { name: '札幌', roman: 'SAPPORO', en: 'SAPPORO', lat: 43.06, lon: 141.35, tz: 'Asia/Tokyo' },
  { name: '那覇', roman: 'NAHA', en: 'NAHA', lat: 26.21, lon: 127.68, tz: 'Asia/Tokyo' },
  { name: 'シンガポール（世界最多雷）', roman: 'SINGAPORE', en: 'SINGAPORE — MOST STRIKES ON EARTH',
    lat: 1.35, lon: 103.82, tz: 'Asia/Singapore' },
  { name: 'マラカイボ湖（雷の名所）', roman: 'MARACAIBO', en: 'LAKE MARACAIBO — LIGHTNING CAPITAL',
    lat: 9.75, lon: -71.55, tz: 'America/Caracas' },
];

const HOURLY = 'cape,weather_code,wind_speed_10m,temperature_2m,relative_humidity_2m,precipitation';
const CAPE_WINDOW_DAYS = 92;   // forecast API が過去に遡れる範囲

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ---- 취득 ---------------------------------------------------
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const dayDiff = (dateStr) =>
  Math.round((new Date(dateStr + 'T00:00') - new Date(todayStr() + 'T00:00')) / 86400000);

function summarize(h, source) {
  const num = (a) => (a || []).filter((x) => x !== null && x !== undefined);
  const max = (a) => (a.length ? Math.max(...a) : null);
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const codes = num(h.weather_code);
  const cape = num(h.cape);
  return {
    source,
    capeMax: max(cape),
    thunderHours: codes.filter((c) => c >= 95).length,
    windMax: max(num(h.wind_speed_10m)),
    tempMax: max(num(h.temperature_2m)),
    humidMean: mean(num(h.relative_humidity_2m)),
    precipSum: num(h.precipitation).reduce((s, x) => s + x, 0),
  };
}

async function fetchWeather(dateStr, city) {
  const diff = dayDiff(dateStr);
  const modelled = diff >= -CAPE_WINDOW_DAYS && diff <= 15;
  const key = `bolt:w:${dateStr}:${city.lat},${city.lon}`;
  // 過去日は結果が変わらないのでキャッシュする。今日/未来は予報が更新されるので都度取得
  if (diff < 0) {
    const hit = localStorage.getItem(key);
    if (hit) return JSON.parse(hit);
  }

  const base = modelled
    ? 'https://api.open-meteo.com/v1/forecast'
    : 'https://archive-api.open-meteo.com/v1/archive';
  const url = `${base}?latitude=${city.lat}&longitude=${city.lon}&hourly=${HOURLY}`
    + `&start_date=${dateStr}&end_date=${dateStr}&timezone=${encodeURIComponent(city.tz)}`;

  const r = await fetch(url);
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || d.error) throw new Error(d?.reason || `API ${r.status}`);
  if (!d.hourly) throw new Error('データが空です');

  const w = summarize(d.hourly, modelled && d.hourly.cape?.some((x) => x !== null) ? 'model' : 'proxy');
  if (diff < 0) localStorage.setItem(key, JSON.stringify(w));
  return w;
}

// ---- 1 か月分をまとめて取得 ---------------------------------
// 日ごとに 31 回叩かない。Open-Meteo は start_date/end_date で範囲を返すので
// 1 リクエストで受けて、時刻の日付部分でバケツ分けする
const HKEYS = HOURLY.split(',');

const maxDateStr = () => {
  const x = new Date();
  x.setDate(x.getDate() + 15);
  return x.toISOString().slice(0, 10);
};

const daysInMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};

async function fetchMonth(ym, city) {
  const start = `${ym}-01`;
  const cap = maxDateStr();
  const endFull = `${ym}-${String(daysInMonth(ym)).padStart(2, '0')}`;
  const end = endFull > cap ? cap : endFull;
  if (start > cap) return { source: 'model', days: new Map() };

  const key = `bolt:m:${ym}:${city.lat},${city.lon}`;
  const settled = end < todayStr();          // 過去月は結果が動かないのでキャッシュ
  if (settled) {
    const hit = localStorage.getItem(key);
    if (hit) { const o = JSON.parse(hit); return { source: o.source, days: new Map(o.days) }; }
  }

  // 月の初日が CAPE 提供範囲外なら、その月は丸ごと代替指標に落とす
  const dd = dayDiff(start);
  const modelled = dd >= -CAPE_WINDOW_DAYS && dd <= 15;
  const base = modelled
    ? 'https://api.open-meteo.com/v1/forecast'
    : 'https://archive-api.open-meteo.com/v1/archive';
  const url = `${base}?latitude=${city.lat}&longitude=${city.lon}&hourly=${HOURLY}`
    + `&start_date=${start}&end_date=${end}&timezone=${encodeURIComponent(city.tz)}`;

  const r = await fetch(url);
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || d.error || !d.hourly) throw new Error(d?.reason || `API ${r.status}`);

  const buckets = new Map();
  d.hourly.time.forEach((t, i) => {
    const day = t.slice(0, 10);
    if (!buckets.has(day)) {
      const o = {};
      HKEYS.forEach((k) => (o[k] = []));
      buckets.set(day, o);
    }
    const o = buckets.get(day);
    HKEYS.forEach((k) => o[k].push(d.hourly[k] ? d.hourly[k][i] : null));
  });

  const days = new Map();
  buckets.forEach((o, day) => {
    days.set(day, summarize(o, modelled && o.cape.some((x) => x !== null) ? 'model' : 'proxy'));
  });

  const out = { source: modelled ? 'model' : 'proxy', days };
  if (settled) localStorage.setItem(key, JSON.stringify({ source: out.source, days: [...days] }));
  return out;
}

// ---- 帯電度 0..1.25 ----------------------------------------
// CAPE(対流有効位置エネルギー) は 0〜4000 J/kg 程度。
// 500 未満はほぼ雷なし / 1000〜2500 で活発 / 3000 超は激しい、が目安。
function charge(w) {
  if (w.source === 'model' && w.capeMax != null) {
    const c = clamp(w.capeMax / 2500, 0, 1.2);
    const t = clamp(w.thunderHours / 6, 0, 1);
    return clamp(Math.pow(c, 0.72) * 0.85 + t * 0.4, 0, 1.25);
  }
  // 代替指標（CAPE が無い過去日）: 降水量・風速・湿度の合成
  const p = clamp(w.precipSum / 30, 0, 1);
  const v = clamp(((w.windMax ?? 8) - 8) / 30, 0, 1);
  const hh = clamp(((w.humidMean ?? 55) - 55) / 35, 0, 1);
  return clamp(p * 0.55 + v * 0.3 + hh * 0.25, 0, 1);
}

// ---- 色: 気温 → 発光の色温度 -------------------------------
function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (n) => Math.round(255 * f(n)).toString(16).padStart(2, '0');
  return `#${hex(0)}${hex(8)}${hex(4)}`;
}

function tempColors(t) {
  const u = clamp((t + 5) / 40, 0, 1);       // -5℃ → 35℃
  return {
    core: '#ffffff',
    glow1: hslHex(lerp(188, 272, u), 100, 74),
    glow2: hslHex(lerp(206, 296, u), 100, 55),
    bg: hslHex(lerp(205, 272, u), 42, 4),
  };
}

// ---- 매핑 ---------------------------------------------------
function weatherToParams(w) {
  const q = charge(w);
  return {
    growth: 'fractal',
    depth: q < 0.2 ? 3 : q < 0.7 ? 4 : 5,
    rough: lerp(0.02, 0.145, clamp(q, 0, 1)),
    decay: 0.62,
    branchDensity: lerp(0.15, 6.5, q),
    branchGen: q < 0.22 ? 0 : q < 0.55 ? 1 : q < 0.9 ? 2 : 3,
    branchLen: lerp(0.1, 0.36, clamp(q, 0, 1)),
    branchAngle: lerp(26, 44, clamp(q, 0, 1)),
    wobble: lerp(0.12, 0.55, clamp(q, 0, 1)),
    glow: true,
    glowAmt: lerp(0.3, 1.4, clamp(q, 0, 1)),
    spread: lerp(0.7, 2.4, clamp(q, 0, 1)),
    // 風速 → 傾斜（風で字が傾く）
    slant: clamp((w.windMax ?? 10) * 0.5, 0, 24),
    // 湿度 → にじみ
    blurBig: lerp(4, 14, clamp(((w.humidMean ?? 60) - 40) / 50, 0, 1)),
    ...tempColors(w.tempMax ?? 20),
    _charge: q,
  };
}

// 同じ日・同じ場所なら必ず同じ字形になるように、日付と座標からシードを作る
function seedFor(dateStr, city) {
  let h = 2166136261;
  for (const ch of `${dateStr}@${city.lat},${city.lon}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shiftDate(s, n) {
  const d = new Date(s + 'T00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
