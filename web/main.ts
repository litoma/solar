interface DashboardResponse {
  hasData: boolean;
  config: {
    location: string;
    buyPriceYenPerKwh: number;
    sellPriceYenPerKwh: number;
    refreshIntervalSec: number;
    batteryCapacityKwh: number;
    latitude: number;
    longitude: number;
    timezoneOffsetMinutes: number;
  };
  sun: {
    sunriseMin: number;
    noonMin: number;
    sunsetMin: number;
    sunrise: string;
    noon: string;
    sunset: string;
  };
  weather: {
    condition: string;
    tempC: number | null;
    text: string;
  } | null;
  latest: Record<string, number | null> | null;
  sellDayKwhComputed: number;
  snapshot: {
    ts: number;
    cells_mv: number[];
    temps_c: number[];
  } | null;
  series: Record<string, number | null>[];
}

let refreshTimerId: number | null = null;
let currentRefreshSec = 60;

function el<T extends HTMLElement | SVGElement>(id: string): T {
  return document.getElementById(id) as unknown as T;
}

function formatTimeJst(
  epochSec: number,
  tzOffsetMin = 540,
): { text: string; minutesOfDay: number } {
  const d = new Date((epochSec + tzOffsetMin * 60) * 1000);
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  return {
    text: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
    minutesOfDay: hh * 60 + mm,
  };
}

function quadBezier(
  t: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * x0 + 2 * u * t * x1 + t * t * x2,
    y: u * u * y0 + 2 * u * t * y1 + t * t * y2,
  };
}

function positionSunMarker(
  minutesOfDay: number,
  sunriseMin: number,
  sunsetMin: number,
  solarKw: number,
): void {
  const marker = el<SVGGElement>("sun-marker-group");
  const badgeGroup = el<SVGGElement>("sun-badge-group");
  const badgeKw = el<SVGTextElement>("sun-badge-kw");
  badgeKw.textContent = `${solarKw.toFixed(2)} kW`;

  let pos: { x: number; y: number };
  if (minutesOfDay < sunriseMin) {
    // 00:00 〜 日の出: 左側の地平線下カーブ (52,76) -> (99,110) -> (146,76)
    const t = Math.max(0, Math.min(1, minutesOfDay / Math.max(1, sunriseMin)));
    pos = quadBezier(t, 52, 76, 99, 110, 146, 76);
    badgeGroup.setAttribute("transform", "translate(0, -24)");
  } else if (minutesOfDay <= sunsetMin) {
    // 日の出 〜 日の入り: 日中の太陽アーク (146,76) -> (300,-10) -> (454,76)
    const span = Math.max(60, sunsetMin - sunriseMin);
    const t = Math.max(0, Math.min(1, (minutesOfDay - sunriseMin) / span));
    pos = quadBezier(t, 146, 76, 300, -10, 454, 76);
    badgeGroup.setAttribute("transform", "translate(0, -28)");
  } else {
    // 日の入り 〜 24:00: 右側の地平線下カーブ (454,76) -> (501,110) -> (548,76)
    const nightSpan = Math.max(1, 1440 - sunsetMin);
    const t = Math.max(0, Math.min(1, (minutesOfDay - sunsetMin) / nightSpan));
    pos = quadBezier(t, 454, 76, 501, 110, 548, 76);
    badgeGroup.setAttribute("transform", "translate(0, -24)");
  }

  marker.setAttribute("transform", `translate(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`);
}

function updateFlowLines(
  solarKw: number,
  useKw: number,
  buyKw: number,
  sellKw: number,
  battChargeKw: number,
): void {
  const setLine = (id: string, cls: string | null) => {
    const node = el<SVGLineElement>(id);
    node.setAttribute("class", cls ? `flow-line ${cls}` : "flow-line");
  };

  const solarActive = solarKw >= 0.02;
  const useActive = useKw >= 0.02;
  const buyActive = buyKw >= 0.02;
  const sellActive = sellKw >= 0.02;
  const battActive = Math.abs(battChargeKw) >= 0.03;

  setLine("line-use", useActive ? "active-green" : null);
  setLine("line-sell", sellActive ? "active-blue" : null);
  setLine("line-buy", buyActive ? "active-pink" : null);
  setLine("line-batt", battActive ? "active-purple" : null);

  if (solarActive) {
    setLine("line-solar", sellActive ? "active-blue" : "active-green");
  } else {
    setLine("line-solar", null);
  }

  if (sellActive && solarActive) {
    setLine("line-trunk-mid", "active-blue");
  } else if (battActive) {
    setLine("line-trunk-mid", "active-purple");
  } else if (buyActive && useActive) {
    setLine("line-trunk-mid", "active-pink");
  } else {
    setLine("line-trunk-mid", null);
  }
}

function renderDashboard(data: DashboardResponse): void {
  const cfg = data.config;
  const tzMin = cfg.timezoneOffsetMinutes ?? 540;

  // 日の出・日の入り時刻と天気は実データが未到着でも常に表示する
  el("sun-rise-label").textContent = data.sun.sunrise;
  el("sun-noon-label").textContent = "12:00";
  el("sun-set-label").textContent = data.sun.sunset;
  el("ef-weather").textContent = data.weather?.text || "CLEAR --°C";
  el("val-batt-cap").textContent = `CAPACITY ${cfg.batteryCapacityKwh.toFixed(1)} kWh`;

  const latest = data.latest;
  if (!latest) {
    const nowSec = Math.floor(Date.now() / 1000);
    const { text: timeText, minutesOfDay } = formatTimeJst(nowSec, tzMin);
    el("ef-time").textContent = timeText;
    positionSunMarker(minutesOfDay, data.sun.sunriseMin, data.sun.sunsetMin, 0);
    el("ef-status-pill").dataset.state = "idle";
    el("ef-status-text").textContent = "NO DATA";
    return;
  }

  const ts = typeof latest.ts === "number" ? latest.ts : Math.floor(Date.now() / 1000);
  const { text: timeText, minutesOfDay } = formatTimeJst(ts, tzMin);
  el("ef-time").textContent = timeText;

  // ゲートウェイの電力値 (W -> kW)
  const pvSumW =
    (latest.pv1_p_avg_w ?? 0) +
    (latest.pv2_p_avg_w ?? 0) +
    (latest.pv3_p_avg_w ?? 0) +
    (latest.pv4_p_avg_w ?? 0);
  const solarW = latest.solar_w ?? pvSumW ?? 0;
  const gridW = latest.grid_w ?? 0; // 正=買電, 負=売電
  const loadW = latest.load_w ?? 0;
  const battW = latest.batt_w ?? 0; // ゲートウェイは 負=充電, 正=放電

  // HTML仕様に合わせてバッテリー電力は符号を反転 (正=充電, 負=放電)
  const battChargeKw = -battW / 1000;
  const battAbsKw = Math.abs(battChargeKw);

  const solarKw = Math.max(0, solarW) / 1000;
  const useKw = Math.max(0, loadW) / 1000;
  const buyKw = gridW > 0 ? gridW / 1000 : 0;
  const sellKw = gridW < 0 ? -gridW / 1000 : 0;

  positionSunMarker(minutesOfDay, data.sun.sunriseMin, data.sun.sunsetMin, solarKw);

  // ステータスピル判定
  const statusPill = el("ef-status-pill");
  const statusText = el("ef-status-text");
  if (sellKw >= 0.03) {
    statusPill.dataset.state = "exporting";
    statusText.textContent = "EXPORTING";
  } else if (battChargeKw >= 0.04) {
    statusPill.dataset.state = "charging";
    statusText.textContent = "CHARGING";
  } else if (battChargeKw <= -0.04) {
    statusPill.dataset.state = "discharging";
    statusText.textContent = "DISCHARGING";
  } else if (buyKw >= 0.03) {
    statusPill.dataset.state = "importing";
    statusText.textContent = "IMPORTING";
  } else {
    statusPill.dataset.state = "idle";
    statusText.textContent = "IDLE";
  }

  // 日積算 (kWh) & 金額換算 (¥)
  const solarToday = latest.solar_day_kwh ?? 0;
  const useToday = latest.load_day_kwh ?? 0;
  const buyToday = latest.buy_day_kwh ?? 0;
  const sellToday = data.sellDayKwhComputed ?? 0;

  const solarValueYen = Math.round(solarToday * cfg.buyPriceYenPerKwh);
  const buyCostYen = Math.round(buyToday * cfg.buyPriceYenPerKwh);
  const sellRevYen = Math.round(sellToday * cfg.sellPriceYenPerKwh);

  // 自給率 SELF (%) = (使用量 - 買電量) / 使用量
  const selfPct =
    useToday > 0.05
      ? Math.round(Math.max(0, Math.min(100, ((useToday - buyToday) / useToday) * 100)))
      : 100;

  // SOLAR カード
  const elSolarKw = el("val-solar-kw");
  elSolarKw.textContent = `${solarKw.toFixed(2)} kW`;
  elSolarKw.classList.toggle("is-zero", solarKw < 0.005);
  el("val-solar-today").textContent = `TODAY ${solarToday.toFixed(1)} kWh`;
  el("val-solar-yen").textContent = `VALUE ¥${solarValueYen.toLocaleString("ja-JP")}`;

  // USE カード
  const elUseKw = el("val-use-kw");
  elUseKw.textContent = `${useKw.toFixed(2)} kW`;
  elUseKw.classList.toggle("is-zero", useKw < 0.005);
  el("val-use-today").textContent = `TODAY ${useToday.toFixed(1)} kWh`;
  el("val-use-self").textContent = `SELF ${selfPct}%`;

  // BUY カード
  const elBuyKw = el("val-buy-kw");
  elBuyKw.textContent = `${buyKw.toFixed(2)} kW`;
  elBuyKw.classList.toggle("is-zero", buyKw < 0.005);
  el("val-buy-today").textContent = `TODAY ${buyToday.toFixed(1)} kWh`;
  el("val-buy-yen").textContent = `COST ¥${buyCostYen.toLocaleString("ja-JP")}`;

  // SELL カード
  const elSellKw = el("val-sell-kw");
  elSellKw.textContent = `${sellKw.toFixed(2)} kW`;
  elSellKw.classList.toggle("is-zero", sellKw < 0.005);
  el("val-sell-today").textContent = `TODAY ${sellToday.toFixed(1)} kWh`;
  el("val-sell-yen").textContent = `REV ¥${sellRevYen.toLocaleString("ja-JP")}`;

  // フロー接続線
  updateFlowLines(solarKw, useKw, buyKw, sellKw, battChargeKw);

  // BATTERY カード
  const soc = Math.max(0, Math.min(100, Math.round(latest.soc ?? 0)));
  const capKwh = cfg.batteryCapacityKwh;
  const storedKwh = (capKwh * soc) / 100;

  el("val-batt-soc").textContent = `${soc}% (${storedKwh.toFixed(1)} kWh)`;
  el("val-batt-bar").style.width = `${soc}%`;

  let battStateLabel = "IDLE";
  if (battChargeKw >= 0.03) battStateLabel = "CHARGING";
  else if (battChargeKw <= -0.03) battStateLabel = "DISCHARGING";
  const displayBattKw = battStateLabel === "IDLE" ? 0 : battAbsKw;
  el("val-batt-state").textContent = `${battStateLabel} ${displayBattKw.toFixed(2)} kW`;

  // 推定残り時間 EST (残量kWh ÷ 使用電力useKw)
  const refPowerKw = useKw > 0.02 ? useKw : battAbsKw > 0.02 ? battAbsKw : 0;
  if (refPowerKw > 0) {
    const hrs = storedKwh / refPowerKw;
    const h = Math.floor(hrs);
    const m = Math.floor((hrs - h) * 60);
    el("val-batt-est").textContent = `EST ${h}h ${String(m).padStart(2, "0")}m`;
  } else {
    el("val-batt-est").textContent = `EST --h --m`;
  }

  // PV1〜4 詳細と BMS 詳細の更新
  for (let i = 1; i <= 4; i++) {
    const p = latest[`pv${i}_p_avg_w`];
    const v = latest[`pv${i}_v`];
    const a = latest[`pv${i}_i`];
    el(`pv${i}-w`).textContent = typeof p === "number" ? `${Math.round(p)} W` : "-- W";
    el(`pv${i}-vi`).textContent =
      `${typeof v === "number" ? v.toFixed(1) : "--"} V / ` +
      `${typeof a === "number" ? a.toFixed(1) : "--"} A`;
  }

  const packV = latest.pack_v;
  const cMin = latest.cell_min_mv;
  const cMax = latest.cell_max_mv;
  const cAvg = latest.cell_avg_mv;
  const tMin = latest.temp_min_c;
  const tMax = latest.temp_max_c;
  const tAvg = latest.temp_avg_c;
  el("bms-summary").textContent =
    `PACK: ${packV ?? "--"} V | CELL: ${cMin ?? "--"}〜${cMax ?? "--"} mV (AVG ${cAvg ?? "--"} mV) | ` +
    `TEMP: ${tMin ?? "--"}〜${tMax ?? "--"} °C (AVG ${tAvg ?? "--"} °C)`;

  const cellsGrid = el("cells-grid");
  const cells = data.snapshot?.cells_mv || [];
  if (cells.length > 0) {
    cellsGrid.innerHTML = cells
      .map((mv, idx) => `<div class="cell-chip">#${idx + 1} ${mv}mV</div>`)
      .join("");
  } else {
    cellsGrid.innerHTML = `<div class="cell-chip">スナップショット未取得</div>`;
  }
}

function scheduleRefresh(intervalSec: number): void {
  const sec = Math.max(10, intervalSec);
  if (refreshTimerId !== null && sec === currentRefreshSec) return;
  if (refreshTimerId !== null) {
    window.clearInterval(refreshTimerId);
  }
  currentRefreshSec = sec;
  refreshTimerId = window.setInterval(refresh, sec * 1000);
}

async function refresh(): Promise<void> {
  try {
    const resp = await fetch("/api/dashboard", { cache: "no-store" });
    if (resp.ok) {
      const json = (await resp.json()) as DashboardResponse;
      renderDashboard(json);
      if (json.config?.refreshIntervalSec) {
        scheduleRefresh(json.config.refreshIntervalSec);
      }
    }
  } catch (err) {
    console.warn("Dashboard fetch failed:", err);
  }
}

function setupControls(): void {
  const btnDetails = el("btn-toggle-details");
  const detailsSec = el("ef-details");
  btnDetails.addEventListener("click", () => {
    const isHidden = detailsSec.hasAttribute("hidden");
    if (isHidden) {
      detailsSec.removeAttribute("hidden");
      btnDetails.textContent = "PV1〜4・BMS詳細を閉じる";
    } else {
      detailsSec.setAttribute("hidden", "");
      btnDetails.textContent = "PV1〜4・BMS詳細を表示";
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refresh();
    }
  });
}

setupControls();
refresh();
scheduleRefresh(currentRefreshSec);
