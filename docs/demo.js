// ============================================================
// demo.js — 「資料映像」用の自動再生（?demo を付けたときだけ動く）
//   東京TDC の資料映像は «解説映像ではなく» 作品理解のための記録なので、
//   ナレーションもテロップも入れず、実際の操作をそのまま流す。
//   毎回同じ尺・同じ順序で再生されるので、画面収録を回すだけで同じ一本が撮れる。
//   通常アクセス（?demo なし）では何もしない
// ============================================================

if (new URLSearchParams(location.search).has('demo')) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // その地点の «いちばん静かな日» と «いちばん荒れた日» を 1 リクエストで拾う。
  // 撮影する日がいつでも、対比のいちばん強い二日が選ばれる
  async function extremes(c) {
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${c.lat}&longitude=${c.lon}&daily=cape_max`
      + `&past_days=90&forecast_days=1&timezone=${encodeURIComponent(c.tz)}`;
    const d = await (await fetch(url)).json();
    const z = d.daily.time.map((t, i) => [t, d.daily.cape_max[i]])
      .filter(([, v]) => v != null).sort((a, b) => a[1] - b[1]);
    return { calm: z[0][0], storm: z[z.length - 1][0] };
  }

  const goDate = async (d) => {
    $('date').value = d;
    date = d;
    await refresh();
  };

  const goCity = async (roman) => {
    const i = CITIES.findIndex((c) => c.roman === roman);
    if (i < 0) return;
    $('city').value = i;
    city = CITIES[i];
    month = null;
    await refresh();
  };

  const view = (v) => document.querySelector(`.view[data-view="${v}"]`).click();

  async function run() {
    // ── イントロ。落雷が落ちて、時計が動いているところを見せる
    await sleep(6800);

    // ── 入る
    dismissIntro();
    await sleep(1500);

    const ex = await extremes(city);

    // ── 静かな日の A–Z。字そのものを読ませる時間を取る
    await goDate(ex.calm);
    await sleep(6500);

    // ── 荒れた日へ。落雷して字が変わる
    await goDate(ex.storm);
    await sleep(7000);

    // ── 一か月を俯瞰する
    view('calendar');
    await sleep(8000);

    // ── 前の月へ。季節で荒れ方が変わるのが見える
    $('prev').click();
    await sleep(7000);

    // ── 地点を変える。冬に雷が多い土地
    await goCity('KANAZAWA');
    await sleep(6500);

    // ── 字に戻って終わる
    view('specimen');
    await sleep(7000);
  }

  // live.js の boot() が走り終えてから乗る。
  // 尺は 1 分以内でなければならないので、実測値をコンソールに出しておく
  window.addEventListener('load', () => setTimeout(async () => {
    const t0 = performance.now();
    await run();
    const sec = (performance.now() - t0) / 1000;
    window.__demoSec = sec;
    console.info(`[demo] finished in ${sec.toFixed(1)}s`
      + (sec > 60 ? ' — OVER 60s, shorten a dwell' : ''));
  }, 400));
}
