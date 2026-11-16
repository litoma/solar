import { mountOrUpdateSimulationChart } from "./SimulationChart";

interface DashboardResponse {
  hasData: boolean;
  gatewayOnline?: boolean;
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
    code?: number;
    condition: string;
    tempC: number | null;
    text: string;
  } | null;
  latest: Record<string, number | null> | null;
  sellDayKwhComputed: number;
  pvDayKwh?: {
    pv1: number;
    pv2: number;
    pv3: number;
    pv4: number;
  };
  snapshot: {
    ts: number;
    cells_mv: number[];
    temps_c: number[];
  } | null;
  series: Record<string, number | null>[];
}

// 待機買電 (PCS制御維持のための微小買電) とみなす上限 (kW = 80W)
const STANDBY_BUY_MAX_KW = 0.08;

let refreshTimerId: number | null = null;
let currentRefreshSec = 60;

function el<T extends HTMLElement | SVGElement>(id: string): T {
  return document.getElementById(id) as unknown as T;
}

function kwHtml(kw: number, unitClass = "ef-unit"): string {
  return `${kw.toFixed(2)}<span class="${unitClass}">kW</span>`;
}

function kwhDayHtml(kwh: number): string {
  return `${kwh.toFixed(1)} kWh/d`;
}

function formatTimeJst(
  epochSec: number,
  tzOffsetMin = 540,
): { text: string; minutesOfDay: number; month: number } {
  const d = new Date((epochSec + tzOffsetMin * 60) * 1000);
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  const month = d.getUTCMonth() + 1;
  return {
    text: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
    minutesOfDay: hh * 60 + mm,
    month,
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

/**
 * 天気コード/状態と昼夜に応じたミニマルなベクターアイコンSVGを返す
 */
function buildWeatherIconSvg(
  condition: string,
  isNight: boolean,
): { svg: string; ringColor: string; glowColor: string } {
  const cond = (condition || "CLEAR").toUpperCase();

  if (cond.includes("THUNDER")) {
    return {
      ringColor: "#d7bd72",
      glowColor: "rgba(251, 221, 132, 0.20)",
      svg: `
        <path d="M-5.5,0.5 H4.5 A3.2,3.2 0 0,0 4.5,-5.8 A4.2,4.2 0 0,0 -3.5,-6.5 A3.4,3.4 0 0,0 -5.5,0.5 Z"
              fill="#353740" stroke="#d9dce3" stroke-width="1.3" stroke-linejoin="round" />
        <path d="M0.5,0.5 L-1.8,4.6 H0.8 L-0.8,8.2 L3.2,3.6 H0.6 Z"
              fill="#fbdd84" stroke="#fbdd84" stroke-width="0.6" stroke-linejoin="round" />
      `,
    };
  }

  if (
    cond.includes("DRIZZLE") ||
    cond.includes("RAIN") ||
    cond.includes("SHOWER")
  ) {
    return {
      ringColor: "#74aede",
      glowColor: "rgba(136, 205, 255, 0.20)",
      svg: `
        <path d="M-5.5,0.2 H4.5 A3.2,3.2 0 0,0 4.5,-6.0 A4.2,4.2 0 0,0 -3.5,-6.7 A3.4,3.4 0 0,0 -5.5,0.2 Z"
              fill="#313842" stroke="#d9dce3" stroke-width="1.35" stroke-linejoin="round" />
        <line x1="-3.5" y1="2.6" x2="-4.6" y2="6.2" stroke="#88cdff" stroke-width="1.4" stroke-linecap="round" />
        <line x1="0.2" y1="2.6" x2="-0.9" y2="6.2" stroke="#88cdff" stroke-width="1.4" stroke-linecap="round" />
        <line x1="3.9" y1="2.6" x2="2.8" y2="6.2" stroke="#88cdff" stroke-width="1.4" stroke-linecap="round" />
      `,
    };
  }

  if (cond.includes("SNOW")) {
    return {
      ringColor: "#9cc9f0",
      glowColor: "rgba(180, 220, 255, 0.20)",
      svg: `
        <path d="M-5.5,0.2 H4.5 A3.2,3.2 0 0,0 4.5,-6.0 A4.2,4.2 0 0,0 -3.5,-6.7 A3.4,3.4 0 0,0 -5.5,0.2 Z"
              fill="#323640" stroke="#d9dce3" stroke-width="1.35" stroke-linejoin="round" />
        <circle cx="-3.2" cy="4.4" r="1.2" fill="#e5f3ff" />
        <circle cx="0.3" cy="5.4" r="1.2" fill="#e5f3ff" />
        <circle cx="3.8" cy="4.4" r="1.2" fill="#e5f3ff" />
      `,
    };
  }

  if (cond.includes("PARTLY") || cond.includes("MAINLY")) {
    return {
      ringColor: "#d7bd72",
      glowColor: "rgba(251, 221, 132, 0.18)",
      svg: `
        <circle cx="-3.2" cy="-3.2" r="3.4" fill="#fbdd84" />
        <path d="M-4.2,3.6 H5.0 A3.0,3.0 0 0,0 5.0,-2.2 A3.9,3.9 0 0,0 -2.4,-2.9 A3.1,3.1 0 0,0 -4.2,3.6 Z"
              fill="#353740" stroke="#e2e4ec" stroke-width="1.35" stroke-linejoin="round" />
      `,
    };
  }

  if (cond.includes("CLOUD") || cond.includes("FOG")) {
    return {
      ringColor: "#9a9ea6",
      glowColor: "rgba(180, 186, 198, 0.16)",
      svg: `
        <path d="M-5.5,2.8 H4.8 A3.3,3.3 0 0,0 4.8,-3.6 A4.3,4.3 0 0,0 -3.4,-4.4 A3.5,3.5 0 0,0 -5.5,2.8 Z"
              fill="#353740" stroke="#d9dce3" stroke-width="1.4" stroke-linejoin="round" />
      `,
    };
  }

  // CLEAR (快晴: 夜間は三日月、日中は太陽)
  if (isNight) {
    return {
      ringColor: "#d7bd72",
      glowColor: "rgba(251, 221, 132, 0.18)",
      svg: `
        <path d="M2.2,-5.8 A6.0,6.0 0 1,0 5.8,3.2 A4.6,4.6 0 1,1 2.2,-5.8 Z"
              fill="#fbdd84" />
      `,
    };
  }

  return {
    ringColor: "#d7bd72",
    glowColor: "rgba(251, 221, 132, 0.22)",
    svg: `
      <circle cx="0" cy="0" r="4.2" fill="#fbdd84" />
      <g stroke="#fbdd84" stroke-width="1.4" stroke-linecap="round">
        <line x1="0" y1="-8.0" x2="0" y2="-6.3" />
        <line x1="0" y1="6.3" x2="0" y2="8.0" />
        <line x1="-8.0" y1="0" x2="-6.3" y2="0" />
        <line x1="6.3" y1="0" x2="8.0" y2="0" />
        <line x1="-5.6" y1="-5.6" x2="-4.4" y2="-4.4" />
        <line x1="4.4" y1="4.4" x2="5.6" y2="5.6" />
        <line x1="5.6" y1="-5.6" x2="4.4" y2="-4.4" />
        <line x1="-4.4" y1="4.4" x2="-5.6" y2="5.6" />
      </g>
    `,
  };
}

function positionSunMarker(
  minutesOfDay: number,
  sunriseMin: number,
  sunsetMin: number,
  weather: DashboardResponse["weather"],
): void {
  const marker = el<SVGGElement>("sun-marker-group");
  const badgeGroup = el<SVGGElement>("sun-badge-group");
  const badgeTemp = el<SVGTextElement>("sun-badge-temp");
  const iconGroup = el<SVGGElement>("sun-weather-icon");
  const ring = el<SVGCircleElement>("sun-marker-ring");
  const glow = el<SVGCircleElement>("sun-marker-glow");

  const tempC = weather?.tempC;
  badgeTemp.textContent =
    typeof tempC === "number" ? `${Math.round(tempC)}°C` : "--°C";

  const isNight = minutesOfDay < sunriseMin || minutesOfDay > sunsetMin;
  const iconSpec = buildWeatherIconSvg(weather?.condition || "CLEAR", isNight);
  iconGroup.innerHTML = iconSpec.svg;
  ring.setAttribute("stroke", iconSpec.ringColor);
  glow.setAttribute("fill", iconSpec.glowColor);

  let pos: { x: number; y: number };
  if (minutesOfDay < sunriseMin) {
    const t = Math.max(0, Math.min(1, minutesOfDay / Math.max(1, sunriseMin)));
    pos = quadBezier(t, 52, 78, 99, 112, 146, 78);
    badgeGroup.setAttribute("transform", "translate(0, -22)");
  } else if (minutesOfDay <= sunsetMin) {
    const span = Math.max(60, sunsetMin - sunriseMin);
    const t = Math.max(0, Math.min(1, (minutesOfDay - sunriseMin) / span));
    pos = quadBezier(t, 146, 78, 300, -8, 454, 78);
    badgeGroup.setAttribute("transform", "translate(0, -24)");
  } else {
    const nightSpan = Math.max(1, 1440 - sunsetMin);
    const t = Math.max(0, Math.min(1, (minutesOfDay - sunsetMin) / nightSpan));
    pos = quadBezier(t, 454, 78, 501, 112, 548, 78);
    badgeGroup.setAttribute("transform", "translate(0, -22)");
  }

  marker.setAttribute(
    "transform",
    `translate(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`,
  );
}

/**
 * 送電線の点線はすべて送電元 (BUY=ピンク / SOLAR=黄色 / BATTERY=紫) の色で描画する
 * 1段目: BUY / SELL (y=68)
 * 2段目: SOLAR / USE (y=226)
 * 3段目: BATTERY (y=316)
 */
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
  // 待機買電 (<= 0.08kW) のときは買電アニメーション線を動かさない
  const buyActive = buyKw > STANDBY_BUY_MAX_KW;
  const sellActive = sellKw >= 0.02;
  const battCharging = battChargeKw >= 0.03; // 正 = 充電 (上から下)
  const battDischarging = battChargeKw <= -0.03; // 負 = 放電 (下から上)
  const battAbsKw = Math.abs(battChargeKw);

  // 1. BUY から出る線: 送電元は BUY (ピンク)
  setLine("line-buy", buyActive ? "active-buy" : null);

  // 2. SOLAR から出る線: 送電元は SOLAR (黄色)
  setLine("line-solar", solarActive ? "active-solar" : null);

  // 3. SELL へ入る線 & 中段縦ライン (y=68 <-> y=226)
  if (sellActive) {
    // 売電時の送電元は SOLAR (または放電中の BATTERY)
    const exportColor = solarActive ? "active-solar" : "active-battery";
    setLine("line-sell", exportColor);
    setLine("line-trunk-mid", `${exportColor} flow-reverse`);
  } else {
    setLine("line-sell", null);
    if (buyActive && (useActive || battCharging)) {
      // 買電して USE または BATTERY へ送る場合、送電元は BUY (ピンク・上から下)
      setLine("line-trunk-mid", "active-buy");
    } else {
      setLine("line-trunk-mid", null);
    }
  }

  // 4. BATTERY 縦ライン (y=226 <-> y=316)
  if (battDischarging) {
    // 放電時: 送電元は BATTERY (紫・下から上)
    setLine("line-batt", "active-battery flow-reverse");
  } else if (battCharging) {
    // 充電時: 送電元は SOLAR (黄色) または BUY (ピンク) (上から下)
    const chargeSourceColor = solarActive ? "active-solar" : "active-buy";
    setLine("line-batt", chargeSourceColor);
  } else {
    setLine("line-batt", null);
  }

  // 5. USE へ入る線: 主たる送電元の色にする (SOLAR=黄色 / BATTERY=紫 / BUY=ピンク)
  if (useActive) {
    let useSourceColor = "active-solar";
    if (solarActive && (!battDischarging || solarKw >= battAbsKw)) {
      useSourceColor = "active-solar";
    } else if (battDischarging) {
      useSourceColor = "active-battery";
    } else if (buyActive) {
      useSourceColor = "active-buy";
    }
    setLine("line-use", useSourceColor);
  } else {
    setLine("line-use", null);
  }
}

function renderDashboard(data: DashboardResponse): void {
  const cfg = data.config;
  const tzMin = cfg.timezoneOffsetMinutes ?? 540;

  el("sun-rise-label").textContent = data.sun.sunrise;
  el("sun-noon-label").textContent = "12:00";
  el("sun-set-label").textContent = data.sun.sunset;
  el("val-batt-cap").textContent = `MAX ${cfg.batteryCapacityKwh.toFixed(1)} kWh`;

  const statusPill = el("ef-status-pill");
  const statusText = el("ef-status-text");

  const latest = data.latest;
  if (!latest) {
    const nowSec = Math.floor(Date.now() / 1000);
    const { text: timeText, minutesOfDay, month } = formatTimeJst(nowSec, tzMin);
    el("ef-time").textContent = timeText;
    mountOrUpdateSimulationChart(month);
    positionSunMarker(
      minutesOfDay,
      data.sun.sunriseMin,
      data.sun.sunsetMin,
      data.weather,
    );
    statusPill.dataset.state = "offline";
    statusText.textContent = "OFFLINE";
    return;
  }

  const ts =
    typeof latest.ts === "number" ? latest.ts : Math.floor(Date.now() / 1000);
  const { text: timeText, minutesOfDay, month } = formatTimeJst(ts, tzMin);
  el("ef-time").textContent = timeText;
  mountOrUpdateSimulationChart(month);

  // IoT (192.168.0.36) との接続状態: 直近データが取得できていれば ONLINE、古ければ OFFLINE
  const clientNowSec = Math.floor(Date.now() / 1000);
  const isOnline =
    typeof data.gatewayOnline === "boolean"
      ? data.gatewayOnline
      : Math.abs(clientNowSec - ts) <= 240;
  statusPill.dataset.state = isOnline ? "online" : "offline";
  statusText.textContent = isOnline ? "ONLINE" : "OFFLINE";

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

  // バッテリー電力は 正=充電, 負=放電
  const battChargeKw = -battW / 1000;
  const battAbsKw = Math.abs(battChargeKw);

  const solarKw = Math.max(0, solarW) / 1000;
  const useKw = Math.max(0, loadW) / 1000;
  const buyKw = gridW > 0 ? gridW / 1000 : 0;
  const sellKw = gridW < 0 ? -gridW / 1000 : 0;
  const isStandbyBuy = buyKw > 0.004 && buyKw <= STANDBY_BUY_MAX_KW;

  positionSunMarker(
    minutesOfDay,
    data.sun.sunriseMin,
    data.sun.sunsetMin,
    data.weather,
  );

  // 日積算 (kWh/d) & 金額換算 (¥)
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
      ? Math.round(
          Math.max(0, Math.min(100, ((useToday - buyToday) / useToday) * 100)),
        )
      : 100;

  // BUY カード
  el("val-buy-kw").innerHTML = kwHtml(buyKw);
  const buyBadge = el("buy-mode-badge");
  if (isStandbyBuy) {
    buyBadge.removeAttribute("hidden");
  } else {
    buyBadge.setAttribute("hidden", "");
  }
  el("val-buy-today").innerHTML = kwhDayHtml(buyToday);
  el("val-buy-yen").textContent = `COST ¥${buyCostYen.toLocaleString("ja-JP")}`;

  // SELL カード
  el("val-sell-kw").innerHTML = kwHtml(sellKw);
  el("val-sell-today").innerHTML = kwhDayHtml(sellToday);
  el("val-sell-yen").textContent = `REV ¥${sellRevYen.toLocaleString("ja-JP")}`;

  // SOLAR カード
  el("val-solar-kw").innerHTML = kwHtml(solarKw);
  el("val-solar-today").innerHTML = kwhDayHtml(solarToday);
  el("val-solar-yen").textContent =
    `VALUE ¥${solarValueYen.toLocaleString("ja-JP")}`;

  // USE カード
  el("val-use-kw").innerHTML = kwHtml(useKw);
  el("val-use-today").innerHTML = kwhDayHtml(useToday);
  el("val-use-self").textContent = `SELF ${selfPct}%`;

  // フロー接続線 (送電元の色で描画)
  updateFlowLines(solarKw, useKw, buyKw, sellKw, battChargeKw);

  // BATTERY カード
  const soc = Math.max(0, Math.min(100, Math.round(latest.soc ?? 0)));
  const capKwh = cfg.batteryCapacityKwh;
  const storedKwh = (capKwh * soc) / 100;

  let battStateLabel = "IDLE";
  if (battChargeKw >= 0.03) battStateLabel = "CHARGING";
  else if (battChargeKw <= -0.03) battStateLabel = "DISCHARGING";
  const displayBattKw = battStateLabel === "IDLE" ? 0 : battAbsKw;

  el("val-batt-state").textContent = battStateLabel;
  el("val-batt-kw").innerHTML = kwHtml(displayBattKw);
  el("val-batt-soc").textContent = `${soc}% (${storedKwh.toFixed(1)} kWh)`;
  el("val-batt-bar").style.width = `${soc}%`;

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

  // PV STRINGS (単位: kW & 1日発電量: kWh/d)
  el("pv-total-pill").textContent =
    `TOTAL ${(Math.max(0, pvSumW) / 1000).toFixed(2)} kW`;

  // サーバー側計算の pvDayKwh (無い場合は series から積算)
  const pvDayMap: Record<number, number> = {
    1: data.pvDayKwh?.pv1 ?? 0,
    2: data.pvDayKwh?.pv2 ?? 0,
    3: data.pvDayKwh?.pv3 ?? 0,
    4: data.pvDayKwh?.pv4 ?? 0,
  };
  if (!data.pvDayKwh && Array.isArray(data.series)) {
    for (let i = 1; i <= 4; i++) {
      let wh = 0;
      for (const r of data.series) {
        const w = r[`pv${i}_p_avg_w`];
        if (typeof w === "number" && w > 0) wh += w / 60;
      }
      pvDayMap[i] = wh / 1000;
    }
  }

  for (let i = 1; i <= 4; i++) {
    const p = latest[`pv${i}_p_avg_w`];
    const pKw = typeof p === "number" ? Math.max(0, p) / 1000 : 0;
    el(`pv${i}-w`).innerHTML = kwHtml(pKw, "ef-unit-sm");
    el(`pv${i}-day`).innerHTML = kwhDayHtml(pvDayMap[i] ?? 0);

    const roofGroup = document.getElementById(`roof-group-pv${i}`);
    if (roofGroup) {
      roofGroup.classList.toggle("is-active", typeof p === "number" && p >= 10);
    }
  }

  // BMS STATUS (PACK / CELL / TEMP の3要素)
  const packV = latest.pack_v;
  const cMin = latest.cell_min_mv;
  const cMax = latest.cell_max_mv;
  const cAvg = latest.cell_avg_mv;
  const tMin = latest.temp_min_c;
  const tMax = latest.temp_max_c;
  const tAvg = latest.temp_avg_c;

  const cells = data.snapshot?.cells_mv || [];
  let minCellIdx = -1;
  if (cells.length > 0) {
    const minMvVal = Math.min(...cells);
    minCellIdx = cells.indexOf(minMvVal);
  }

  // 1. PACK 要素
  const avgCellVFromPack =
    typeof packV === "number" ? (packV / 48).toFixed(3) : "--";
  el("bms-pack-val").textContent =
    typeof packV === "number" ? `${packV.toFixed(1)} V` : "-- V";
  el("bms-pack-sub").textContent = `平均 ${avgCellVFromPack} V × 48直列`;

  // 2. CELL 要素 (+ 48セル12列グリッド)
  const deltaMv =
    typeof cMax === "number" && typeof cMin === "number" ? cMax - cMin : null;
  const minCellText =
    minCellIdx >= 0
      ? ` / 最低 #${String(minCellIdx + 1).padStart(2, "0")}`
      : "";
  el("bms-cell-val").textContent = `${cMin ?? "--"}〜${cMax ?? "--"} mV`;
  el("bms-cell-sub").textContent =
    `AVG ${cAvg ?? "--"} mV / 差 Δ ${deltaMv ?? "--"} mV${minCellText}`;

  const cellBadge = el("bms-cell-badge");
  if (deltaMv === null) {
    cellBadge.textContent = "--";
    delete cellBadge.dataset.level;
  } else if (deltaMv <= 15) {
    cellBadge.textContent = `良好 (Δ${deltaMv}mV)`;
    delete cellBadge.dataset.level;
  } else if (deltaMv <= 30) {
    cellBadge.textContent = `標準 (Δ${deltaMv}mV)`;
    delete cellBadge.dataset.level;
  } else {
    cellBadge.textContent = `差拡大 (Δ${deltaMv}mV)`;
    cellBadge.dataset.level = "warn";
  }

  const cellsGrid = el("cells-grid");
  if (cells.length > 0) {
    cellsGrid.innerHTML = cells
      .map((mv, idx) => {
        const num = String(idx + 1).padStart(2, "0");
        return `<div class="cell-chip"><span class="cell-id">#${num}</span><span class="cell-mv">${mv}</span></div>`;
      })
      .join("");
  } else {
    cellsGrid.innerHTML = `<div class="cell-chip"><span class="cell-id">--</span><span class="cell-mv">未取得</span></div>`;
  }

  // 3. TEMP 要素
  const deltaTemp =
    typeof tMax === "number" && typeof tMin === "number" ? tMax - tMin : null;
  el("bms-temp-val").textContent = `${tMin ?? "--"}〜${tMax ?? "--"} °C`;
  el("bms-temp-sub").textContent =
    `AVG ${typeof tAvg === "number" ? tAvg.toFixed(1) : "--"} °C / 差 Δ ${deltaTemp ?? "--"} °C`;

  const tempBadge = el("bms-temp-badge");
  if (typeof tMin !== "number" || typeof tMax !== "number") {
    tempBadge.textContent = "--";
    delete tempBadge.dataset.level;
  } else if (tMax >= 40 || (deltaTemp !== null && deltaTemp >= 5)) {
    tempBadge.textContent = "高温/差注意";
    tempBadge.dataset.level = "warn";
  } else if (tMin <= 5) {
    tempBadge.textContent = "低温(充電制限域)";
    delete tempBadge.dataset.level;
  } else {
    tempBadge.textContent = "均一・正常";
    delete tempBadge.dataset.level;
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
  // 屋根マップと各PV項目のホバー連動
  for (let i = 1; i <= 4; i++) {
    const box = document.getElementById(`pv-box-${i}`);
    const roof = document.getElementById(`roof-group-pv${i}`);
    if (!box || !roof) continue;
    const enter = () => {
      box.classList.add("is-hovered");
      roof.classList.add("is-hovered");
    };
    const leave = () => {
      box.classList.remove("is-hovered");
      roof.classList.remove("is-hovered");
    };
    box.addEventListener("mouseenter", enter);
    box.addEventListener("mouseleave", leave);
    roof.addEventListener("mouseenter", enter);
    roof.addEventListener("mouseleave", leave);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refresh();
    }
  });
}

setupControls();
mountOrUpdateSimulationChart(formatTimeJst(Math.floor(Date.now() / 1000)).month);
refresh();
scheduleRefresh(currentRefreshSec);
