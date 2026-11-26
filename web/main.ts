import { mountOrUpdatePaybackChart, type PaybackData } from "./PaybackChart";
import { mountOrUpdatePvCharts, type PvMonthlyRecord } from "./PvCharts";
import {
  PV_BASE_COLORS,
  buildRoofSolarGlb,
  computeSolarSnapshot,
  srgbToLinear,
  type RGB,
} from "./RoofModel3D";
import { mountOrUpdateSimulationChart } from "./SimulationChart";
import {
  mountOrUpdateSummaryCharts,
  type DailyFlowEdge,
  type MonthlyTotalsData,
} from "./SummaryCharts";

interface SolarMaterial {
  name: string;
  setEmissiveFactor(rgb: RGB | string): void;
  setEmissiveStrength?(strength: number): void;
  pbrMetallicRoughness: {
    setBaseColorFactor(rgba: [number, number, number, number]): void;
  };
}

interface SolarModelViewerElement extends HTMLElement {
  src: string;
  model?: {
    getMaterialByName(name: string): SolarMaterial | null;
  };
  getCameraOrbit?(): { theta: number; phi: number; radius: number; toString(): string };
  getCameraTarget?(): { toString(): string };
  cameraOrbit: string;
  cameraTarget: string;
  materialFromPoint?(x: number, y: number): SolarMaterial | null;
  updateHotspot?(cfg: { name: string; position?: string; normal?: string }): void;
}

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
  todayBatteryChgKwh?: number | null;
  todayBatteryDischgKwh?: number | null;
  todayFlows?: DailyFlowEdge[];
  pvDayKwh?: {
    pv1: number;
    pv2: number;
    pv3: number;
    pv4: number;
  };
  pvMonthlyByYear?: Record<string, PvMonthlyRecord[]>;
  pvMonthly?: PvMonthlyRecord[];
  monthlyAvgKwh?: {
    solar: number | null;
    use: number | null;
    buy: number | null;
    sell: number | null;
    pv1?: number | null;
    pv2?: number | null;
    pv3?: number | null;
    pv4?: number | null;
  };
  monthlyTotals?: MonthlyTotalsData;
  monthlyActualKwh?: Record<number, number>;
  monthlyActualByYear?: Record<string, Record<string, number>>;
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
let selectedSimYear: number | null = null;
let latestSimYearMap: Record<number, Record<number, number>> = {};
let latestPvYearMap: Record<number, PvMonthlyRecord[]> = {};
let latestSimCurrentYear = new Date().getFullYear();
let latestSimCurrentMonth = new Date().getMonth() + 1;
let pvViewerInitStarted = false;
let pvViewerBlobUrl: string | null = null;
let pvViewerLastKey = "";
let pvViewerLat = 35.7356;
let pvViewerLon = 139.6517;
const pvActiveState: Record<1 | 2 | 3 | 4, boolean> = {
  1: false,
  2: false,
  3: false,
  4: false,
};
let pvHoveredIdx: 1 | 2 | 3 | 4 | null = null;

function applyPv3dMaterials(mv: SolarModelViewerElement | null): void {
  const model = mv?.model;
  if (!model) return;
  for (const pv of [1, 2, 3, 4] as const) {
    const base = PV_BASE_COLORS[pv];
    const active = pvActiveState[pv];
    const hovered = pvHoveredIdx === pv;
    const fillMat = model.getMaterialByName(`pv${pv}_fill`);
    const edgeMat = model.getMaterialByName(`pv${pv}_edge`);
    const fillScale = hovered ? 0.96 : active ? 0.85 : 0.72;
    const emissiveScale = hovered ? 1.0 : active ? 0.95 : 0.84;
    const fillStrength = hovered ? 2.1 : active ? 1.65 : 1.25;
    const edgeStrength = hovered ? 2.75 : active ? 2.3 : 1.9;

    const linFill = srgbToLinear(base, fillScale);
    const linEmissive = srgbToLinear(base, emissiveScale);
    const linEdge = srgbToLinear(base, 1.0);

    fillMat?.pbrMetallicRoughness.setBaseColorFactor([
      linFill[0],
      linFill[1],
      linFill[2],
      1,
    ]);
    fillMat?.setEmissiveFactor(linEmissive);
    fillMat?.setEmissiveStrength?.(fillStrength);
    edgeMat?.pbrMetallicRoughness.setBaseColorFactor([
      linEdge[0] * 0.18,
      linEdge[1] * 0.18,
      linEdge[2] * 0.18,
      1,
    ]);
    edgeMat?.setEmissiveFactor(linEdge);
    edgeMat?.setEmissiveStrength?.(edgeStrength);
  }
}

const PV_FACE_AZIMUTH_DEG: Record<1 | 2 | 3 | 4, number> = {
  1: -90, // WEST (-X)
  2: 90,  // EAST (+X)
  3: -90, // WEST (-X)
  4: 180, // NORTH (-Z)
};

function focusPvRoofFace(pv: 1 | 2 | 3 | 4): void {
  const mv = document.getElementById("pv-roof-viewer") as SolarModelViewerElement | null;
  if (!mv) return;
  const curOrbit = mv.getCameraOrbit?.();
  const curDeg =
    curOrbit && Number.isFinite(curOrbit.theta)
      ? (curOrbit.theta * 180) / Math.PI
      : 58;
  const targetDeg = PV_FACE_AZIMUTH_DEG[pv];
  const delta = (((targetDeg - curDeg) % 360) + 540) % 360 - 180;
  const nextDeg = curDeg + delta;
  mv.cameraOrbit = `${nextDeg.toFixed(1)}deg 58deg 92%`;
  setPvHovered(pv);
}

function setPvHovered(idx: 1 | 2 | 3 | 4 | null): void {
  if (pvHoveredIdx === idx) return;
  pvHoveredIdx = idx;
  for (const pv of [1, 2, 3, 4] as const) {
    document.getElementById(`pv-box-${pv}`)?.classList.toggle("is-hovered", idx === pv);
  }
  const mv = document.getElementById("pv-roof-viewer") as SolarModelViewerElement | null;
  applyPv3dMaterials(mv);
}

function syncPv3dScene(lat: number, lon: number, now = new Date()): void {
  pvViewerLat = lat;
  pvViewerLon = lon;
  const mv = document.getElementById("pv-roof-viewer") as SolarModelViewerElement | null;
  if (!mv) return;

  if (!pvViewerInitStarted) {
    pvViewerInitStarted = true;
    void import("@google/model-viewer/dist/model-viewer.min.js");
  }

  const snapshot = computeSolarSnapshot(now, lat, lon);
  const readout = document.getElementById("pv-3d-sun-readout");
  if (readout) {
    readout.textContent = snapshot.isDaylight
      ? `ALT ${Math.round(snapshot.altitudeDeg)}° · AZ ${Math.round(snapshot.azimuthDeg)}°`
      : `NIGHT · ALT ${Math.round(snapshot.altitudeDeg)}°`;
  }

  const bucket = Math.floor(now.getTime() / 120000);
  const key = `${lat.toFixed(4)},${lon.toFixed(4)},${bucket}`;
  if (key === pvViewerLastKey) return;
  pvViewerLastKey = key;

  // 既存の操作カメラアングルを維持しつつGLB差し替え
  if (pvViewerBlobUrl) {
    const prevOrbit = mv.getCameraOrbit?.()?.toString();
    const prevTarget = mv.getCameraTarget?.()?.toString();
    if (prevOrbit && !prevOrbit.includes("NaN")) mv.cameraOrbit = prevOrbit;
    if (prevTarget && !prevTarget.includes("NaN")) mv.cameraTarget = prevTarget;
  }

  const glb = buildRoofSolarGlb(snapshot, lat);
  const nextUrl = URL.createObjectURL(
    new Blob([glb as unknown as BlobPart], { type: "model/gltf-binary" }),
  );
  const oldUrl = pvViewerBlobUrl;
  pvViewerBlobUrl = nextUrl;
  mv.src = nextUrl;
  if (oldUrl) {
    window.setTimeout(() => URL.revokeObjectURL(oldUrl), 5000);
  }
}

function extractMonthlyActualByYear(
  data: DashboardResponse,
  currentYear: number,
): Record<number, Record<number, number>> {
  const result: Record<number, Record<number, number>> = {};
  if (data.monthlyActualByYear) {
    for (const [yStr, months] of Object.entries(data.monthlyActualByYear)) {
      const y = Number(yStr);
      if (!Number.isInteger(y) || y <= 0 || !months) continue;
      result[y] = {};
      for (const [mStr, kwh] of Object.entries(months)) {
        const m = Number(mStr);
        if (m >= 1 && m <= 12 && typeof kwh === "number" && Number.isFinite(kwh)) {
          result[y][m] = kwh;
        }
      }
    }
  } else if (data.payback?.byYearMonth) {
    for (const [ym, stat] of Object.entries(data.payback.byYearMonth)) {
      const mMatch = /^(\d{4})-(\d{2})$/.exec(ym);
      if (!mMatch) continue;
      const y = Number(mMatch[1]);
      const m = Number(mMatch[2]);
      if (!result[y]) result[y] = {};
      result[y][m] = stat.solarKwh;
    }
  }
  if (!result[currentYear]) {
    result[currentYear] = {};
  }
  if (
    Object.keys(result[currentYear]).length === 0 &&
    data.monthlyActualKwh
  ) {
    result[currentYear] = { ...data.monthlyActualKwh };
  }
  return result;
}

function extractPvMonthlyByYear(
  data: DashboardResponse,
  currentYear: number,
): Record<number, PvMonthlyRecord[]> {
  const result: Record<number, PvMonthlyRecord[]> = {};
  if (data.pvMonthlyByYear) {
    for (const [yStr, list] of Object.entries(data.pvMonthlyByYear)) {
      const y = Number(yStr);
      if (!Number.isInteger(y) || y <= 0 || !Array.isArray(list)) continue;
      result[y] = list;
    }
  } else if (Array.isArray(data.pvMonthly)) {
    for (const rec of data.pvMonthly) {
      const m = /^(\d{4})-(\d{2})$/.exec(rec.ym || "");
      const y = m ? Number(m[1]) : currentYear;
      if (!result[y]) result[y] = [];
      result[y].push(rec);
    }
  }
  if (!result[currentYear]) {
    result[currentYear] = [];
  }
  return result;
}

function syncSimYearSelector(
  yearMap: Record<number, Record<number, number>>,
  pvYearMap: Record<number, PvMonthlyRecord[]>,
  currentYear: number,
): number {
  const yearSet = new Set<number>([currentYear]);
  for (const k of Object.keys(yearMap)) {
    const y = Number(k);
    if (Number.isInteger(y) && y > 0) yearSet.add(y);
  }
  for (const k of Object.keys(pvYearMap)) {
    const y = Number(k);
    if (Number.isInteger(y) && y > 0) yearSet.add(y);
  }
  const years = Array.from(yearSet).sort((a, b) => b - a);
  if (selectedSimYear === null || !yearSet.has(selectedSimYear)) {
    selectedSimYear = currentYear;
  }

  const select = document.getElementById("pv-gen-year") as HTMLSelectElement | null;
  if (select) {
    const curOptions = Array.from(select.options).map((o) => Number(o.value));
    const sameOptions =
      curOptions.length === years.length &&
      curOptions.every((v, i) => v === years[i]);
    if (!sameOptions) {
      select.innerHTML = years
        .map((y) => `<option value="${y}">${y}</option>`)
        .join("");
    }
    select.value = String(selectedSimYear);
  }
  return selectedSimYear;
}

function renderPvGenerationForYear(year: number): void {
  mountOrUpdateSimulationChart(
    year,
    latestSimCurrentYear,
    latestSimCurrentMonth,
    latestSimYearMap[year] || {},
  );
  mountOrUpdatePvCharts(
    latestPvYearMap[year] || [],
    year,
    latestSimCurrentYear,
    latestSimCurrentMonth,
  );
}

function el<T extends HTMLElement | SVGElement>(id: string): T {
  return document.getElementById(id) as unknown as T;
}

function kwHtml(kw: number, unitClass = "ef-unit"): string {
  return `${kw.toFixed(2)}<span class="${unitClass}">kW</span>`;
}

function kwhDayHtml(kwh: number): string {
  return `<span class="ef-kwh-day">${kwh.toFixed(2)}<span class="ef-kwh-unit">kWh/d</span></span>`;
}

const AVG_ARROW_UP_RIGHT =
  `<svg class="ef-avg-arrow" viewBox="0 0 12 12" fill="none" aria-hidden="true">` +
  `<path d="M2.5 9.5L9.5 2.5M4.5 2.5H9.5V7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` +
  `</svg>`;
const AVG_ARROW_DOWN_LEFT =
  `<svg class="ef-avg-arrow" viewBox="0 0 12 12" fill="none" aria-hidden="true">` +
  `<path d="M9.5 2.5L2.5 9.5M7.5 9.5H2.5V4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` +
  `</svg>`;
const AVG_ARROW_FLAT_RIGHT =
  `<svg class="ef-avg-arrow" viewBox="0 0 12 12" fill="none" aria-hidden="true">` +
  `<path d="M2 6H10M6.8 2.8L10 6L6.8 9.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` +
  `</svg>`;

function kwhDayWithAvgHtml(
  kwh: number,
  monthlyAvg: number | null | undefined,
): string {
  const base = kwhDayHtml(kwh);
  if (
    typeof monthlyAvg !== "number" ||
    !Number.isFinite(monthlyAvg) ||
    monthlyAvg <= 0.05
  ) {
    return base;
  }
  const pct = Math.round(((kwh - monthlyAvg) / monthlyAvg) * 100);
  const arrow =
    pct > 0
      ? AVG_ARROW_UP_RIGHT
      : pct < 0
        ? AVG_ARROW_DOWN_LEFT
        : AVG_ARROW_FLAT_RIGHT;
  const cls = pct > 0 ? "is-pos" : pct < 0 ? "is-neg" : "is-flat";
  return `${base}<span class="ef-avg-delta ${cls}">${arrow}${Math.abs(pct)}%<span class="ef-avg-label">Avg.</span></span>`;
}

function formatTimeJst(
  epochSec: number,
  tzOffsetMin = 540,
): {
  text: string;
  minutesOfDay: number;
  day: number;
  month: number;
  year: number;
} {
  const d = new Date((epochSec + tzOffsetMin * 60) * 1000);
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  const day = d.getUTCDate();
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  return {
    text: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
    minutesOfDay: hh * 60 + mm,
    day,
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

function cubicBezier(
  t: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
): { x: number; y: number } {
  const u = 1 - t;
  const u2 = u * u;
  const t2 = t * t;
  return {
    x: u2 * u * x0 + 3 * u2 * t * x1 + 3 * u * t2 * x2 + t2 * t * x3,
    y: u2 * u * y0 + 3 * u2 * t * y1 + 3 * u * t2 * y2 + t2 * t * y3,
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
  const glow = el<SVGCircleElement>("sun-marker-glow");

  const tempC = weather?.tempC;
  badgeTemp.textContent =
    typeof tempC === "number" ? `${Math.round(tempC)}°C` : "--°C";

  const isNight = minutesOfDay < sunriseMin || minutesOfDay > sunsetMin;
  const iconSpec = buildWeatherIconSvg(weather?.condition || "CLEAR", isNight);
  iconGroup.innerHTML = iconSpec.svg;
  glow.setAttribute("fill", iconSpec.glowColor);

  let pos: { x: number; y: number };
  if (minutesOfDay < sunriseMin) {
    // 00:00 〜 日の出: (20,134) から滑らかに上昇して (140,98) へ接続
    const t = Math.max(0, Math.min(1, minutesOfDay / Math.max(1, sunriseMin)));
    pos = cubicBezier(t, 20, 134, 72, 134, 106, 124.35, 140, 98);
    badgeGroup.setAttribute("transform", "translate(0, -23)");
  } else if (minutesOfDay <= sunsetMin) {
    // 日の出 〜 日の入り: (140,98) -> (300,-26) -> (460,98)
    const span = Math.max(60, sunsetMin - sunriseMin);
    const t = Math.max(0, Math.min(1, (minutesOfDay - sunriseMin) / span));
    pos = quadBezier(t, 140, 98, 300, -26, 460, 98);
    badgeGroup.setAttribute("transform", "translate(0, -24)");
  } else {
    // 日の入り 〜 24:00: (460,98) から滑らかに下降して (580,134) へ接続
    const nightSpan = Math.max(1, 1440 - sunsetMin);
    const t = Math.max(0, Math.min(1, (minutesOfDay - sunsetMin) / nightSpan));
    pos = cubicBezier(t, 460, 98, 494, 124.35, 528, 134, 580, 134);
    badgeGroup.setAttribute("transform", "translate(0, -23)");
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
    const node = el<SVGPathElement>(id);
    node.setAttribute("class", cls ? `flow-line ${cls}` : "flow-line");
  };

  const solarActive = solarKw >= 0.02;
  const useActive = useKw >= 0.02;
  // 待機買電 (<= 0.08kW) のときは買電アニメーション線を動かさない
  const buyActive = buyKw > STANDBY_BUY_MAX_KW;
  const sellActive = sellKw >= 0.02;
  const battAbsKw = Math.abs(battChargeKw);

  // 送電元と送電先が揃っているフローのみ有効化 (途中切れ・孤立点滅を防止)
  const solarFlow = solarActive && (useActive || battCharging || sellActive);
  const buyFlow = buyActive && (useActive || battCharging);
  const sellFlow = sellActive && (solarActive || battDischarging);
  const useFlow = useActive && (solarActive || battDischarging || buyActive);

  // 1. SOLAR から中央合流点へ出る線: 送電元は SOLAR (黄色)
  setLine("line-solar", solarFlow ? "active-solar" : null);

  // 2. BUY から中央合流点へ出る線: 送電元は BUY (ピンク)
  setLine("line-buy", buyFlow ? "active-buy" : null);

  // 3. SELL へ入る線 & 下段縦ライン (BATTERY/PCS ⇄ 系統)
  if (sellFlow) {
    const exportColor =
      solarActive && (!battDischarging || solarKw >= battAbsKw)
        ? "active-solar"
        : "active-battery";
    setLine("line-sell", exportColor);
    setLine("line-trunk-low", exportColor);
  } else {
    setLine("line-sell", null);
    setLine("line-trunk-low", buyFlow ? "active-buy flow-reverse" : null);
  }

  // 4. 中央合流点から USE へ入る線: 優勢な送電元の色で点灯
  let useColor: string | null = null;
  if (useFlow) {
    if (
      solarActive &&
      (!battDischarging || solarKw >= battAbsKw) &&
      (!buyActive || solarKw >= buyKw)
    ) {
      useColor = "active-solar";
    } else if (battDischarging && (!buyActive || battAbsKw >= buyKw)) {
      useColor = "active-battery";
    } else if (buyActive) {
      useColor = "active-buy";
    }
  }
  setLine("line-use", useColor);

  // 5. 上段縦ライン (上段合流点 ⇄ BATTERY/PCS)
  //    SOLAR -> USE / SELL の送電時も PCS(BATTERY) 経由のため点灯させて途切れを防ぐ
  if (battDischarging && useFlow) {
    const trunkColor =
      buyFlow && !solarActive && buyKw > battAbsKw
        ? "active-buy"
        : "active-battery";
    setLine("line-trunk-high", `${trunkColor} flow-reverse`);
  } else if (solarFlow && !(buyFlow && useFlow && buyKw > solarKw)) {
    setLine("line-trunk-high", "active-solar");
  } else if (buyFlow && useFlow) {
    setLine("line-trunk-high", "active-buy flow-reverse");
  } else {
    setLine("line-trunk-high", null);
  }
}

function socToBatteryColor(soc: number | null): string {
  if (soc === null || !Number.isFinite(soc)) return "#6c667d";
  const t = Math.max(0, Math.min(1, soc / 100));
  const r = Math.round(68 + (213 - 68) * t);
  const g = Math.round(63 + (203 - 63) * t);
  const b = Math.round(86 + (249 - 86) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * 太陽軌道下の家 (屋根SOLAR/窓USE/蓄電池BATTERY) と鉄塔電線 (BUY/SELL) の状態を連動更新する
 */
function updateSunSceneStatus(
  solarActive: boolean,
  useActive: boolean,
  battCharging: boolean,
  soc: number | null,
  buyActive: boolean,
  sellActive: boolean,
): void {
  el("house-solar-left").classList.toggle("is-active", solarActive);
  el("house-solar-right").classList.toggle("is-active", solarActive);
  el("house-solar-glow").classList.toggle("is-active", solarActive);
  el("house-use").classList.toggle("is-active", useActive);

  const houseBatt = el("house-battery");
  houseBatt.style.setProperty("--house-batt-fill", socToBatteryColor(soc));
  el("house-battery-glow").classList.toggle("is-charging", battCharging);

  const gridWire = el("sun-grid-flow");
  gridWire.classList.toggle("is-buy", buyActive);
  gridWire.classList.toggle("is-sell", !buyActive && sellActive);
}

function renderDashboard(data: DashboardResponse): void {
  const cfg = data.config;
  const tzMin = cfg.timezoneOffsetMinutes ?? 540;

  syncPv3dScene(cfg.latitude ?? 35.7356, cfg.longitude ?? 139.6517);

  el("sun-rise-label").textContent = data.sun.sunrise;
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
    mountOrUpdateSummaryCharts(
      {
        solarToday: 0,
        buyToday: 0,
        useToday: 0,
        sellToday: 0,
        batteryChgKwh: 0,
        batteryDischgKwh: 0,
        flows: [],
      },
      data.monthlyTotals || { months: [] },
      month,
    );
    const byYear = extractMonthlyActualByYear(data, year);
    const pvByYear = extractPvMonthlyByYear(data, year);
    latestSimYearMap = byYear;
    latestPvYearMap = pvByYear;
    latestSimCurrentYear = year;
    latestSimCurrentMonth = month;
    const activeSimYear = syncSimYearSelector(byYear, pvByYear, year);
    renderPvGenerationForYear(activeSimYear);
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
    updateSunSceneStatus(false, false, false, null, false, false);
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
  const byYear = extractMonthlyActualByYear(data, year);
  const pvByYear = extractPvMonthlyByYear(data, year);
  latestSimYearMap = byYear;
  latestPvYearMap = pvByYear;
  latestSimCurrentYear = year;
  latestSimCurrentMonth = month;
  const activeSimYear = syncSimYearSelector(byYear, pvByYear, year);
  renderPvGenerationForYear(activeSimYear);
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
  const sellActive = sellKw >= 0.02;
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
  updateSunSceneStatus(
    solarActive,
    useActive,
    battCharging,
    soc,
    buyActive,
    sellActive,
  );

  // 日積算 (kWh/d) & 金額換算 (¥)
  const solarToday = latest.solar_day_kwh ?? 0;
  const useToday = latest.load_day_kwh ?? 0;
  const buyToday = latest.buy_day_kwh ?? 0;
  const sellToday = data.sellDayKwhComputed ?? 0;

  const solarValueYen = Math.round(solarToday * cfg.buyPriceYenPerKwh);
  const buyCostYen = Math.round(buyToday * cfg.buyPriceYenPerKwh);
  const sellRevYen = Math.round(sellToday * cfg.sellPriceYenPerKwh);

  mountOrUpdateSummaryCharts(
    {
      solarToday,
      buyToday,
      useToday,
      sellToday,
      batteryChgKwh: data.todayBatteryChgKwh ?? 0,
      batteryDischgKwh: data.todayBatteryDischgKwh ?? 0,
      flows: data.todayFlows,
    },
    data.monthlyTotals || { months: [] },
    month,
  );

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
  el("val-buy-today").innerHTML = kwhDayWithAvgHtml(
    buyToday,
    data.monthlyAvgKwh?.buy,
  );
  el("val-buy-yen").textContent = `COST ¥${buyCostYen.toLocaleString("ja-JP")}`;

  // SELL カード
  el("val-sell-kw").innerHTML = kwHtml(sellKw);
  el("val-sell-today").innerHTML = kwhDayWithAvgHtml(
    sellToday,
    data.monthlyAvgKwh?.sell,
  );
  el("val-sell-yen").textContent = `REV ¥${sellRevYen.toLocaleString("ja-JP")}`;

  // SOLAR カード
  el("val-solar-kw").innerHTML = kwHtml(solarKw);
  el("val-solar-today").innerHTML = kwhDayWithAvgHtml(
    solarToday,
    data.monthlyAvgKwh?.solar,
  );
  el("val-solar-yen").textContent =
    `VALUE ¥${solarValueYen.toLocaleString("ja-JP")}`;

  // USE カード
  el("val-use-kw").innerHTML = kwHtml(useKw);
  el("val-use-today").innerHTML = kwhDayWithAvgHtml(
    useToday,
    data.monthlyAvgKwh?.use,
  );
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

  // BATTERY カード (マイコンから実容量・実残電力量が取得できる場合は優先使用)
  const capKwh =
    typeof latest.batt_cap_kwh === "number" && latest.batt_cap_kwh > 0
      ? latest.batt_cap_kwh
      : cfg.batteryCapacityKwh;
  const storedKwh =
    typeof latest.batt_kwh === "number" && latest.batt_kwh >= 0
      ? latest.batt_kwh
      : (capKwh * soc) / 100;
  el("val-batt-cap").textContent = `MAX ${capKwh.toFixed(1)} kWh`;

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
  el("val-batt-soc").innerHTML =
    `${soc}% (${storedKwh.toFixed(1)}<span class="ef-kwh-unit">kWh</span>)`;
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

  for (const i of [1, 2, 3, 4] as const) {
    const p = latest[`pv${i}_p_avg_w`];
    const pKw = typeof p === "number" ? Math.max(0, p) / 1000 : 0;
    const avgKwh = data.monthlyAvgKwh?.[`pv${i}` as const];
    el(`pv${i}-w`).innerHTML = kwHtml(pKw, "ef-unit-sm");
    el(`pv${i}-day`).innerHTML = kwhDayWithAvgHtml(pvDayMap[i] ?? 0, avgKwh);
    pvActiveState[i] = typeof p === "number" && p >= 10;
  }
  const mv = document.getElementById("pv-roof-viewer") as SolarModelViewerElement | null;
  applyPv3dMaterials(mv);

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

function setupSnapPager(pagerId: string, dotsSelector: string): void {
  const pager = document.getElementById(pagerId);
  const dots = Array.from(
    document.querySelectorAll<HTMLButtonElement>(dotsSelector),
  );
  if (!pager || dots.length === 0) return;

  const updateDots = (activeIdx: number) => {
    dots.forEach((btn, idx) => {
      const isAct = idx === activeIdx;
      btn.classList.toggle("is-active", isAct);
      btn.setAttribute("aria-selected", isAct ? "true" : "false");
    });
  };
  pager.addEventListener("scroll", () => {
    const idx = Math.round(
      pager.scrollLeft / Math.max(1, pager.clientWidth),
    );
    updateDots(idx);
  });
  dots.forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.page || 0);
      pager.scrollTo({
        left: idx * pager.clientWidth,
        behavior: "smooth",
      });
      updateDots(idx);
    });
  });
}

function setupControls(): void {
  const topBar = document.querySelector<HTMLElement>(".top-bar");
  const infoBtn = document.getElementById("top-bar-info-btn");
  const infoBox = document.getElementById("top-bar-about");

  const mobileMq = window.matchMedia("(max-width: 680px)");

  const setAboutOpen = (open: boolean) => {
    if (!infoBtn || !infoBox) return;
    infoBtn.setAttribute("aria-expanded", open ? "true" : "false");
    infoBtn.setAttribute(
      "aria-label",
      open ? "このサイトについてを閉じる" : "このサイトについてを表示",
    );
    infoBox.classList.toggle("is-open", open);
    infoBox.setAttribute("aria-hidden", open ? "false" : "true");
  };
  if (infoBtn && infoBox) {
    infoBtn.addEventListener("click", () => {
      if (topBar && mobileMq.matches && topBar.classList.contains("is-stuck")) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      const nextOpen = infoBtn.getAttribute("aria-expanded") !== "true";
      setAboutOpen(nextOpen);
    });
  }

  // スマホ表示時: 下スクロールで隠し、上スクロールで再表示。固定表示中は最上部へ戻るボタンとして機能する
  if (topBar) {
    let lastY = Math.max(0, window.scrollY || 0);
    let downAccum = 0;
    let upAccum = 0;
    let ticking = false;

    const syncTopBarScroll = () => {
      ticking = false;
      const y = Math.max(0, window.scrollY || 0);
      if (!mobileMq.matches) {
        topBar.classList.remove("is-stuck", "is-hidden");
        if (infoBtn) {
          const isOpen = infoBtn.getAttribute("aria-expanded") === "true";
          infoBtn.setAttribute(
            "aria-label",
            isOpen ? "このサイトについてを閉じる" : "このサイトについてを表示",
          );
        }
        lastY = y;
        downAccum = 0;
        upAccum = 0;
        return;
      }

      const stuck = y > 16;
      topBar.classList.toggle("is-stuck", stuck);
      if (stuck) {
        setAboutOpen(false);
        infoBtn?.setAttribute("aria-label", "最上部に戻る");
      } else if (infoBtn && infoBtn.getAttribute("aria-expanded") !== "true") {
        infoBtn.setAttribute("aria-label", "このサイトについてを表示");
      }

      const maxScroll = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const nearBottom = maxScroll > 40 && y >= maxScroll - 6;
      const delta = y - lastY;
      lastY = y;

      if (y <= 64) {
        topBar.classList.remove("is-hidden");
        downAccum = 0;
        upAccum = 0;
        return;
      }

      if (delta > 0) {
        upAccum = 0;
        downAccum += delta;
        if (downAccum > 18 && y > 80) {
          topBar.classList.add("is-hidden");
        }
      } else if (delta < 0 && !nearBottom) {
        downAccum = 0;
        upAccum += -delta;
        if (upAccum > 12) {
          topBar.classList.remove("is-hidden");
        }
      }
    };

    window.addEventListener(
      "scroll",
      () => {
        if (!ticking) {
          ticking = true;
          window.requestAnimationFrame(syncTopBarScroll);
        }
      },
      { passive: true },
    );
    mobileMq.addEventListener("change", syncTopBarScroll);
    syncTopBarScroll();
  }

  const mv = document.getElementById("pv-roof-viewer") as SolarModelViewerElement | null;
  if (mv) {
    mv.addEventListener("load", () => {
      applyPv3dMaterials(mv);
    });
    let mvRaf = 0;
    mv.addEventListener("pointermove", (ev: PointerEvent) => {
      if (mvRaf) return;
      const clientX = ev.clientX;
      const clientY = ev.clientY;
      mvRaf = window.requestAnimationFrame(() => {
        mvRaf = 0;
        const hit = mv.materialFromPoint?.(clientX, clientY);
        const m = hit?.name ? /^pv([1-4])_/.exec(hit.name) : null;
        setPvHovered(m ? (Number(m[1]) as 1 | 2 | 3 | 4) : null);
      });
    });
    mv.addEventListener("pointerleave", () => {
      setPvHovered(null);
    });
  }

  for (const i of [1, 2, 3, 4] as const) {
    const box = document.getElementById(`pv-box-${i}`);
    if (!box) continue;
    box.addEventListener("mouseenter", () => setPvHovered(i));
    box.addEventListener("mouseleave", () => {
      if (pvHoveredIdx === i) setPvHovered(null);
    });
    box.addEventListener("click", () => focusPvRoofFace(i));
    box.addEventListener("keydown", (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        focusPvRoofFace(i);
      }
    });
  }

  // SUMMARY / PV STRINGS / PV GENERATION ページ送り (横スクロールスナップ + ドットクリック連動)
  setupSnapPager("summary-pager", "#summary-dots .pv-dot");
  setupSnapPager("pv-pager", "#pv-dots .pv-dot");
  setupSnapPager("pv-gen-pager", "#pv-gen-dots .pv-dot");

  const simYearSelect = document.getElementById("pv-gen-year") as HTMLSelectElement | null;
  if (simYearSelect) {
    simYearSelect.addEventListener("change", () => {
      const picked = Number(simYearSelect.value);
      if (Number.isInteger(picked) && picked > 0) {
        selectedSimYear = picked;
        renderPvGenerationForYear(picked);
      }
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
syncPv3dScene(pvViewerLat, pvViewerLon);
const initTime = formatTimeJst(Math.floor(Date.now() / 1000));
latestSimCurrentYear = initTime.year;
latestSimCurrentMonth = initTime.month;
const initSimYear = syncSimYearSelector(
  { [initTime.year]: {} },
  { [initTime.year]: [] },
  initTime.year,
);
mountOrUpdateSummaryCharts(
  {
    solarToday: 0,
    buyToday: 0,
    useToday: 0,
    sellToday: 0,
    batteryChgKwh: 0,
    batteryDischgKwh: 0,
    flows: [],
  },
  { months: [] },
  initTime.month,
);
renderPvGenerationForYear(initSimYear);
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
