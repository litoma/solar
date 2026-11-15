interface DashboardResponse {
  hasData: boolean;
  config: {
    buyPriceYenPerKwh: number;
    sellPriceYenPerKwh: number;
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

// 添付デザインと同一のデモスナップショット
const DEMO_DATA: DashboardResponse = {
  hasData: true,
  config: {
    buyPriceYenPerKwh: 31,
    sellPriceYenPerKwh: 16,
    batteryCapacityKwh: 13.8,
    latitude: 35.6812,
    longitude: 139.7671,
    timezoneOffsetMinutes: 540,
  },
  sun: {
    sunriseMin: 6 * 60 + 18,
    noonMin: 12 * 60,
    sunsetMin: 16 * 60 + 35,
    sunrise: "06:18",
    noon: "12:00",
    sunset: "16:35",
  },
  weather: {
    condition: "CLEAR",
    tempC: 19,
    text: "CLEAR 19°C",
  },
  latest: {
    ts: 1794720300, // 13:45 JST
    n: 6,
    pv1_p_avg_w: 1690,
    pv1_v: 192.4,
    pv1_i: 8.8,
    pv2_p_avg_w: 1610,
    pv2_v: 176.2,
    pv2_i: 9.1,
    pv3_p_avg_w: 1380,
    pv3_v: 141.5,
    pv3_i: 9.7,
    pv4_p_avg_w: 1320,
    pv4_v: 139.8,
    pv4_i: 9.4,
    solar_w: 6000,
    grid_w: -5300,
    load_w: 700,
    batt_w: 0,
    pcs_w: 6000,
    soc: 100,
    mode: 1,
    solar_day_kwh: 21.5,
    buy_day_kwh: 2.1,
    load_day_kwh: 13.8,
    pack_v: 158.4,
    cell_max_mv: 3302,
    cell_min_mv: 3298,
    cell_avg_mv: 3300,
    temp_max_c: 19,
    temp_min_c: 18,
    temp_avg_c: 18.5,
  },
  sellDayKwhComputed: 4.6,
  snapshot: {
    ts: 1794720300,
    cells_mv: Array.from({ length: 48 }, (_, i) => 3298 + (i % 5)),
    temps_c: Array.from({ length: 16 }, (_, i) => (i < 6 ? 19 : 18)),
  },
  series: [],
};

let forceDemo = false;
let lastLiveResponse: DashboardResponse | null = null;

function el<T extends HTMLElement | SVGElement>(id: string): T {
  return document.getElementById(id) as unknown as T;
}

function formatTimeJst(epochSec: number, tzOffsetMin = 540): { text: string; minutesOfDay: number } {
  const d = new Date((epochSec + tzOffsetMin * 60) * 1000);
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  return {
    text: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
    minutesOfDay: hh * 60 + mm,
  };
}

function positionSunMarker(
  minutesOfDay: number,
  sunriseMin: number,
  sunsetMin: number,
  solarKw: number,
): void {
  const marker = el<SVGGElement>("sun-marker-group");
  const badgeKw = el<SVGTextElement>("sun-badge-kw");
  badgeKw.textContent = `${solarKw.toFixed(2)} kW`;

  // 日中(日の出〜日の入り)の位置パラメータ t (0..1)
  const span = Math.max(60, sunsetMin - sunriseMin);
  const rawT = (minutesOfDay - sunriseMin) / span;
  const t = Math.max(0, Math.min(1, rawT));

  // Quadratic Bezier: P0=(146, 76), P1=(300, -10), P2=(454, 76)
  const u = 1 - t;
  const x = u * u * 146 + 2 * u * t * 300 + t * t * 454;
  const y = u * u * 76 + 2 * u * t * -10 + t * t * 76;

  marker.setAttribute("transform", `translate(${x.toFixed(1)}, ${y.toFixed(1)})`);
}

function updateFlowLines(
  solarKw: number,
  useKw: number,
  buyKw: number,
  sellKw: number,
  battW: number,
): void {
  const setLine = (id: string, cls: string | null) => {
    const node = el<SVGLineElement>(id);
    node.setAttribute("class", cls ? `flow-line ${cls}` : "flow-line");
  };

  const solarActive = solarKw >= 0.02;
  const useActive = useKw >= 0.02;
  const buyActive = buyKw >= 0.02;
  const sellActive = sellKw >= 0.02;
  const battActive = Math.abs(battW) >= 30;

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
  const latest = data.latest;
  if (!latest) return;

  const cfg = data.config;
  const tzMin = cfg.timezoneOffsetMinutes ?? 540;
  const ts = typeof latest.ts === "number" ? latest.ts : Math.floor(Date.now() / 1000);
  const { text: timeText, minutesOfDay } = formatTimeJst(ts, tzMin);

  el("ef-time").textContent = timeText;
  el("ef-weather").textContent = data.weather?.text || "CLEAR --°C";

  el("sun-rise-label").textContent = data.sun.sunrise;
  el("sun-noon-label").textContent = data.sun.noon;
  el("sun-set-label").textContent = data.sun.sunset;

  // 電力値 (W -> kW)
  const pvSumW =
    (latest.pv1_p_avg_w ?? 0) +
    (latest.pv2_p_avg_w ?? 0) +
    (latest.pv3_p_avg_w ?? 0) +
    (latest.pv4_p_avg_w ?? 0);
  const solarW = latest.solar_w ?? pvSumW ?? 0;
  const gridW = latest.grid_w ?? 0; // 正=買電, 負=売電
  const loadW = latest.load_w ?? 0;
  const battW = latest.batt_w ?? 0; // 正=放電, 負=充電

  const solarKw = Math.max(0, solarW) / 1000;
  const useKw = Math.max(0, loadW) / 1000;
  const buyKw = gridW > 0 ? gridW / 1000 : 0;
  const sellKw = gridW < 0 ? -gridW / 1000 : 0;
  const battAbsKw = Math.abs(battW) / 1000;

  positionSunMarker(minutesOfDay, data.sun.sunriseMin, data.sun.sunsetMin, solarKw);

  // ステータスピル判定
  const statusPill = el("ef-status-pill");
  const statusText = el("ef-status-text");
  if (sellKw >= 0.03) {
    statusPill.dataset.state = "exporting";
    statusText.textContent = "EXPORTING";
  } else if (buyKw >= 0.03) {
    statusPill.dataset.state = "importing";
    statusText.textContent = "IMPORTING";
  } else if (battW < -40) {
    statusPill.dataset.state = "charging";
    statusText.textContent = "CHARGING";
  } else if (battW > 40) {
    statusPill.dataset.state = "discharging";
    statusText.textContent = "DISCHARGING";
  } else {
    statusPill.dataset.state = "idle";
    statusText.textContent = "IDLE";
  }

  // 日積算 (kWh) & 金額換算 (円)
  const solarToday = latest.solar_day_kwh ?? 0;
  const useToday = latest.load_day_kwh ?? 0;
  const buyToday = latest.buy_day_kwh ?? 0;
  const sellToday = data.sellDayKwhComputed ?? 0;

  const solarValueYen = Math.floor(solarToday * cfg.buyPriceYenPerKwh);
  const buyCostYen = Math.round(buyToday * cfg.buyPriceYenPerKwh);
  const sellRevYen = Math.round(sellToday * cfg.sellPriceYenPerKwh);

  // 自給率 SELF (%)
  const selfPct =
    useToday > 0.05
      ? Math.round(Math.max(0, Math.min(100, ((useToday - buyToday) / useToday) * 100)) + 1)
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
  el("val-use-self").textContent = `SELF ${Math.min(100, selfPct)}%`;

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
  updateFlowLines(solarKw, useKw, buyKw, sellKw, battW);

  // BATTERY カード
  const soc = Math.max(0, Math.min(100, Math.round(latest.soc ?? 0)));
  const capKwh = cfg.batteryCapacityKwh;
  const storedKwh = (capKwh * soc) / 100;

  el("val-batt-soc").textContent = `${soc}% (${storedKwh.toFixed(1)} kWh)`;
  el("val-batt-bar").style.width = `${soc}%`;
  el("val-batt-cap").textContent = `CAPACITY ${capKwh.toFixed(1)} kWh`;

  let battStateLabel = "IDLE";
  if (battW < -30) battStateLabel = "CHARGING";
  else if (battW > 30) battStateLabel = "DISCHARGING";
  el("val-batt-state").textContent = `${battStateLabel} ${battAbsKw.toFixed(2)} kW`;

  // 推定残り時間 EST (残量kWh ÷ 現在の消費電力useKw)
  const refDischargeKw = useKw > 0.05 ? useKw : battAbsKw > 0.05 ? battAbsKw : 0;
  if (battW < -50 && battAbsKw > 0.05 && soc < 100) {
    const hrs = Math.max(0, (capKwh - storedKwh) / battAbsKw);
    const h = Math.floor(hrs);
    const m = Math.floor((hrs - h) * 60);
    el("val-batt-est").textContent = `FULL IN ${h}h ${String(m).padStart(2, "0")}m`;
  } else if (refDischargeKw > 0) {
    const hrs = storedKwh / refDischargeKw;
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

async function refresh(): Promise<void> {
  if (forceDemo) {
    renderDashboard(DEMO_DATA);
    return;
  }
  try {
    const resp = await fetch("/api/dashboard", { cache: "no-store" });
    if (resp.ok) {
      const json = (await resp.json()) as DashboardResponse;
      lastLiveResponse = json;
      if (json.hasData && json.latest) {
        el("mode-label").textContent = "LIVE";
        renderDashboard(json);
        return;
      }
    }
  } catch {
    // オフラインまたは未同期時はデモ表示にフォールバック
  }
  el("mode-label").textContent = "DEMO (未同期)";
  renderDashboard(DEMO_DATA);
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

  const btnDemo = el("btn-toggle-demo");
  btnDemo.addEventListener("click", () => {
    forceDemo = !forceDemo;
    if (forceDemo) {
      el("mode-label").textContent = "DEMO";
      renderDashboard(DEMO_DATA);
    } else if (lastLiveResponse?.hasData) {
      el("mode-label").textContent = "LIVE";
      renderDashboard(lastLiveResponse);
    } else {
      refresh();
    }
  });
}

setupControls();
renderDashboard(DEMO_DATA);
refresh();
setInterval(refresh, 30_000);
