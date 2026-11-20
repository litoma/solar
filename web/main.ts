import { mountOrUpdatePaybackChart, type PaybackData } from "./PaybackChart";
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
    paybackTargetYen?: number;
    initialCostYen?: number;
    subsidyYen?: number;
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
  monthlyActualKwh?: Record<number, number>;
  payback?: PaybackData;
  snapshot: {
    ts: number;
    cells_mv: number[];
    temps_c: number[];
  } | null;
}

// 待機買電 (PCS制御維持のための微小買電) とみなす上限 (kW = 80W)
const STANDBY_BUY_MAX_KW = 0.08;

let refreshTimerId: number | null = null;
let currentRefreshSec = 60;
let refreshInFlight = false;

function el<T extends HTMLElement | SVGElement>(id: string): T {
  return document.getElementById(id) as unknown as T;
}

function kwHtml(kw: number, unitClass = "ef-unit"): string {
  return `${kw.toFixed(2)}<span class="${unitClass}">kW</span>`;
}

function kwhDayHtml(kwh: number): string {
  return `${kwh.toFixed(2)} kWh/d`;
}

function formatTimeJst(
  epochSec: number,
  tzOffsetMin = 540,
): { text: string; minutesOfDay: number; month: number; year: number } {
  const d = new Date((epochSec + tzOffsetMin * 60) * 1000);
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  return {
    text: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
    minutesOfDay: hh * 60 + mm,
    month,
    year,
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
 * 日没後・日の出前 (isNight=true) の外枠リングは水平線と同じグレー (#44454a) にする
 */
function buildWeatherIconSvg(
  condition: string,
  isNight: boolean,
): { svg: string; ringColor: string; glowColor: string } {
  const cond = (condition || "CLEAR").toUpperCase();
  const nightRing = "#44454a";
  const nightGlow = "rgba(110, 114, 126, 0.28)";
  const dayRing = "#d7bd72";
  const dayGlow = "rgba(251, 221, 132, 0.25)";

  if (cond.includes("THUNDER")) {
    return {
      ringColor: isNight ? nightRing : dayRing,
      glowColor: isNight ? nightGlow : dayGlow,
      svg: `<g transform="translate(0.5, 0.2)">
        <path d="M-5.5,0.5 H4.5 A3.2,3.2 0 0,0 4.5,-5.8 A4.2,4.2 0 0,0 -3.5,-6.5 A3.4,3.4 0 0,0 -5.5,0.5 Z"
              fill="#353740" stroke="#d9dce3" stroke-width="1.3" stroke-linejoin="round" />
        <path d="M0.5,0.5 L-1.8,4.6 H0.8 L-0.8,8.2 L3.2,3.6 H0.6 Z"
              fill="#fbdd84" stroke="#fbdd84" stroke-width="0.6" stroke-linejoin="round" />
      </g>`,
    };
  }

  if (
    cond.includes("DRIZZLE") ||
    cond.includes("RAIN") ||
    cond.includes("SHOWER")
  ) {
    return {
      ringColor: isNight ? nightRing : dayRing,
      glowColor: isNight ? nightGlow : dayGlow,
      svg: `<g transform="translate(0.5, 0.8)">
        <path d="M-5.5,0.2 H4.5 A3.2,3.2 0 0,0 4.5,-6.0 A4.2,4.2 0 0,0 -3.5,-6.7 A3.4,3.4 0 0,0 -5.5,0.2 Z"
              fill="#313842" stroke="#d9dce3" stroke-width="1.35" stroke-linejoin="round" />
        <line x1="-3.5" y1="2.6" x2="-4.6" y2="6.2" stroke="#88cdff" stroke-width="1.4" stroke-linecap="round" />
        <line x1="0.2" y1="2.6" x2="-0.9" y2="6.2" stroke="#88cdff" stroke-width="1.4" stroke-linecap="round" />
        <line x1="3.9" y1="2.6" x2="2.8" y2="6.2" stroke="#88cdff" stroke-width="1.4" stroke-linecap="round" />
      </g>`,
    };
  }

  if (cond.includes("SNOW")) {
    return {
      ringColor: isNight ? nightRing : dayRing,
      glowColor: isNight ? nightGlow : dayGlow,
      svg: `<g transform="translate(0.5, 0.8)">
        <path d="M-5.5,0.2 H4.5 A3.2,3.2 0 0,0 4.5,-6.0 A4.2,4.2 0 0,0 -3.5,-6.7 A3.4,3.4 0 0,0 -5.5,0.2 Z"
              fill="#323640" stroke="#d9dce3" stroke-width="1.35" stroke-linejoin="round" />
        <circle cx="-3.2" cy="4.4" r="1.2" fill="#e5f3ff" />
        <circle cx="0.3" cy="5.4" r="1.2" fill="#e5f3ff" />
        <circle cx="3.8" cy="4.4" r="1.2" fill="#e5f3ff" />
      </g>`,
    };
  }

  if (cond.includes("PARTLY") || cond.includes("MAINLY")) {
    return {
      ringColor: isNight ? nightRing : dayRing,
      glowColor: isNight ? nightGlow : dayGlow,
      svg: `<g transform="translate(0.3, 0.6)">
        <circle cx="-3.2" cy="-3.2" r="3.4" fill="#fbdd84" />
        <path d="M-4.2,3.6 H5.0 A3.0,3.0 0 0,0 5.0,-2.2 A3.9,3.9 0 0,0 -2.4,-2.9 A3.1,3.1 0 0,0 -4.2,3.6 Z"
              fill="#353740" stroke="#e2e4ec" stroke-width="1.35" stroke-linejoin="round" />
      </g>`,
    };
  }

  if (cond.includes("CLOUD") || cond.includes("FOG")) {
    return {
      ringColor: isNight ? nightRing : dayRing,
      glowColor: isNight ? nightGlow : dayGlow,
      svg: `<g transform="translate(0.4, 1.0)">
        <path d="M-5.5,2.8 H4.8 A3.3,3.3 0 0,0 4.8,-3.6 A4.3,4.3 0 0,0 -3.4,-4.4 A3.5,3.5 0 0,0 -5.5,2.8 Z"
              fill="#353740" stroke="#d9dce3" stroke-width="1.4" stroke-linejoin="round" />
      </g>`,
    };
  }

  // CLEAR (快晴: 夜間は三日月、日中は太陽)
  if (isNight) {
    return {
      ringColor: nightRing,
      glowColor: nightGlow,
      svg: `<g transform="translate(0.5, 0.5)">
        <path d="M2.2,-5.8 A6.0,6.0 0 1,0 5.8,3.2 A4.6,4.6 0 1,1 2.2,-5.8 Z"
              fill="#fbdd84" />
      </g>`,
    };
  }

  return {
    ringColor: dayRing,
    glowColor: dayGlow,
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
    // 00:00 〜 日の出: (12,98) -> (76,138) -> (140,98)
    const t = Math.max(0, Math.min(1, minutesOfDay / Math.max(1, sunriseMin)));
    pos = quadBezier(t, 12, 98, 76, 138, 140, 98);
    badgeGroup.setAttribute("transform", "translate(0, -22)");
  } else if (minutesOfDay <= sunsetMin) {
    // 日の出 〜 日の入り: (140,98) -> (300,-26) -> (460,98)
    const span = Math.max(60, sunsetMin - sunriseMin);
    const t = Math.max(0, Math.min(1, (minutesOfDay - sunriseMin) / span));
    pos = quadBezier(t, 140, 98, 300, -26, 460, 98);
    badgeGroup.setAttribute("transform", "translate(0, -24)");
  } else {
    // 日の入り 〜 24:00: (460,98) -> (524,138) -> (588,98)
    const nightSpan = Math.max(1, 1440 - sunsetMin);
    const t = Math.max(0, Math.min(1, (minutesOfDay - sunsetMin) / nightSpan));
    pos = quadBezier(t, 460, 98, 524, 138, 588, 98);
    badgeGroup.setAttribute("transform", "translate(0, -22)");
  }

  marker.setAttribute(
    "transform",
    `translate(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`,
  );
}

/**
 * 送電線の点線はすべて送電元 (BUY=ピンク / SOLAR=黄色 / BATTERY=紫) の色で描画する
 * 1段目: SOLAR / USE
 * 2段目: BATTERY (中央)
 * 3段目: BUY / SELL
 */
function updateFlowLines(
  solarKw: number,
  useKw: number,
  buyKw: number,
  sellKw: number,
  battChargeKw: number,
  battDischarging: boolean,
  battCharging: boolean,
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
  const battAbsKw = Math.abs(battChargeKw);

  // 1. BUY から出る線: 送電元は BUY (ピンク)
  setLine("line-buy", buyActive ? "active-buy" : null);

  // 2. SOLAR から出る線: 送電元は SOLAR (黄色)
  setLine("line-solar", solarActive ? "active-solar" : null);

  // 3. SELL へ入る線 & 下段縦ライン (BATTERY <-> BUY/SELL)
  if (sellActive && (solarActive || battDischarging)) {
    const exportColor = solarActive ? "active-solar" : "active-battery";
    setLine("line-sell", exportColor);
    setLine("line-trunk-low", exportColor);
  } else {
    setLine("line-sell", null);
    if (buyActive && (useActive || battCharging)) {
      // 買電して BATTERY 経由で USE または BATTERY 充電へ送る (ピンク・下から上)
      setLine("line-trunk-low", "active-buy flow-reverse");
    } else {
      setLine("line-trunk-low", null);
    }
  }

  // 4. 上段縦ライン (SOLAR/USE <-> BATTERY)
  if (battDischarging) {
    // 放電時: 送電元は BATTERY (紫・下から上)
    setLine("line-trunk-high", "active-battery flow-reverse");
  } else if (battCharging && solarActive) {
    // 太陽光から充電時: 送電元は SOLAR (黄色・上から下)
    setLine("line-trunk-high", "active-solar");
  } else if (buyActive && useActive) {
    // 買電して BATTERY 経由で USE へ供給時: 送電元は BUY (ピンク・下から上)
    setLine("line-trunk-high", "active-buy flow-reverse");
  } else {
    setLine("line-trunk-high", null);
  }

  // 5. USE へ入る線: 実際に動いている送電元 (SOLAR / BATTERY / BUY) があるときのみ同じ色で点灯
  if (useActive) {
    let useSourceColor: string | null = null;
    if (solarActive && (!battDischarging || solarKw >= battAbsKw)) {
      useSourceColor = "active-solar";
    } else if (battDischarging) {
      useSourceColor = "active-battery";
    } else if (buyActive) {
      useSourceColor = "active-buy";
    } else if (solarActive) {
      useSourceColor = "active-solar";
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

  const fallbackPayback: PaybackData = data.payback || {
    targetYen: cfg.paybackTargetYen ?? 1100000,
    initialCostYen: cfg.initialCostYen ?? 3500000,
    subsidyYen: cfg.subsidyYen ?? 2400000,
    totalSolarKwh: 0,
    totalSellKwh: 0,
    totalBenefitYen: 0,
    activeDays: 0,
    firstDate: null,
    byYearMonth: {},
  };
  const latest = data.latest;
  if (!latest) {
    const nowSec = Math.floor(Date.now() / 1000);
    const { text: timeText, minutesOfDay, month, year } = formatTimeJst(
      nowSec,
      tzMin,
    );
    el("ef-time").textContent = `${timeText} UPDATE`;
    mountOrUpdateSimulationChart(month, data.monthlyActualKwh || {});
    mountOrUpdatePaybackChart(
      fallbackPayback,
      cfg.buyPriceYenPerKwh,
      year,
      month,
    );
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
  const { text: timeText, minutesOfDay, month, year } = formatTimeJst(
    ts,
    tzMin,
  );
  el("ef-time").textContent = `${timeText} UPDATE`;
  mountOrUpdateSimulationChart(month, data.monthlyActualKwh || {});
  mountOrUpdatePaybackChart(
    fallbackPayback,
    cfg.buyPriceYenPerKwh,
    year,
    month,
  );

  // IoT (192.168.0.36) との接続状態: 直近データが取得できていれば ONLINE、古ければ OFFLINE
  const clientNowSec = Math.floor(Date.now() / 1000);
  const isOnline =
    typeof data.gatewayOnline === "boolean"
      ? data.gatewayOnline
      : Math.abs(clientNowSec - ts) <= 300;
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

  const solarActive = solarKw >= 0.02;
  const useActive = useKw >= 0.02;
  const buyActive = buyKw > STANDBY_BUY_MAX_KW;
  const soc = Math.max(0, Math.min(100, Math.round(latest.soc ?? 0)));

  // 夜間・非発電時で待機買電のみ(buyActive=false)かつ負荷(useActive)がある場合、
  // BMSの瞬時サンプル(batt_w)が小さくても実際には蓄電池から負荷へ給電している
  const inferredBattDischargeKw =
    !solarActive && !buyActive && useActive && soc > 5 && battChargeKw <= 0.01
      ? Math.max(battAbsKw, Math.max(0, useKw - buyKw))
      : battAbsKw;

  const battCharging = battChargeKw >= 0.03;
  const battDischarging =
    !battCharging &&
    (battChargeKw <= -0.02 ||
      (!solarActive && !buyActive && useActive && inferredBattDischargeKw >= 0.02));

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
  updateFlowLines(
    solarKw,
    useKw,
    buyKw,
    sellKw,
    battChargeKw,
    battDischarging,
    battCharging,
  );

  // BATTERY カード
  const capKwh = cfg.batteryCapacityKwh;
  const storedKwh = (capKwh * soc) / 100;

  let battStateLabel = "IDLE";
  if (battCharging) battStateLabel = "CHARGING";
  else if (battDischarging) battStateLabel = "DISCHARGING";
  const displayBattKw =
    battStateLabel === "IDLE"
      ? 0
      : battDischarging
        ? inferredBattDischargeKw
        : battAbsKw;

  el("val-batt-state").textContent = battStateLabel;
  el("val-batt-kw").innerHTML = kwHtml(displayBattKw);
  el("val-batt-soc").textContent = `${soc}% (${storedKwh.toFixed(1)} kWh)`;
  el("val-batt-bar").style.width = `${soc}%`;

  // 推定残り時間 EST (残量kWh ÷ 使用電力useKw)
  const refPowerKw = useKw > 0.02 ? useKw : displayBattKw > 0.02 ? displayBattKw : 0;
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

  const pvDayMap: Record<number, number> = {
    1: data.pvDayKwh?.pv1 ?? 0,
    2: data.pvDayKwh?.pv2 ?? 0,
    3: data.pvDayKwh?.pv3 ?? 0,
    4: data.pvDayKwh?.pv4 ?? 0,
  };

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

  // BMS STATUS (1: PACK → 2: TEMP → 3: CELL)
  const packV = latest.pack_v;
  const cMin = latest.cell_min_mv;
  const cMax = latest.cell_max_mv;
  const cAvg = latest.cell_avg_mv;
  const tMin = latest.temp_min_c;
  const tMax = latest.temp_max_c;
  const tAvg = latest.temp_avg_c;

  const cells = data.snapshot?.cells_mv || [];
  const temps = data.snapshot?.temps_c || [];
  let minCellIdx = -1;
  if (cells.length > 0) {
    const minMvVal = Math.min(...cells);
    minCellIdx = cells.indexOf(minMvVal);
  }

  // 1. PACK 要素 (平均セル電圧×48との整合性チェック)
  const avgCellVFromPack =
    typeof packV === "number" ? (packV / 48).toFixed(3) : "--";
  const expectedPackFromCells =
    typeof cAvg === "number" ? (cAvg * 48) / 1000 : null;
  const packDiff =
    typeof packV === "number" && expectedPackFromCells !== null
      ? Math.abs(packV - expectedPackFromCells)
      : null;

  el("bms-pack-val").textContent =
    typeof packV === "number" ? `${packV.toFixed(1)} V` : "-- V";
  el("bms-pack-sub").textContent =
    expectedPackFromCells !== null
      ? `平均 ${avgCellVFromPack} V × 48 = ${expectedPackFromCells.toFixed(1)} V`
      : `平均 ${avgCellVFromPack} V × 48直列`;

  const packBadge = el("bms-pack-badge");
  if (packDiff !== null && packDiff <= 1.5) {
    packBadge.textContent = "整合性OK (48S LFP)";
    delete packBadge.dataset.level;
  } else if (packDiff !== null) {
    packBadge.textContent = `差 ${packDiff.toFixed(1)}V`;
    packBadge.dataset.level = "warn";
  } else {
    packBadge.textContent = "48S LFP";
    delete packBadge.dataset.level;
  }

  // 2. TEMP 要素 (+ 2行×8列の16温度センサーグリッド)
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

  const tempsGrid = el("temps-grid");
  if (temps.length > 0) {
    tempsGrid.innerHTML = temps
      .map((tc, idx) => {
        const num = String(idx + 1).padStart(2, "0");
        return `<div class="cell-chip"><span class="cell-id">#${num}</span><span class="cell-mv">${tc}°C</span></div>`;
      })
      .join("");
  } else {
    tempsGrid.innerHTML = `<div class="cell-chip"><span class="cell-id">--</span><span class="cell-mv">未取得</span></div>`;
  }

  // 3. CELL 要素 (+ 4行×12列の48セルグリッド)
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
}

function stopRefresh(): void {
  if (refreshTimerId !== null) {
    window.clearInterval(refreshTimerId);
    refreshTimerId = null;
  }
}

function scheduleRefresh(intervalSec: number, forceRestart = false): void {
  const sec = Math.max(10, intervalSec);
  const changed = sec !== currentRefreshSec;
  currentRefreshSec = sec;
  // 非表示タブではバックグラウンド更新を行わない
  if (document.hidden) {
    stopRefresh();
    return;
  }
  if (refreshTimerId !== null && !changed && !forceRestart) return;
  stopRefresh();
  refreshTimerId = window.setInterval(refresh, sec * 1000);
}

async function refresh(): Promise<void> {
  if (document.hidden || refreshInFlight) return;
  refreshInFlight = true;
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
  } finally {
    refreshInFlight = false;
  }
}

function setupControls(): void {
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

  // PV STRINGS ページ送り (横スクロールスナップ + ドットクリック連動)
  const pvPager = document.getElementById("pv-pager");
  const pvDots = Array.from(
    document.querySelectorAll<HTMLButtonElement>("#pv-dots .pv-dot"),
  );
  if (pvPager && pvDots.length > 0) {
    const updateDots = (activeIdx: number) => {
      pvDots.forEach((btn, idx) => {
        const isAct = idx === activeIdx;
        btn.classList.toggle("is-active", isAct);
        btn.setAttribute("aria-selected", isAct ? "true" : "false");
      });
    };
    pvPager.addEventListener("scroll", () => {
      const idx = Math.round(
        pvPager.scrollLeft / Math.max(1, pvPager.clientWidth),
      );
      updateDots(idx);
    });
    pvDots.forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.page || 0);
        pvPager.scrollTo({
          left: idx * pvPager.clientWidth,
          behavior: "smooth",
        });
        updateDots(idx);
      });
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopRefresh();
    } else if (document.visibilityState === "visible") {
      refresh();
      scheduleRefresh(currentRefreshSec, true);
    }
  });
}

setupControls();
const initTime = formatTimeJst(Math.floor(Date.now() / 1000));
mountOrUpdateSimulationChart(initTime.month);
mountOrUpdatePaybackChart(
  {
    targetYen: 1100000,
    initialCostYen: 3500000,
    subsidyYen: 2400000,
    totalSolarKwh: 0,
    totalSellKwh: 0,
    totalBenefitYen: 0,
    activeDays: 0,
    firstDate: null,
    byYearMonth: {},
  },
  35,
  initTime.year,
  initTime.month,
);
refresh();
scheduleRefresh(currentRefreshSec);
