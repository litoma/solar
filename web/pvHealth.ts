/**
 * PVストリング健全性評価・Canadian Solar 30年出力保証モニタリングモジュール
 *
 * 保証条件 (TOPHiKu モジュール用保証書 CT-S-WA-100031 / 保証管理番号 CSJ-CS2026101487):
 *   - 保証開始日: 2026-10-28 (暦年ベース: 開始日〜365日目、うるう年は366日目)
 *   - 製品保証: 25年間
 *   - 出力保証: 30年間 (Year 1 >= 99.0%, Year 2〜30 年次最大劣化 0.4%/年, Year 30末 >= 87.4%)
 *
 * 日射量・気温補正モデル:
 *   - Open-Meteo 1時間値 (GHI / DNI / DHI / 気温) を入力に、Hay-Davies 異方性天空モデル +
 *     ASHRAE 入射角補正 (IAM, b0=0.05) + Ross セル温度推定 (Tcell = Tair + 0.032 * G_poa) +
 *     TOPHiKu6 N-type TOPCon 温度係数 (γ = -0.29%/°C) を適用
 */

export type PvStringKey = "pv1" | "pv2" | "pv3" | "pv4";
export type HealthStatus = "HEALTHY" | "WATCH" | "CHECK" | "COLLECTING";

export const WARRANTY_ID = "CSJ-CS2026101487";
export const WARRANTY_START_DATE = "2026-10-28";
export const PRODUCT_WARRANTY_YEARS = 25;
export const OUTPUT_WARRANTY_YEARS = 30;
export const YEAR1_GUARANTEE_PCT = 99.0;
export const ANNUAL_DEGRADATION_PCT = 0.4;
export const MODULE_TEMP_COEFF_PCT_PER_C = -0.29;
export const ROSS_TEMP_COEFF = 0.032;
export const ASHRAE_IAM_B0 = 0.05;
export const DIFFUSE_IAM_FACTOR = 0.955;
export const GROUND_ALBEDO = 0.2;
export const BOS_DERATE_FACTOR = 0.945; // DC配線/ミスマッチ/初期汚れ・MPPT等の非モジュール損失係数

export const ROOF_SLOPE_TAN = 0.59; // 5.9寸勾配 = atan(0.59) ≒ 30.54°
export const ROOF_TILT_RAD = Math.atan(ROOF_SLOPE_TAN);

export interface PvStringSpec {
  key: PvStringKey;
  label: string;
  direction: "WEST" | "EAST" | "NORTH";
  azimuthDeg: number; // 0=N, 90=E, 180=S, 270=W
  ratedKw: number;
  panelCount: number;
  modelSummary: string;
}

export const PV_STRING_SPECS: readonly PvStringSpec[] = [
  {
    key: "pv1",
    label: "PV1",
    direction: "WEST",
    azimuthDeg: 270,
    ratedKw: 1.705,
    panelCount: 5,
    modelSummary: "465W×1 + 310W×4",
  },
  {
    key: "pv2",
    label: "PV2",
    direction: "EAST",
    azimuthDeg: 90,
    ratedKw: 1.63,
    panelCount: 4,
    modelSummary: "465W×2 + 350W×2",
  },
  {
    key: "pv3",
    label: "PV3",
    direction: "WEST",
    azimuthDeg: 270,
    ratedKw: 1.395,
    panelCount: 3,
    modelSummary: "465W×3",
  },
  {
    key: "pv4",
    label: "PV4",
    direction: "NORTH",
    azimuthDeg: 0,
    ratedKw: 1.335,
    panelCount: 3,
    modelSummary: "445W×3",
  },
] as const;

export const ARRAY_RATED_KW = 6.065;

// カナディアンソーラー太陽光発電シミュレーション (東京都練馬区 / 15枚 6.065kW / PCS-JP2-6G)
export const CANATARO_BASE_SIMULATION: ReadonlyArray<{
  month: number;
  label: string;
  estimatedKwh: number;
}> = [
  { month: 1, label: "JAN", estimatedKwh: 400 },
  { month: 2, label: "FEB", estimatedKwh: 410 },
  { month: 3, label: "MAR", estimatedKwh: 569 },
  { month: 4, label: "APR", estimatedKwh: 640 },
  { month: 5, label: "MAY", estimatedKwh: 785 },
  { month: 6, label: "JUN", estimatedKwh: 630 },
  { month: 7, label: "JUL", estimatedKwh: 702 },
  { month: 8, label: "AUG", estimatedKwh: 655 },
  { month: 9, label: "SEP", estimatedKwh: 489 },
  { month: 10, label: "OCT", estimatedKwh: 407 },
  { month: 11, label: "NOV", estimatedKwh: 328 },
  { month: 12, label: "DEC", estimatedKwh: 333 },
];

export const CANATARO_ANNUAL_TOTAL_KWH = 6348;

export interface PvHealthDailyExpected {
  jst_date: string;
  pv1_exp_kwh: number;
  pv2_exp_kwh: number;
  pv3_exp_kwh: number;
  pv4_exp_kwh: number;
  ghi_kwh_m2: number;
  avg_day_temp_c: number | null;
}

export interface PvDailyMeasuredRow {
  jst_date: string;
  solar_kwh: number | null;
  pv1_kwh: number | null;
  pv2_kwh: number | null;
  pv3_kwh: number | null;
  pv4_kwh: number | null;
  samples: number | null;
}

export interface PvStringHealthSummary {
  key: PvStringKey;
  label: string;
  direction: string;
  ratedKw: number;
  actualKwh: number;
  expectedPoaTempKwh: number;
  specificYieldKwhPerKwp: number;
  avgDailyKwhPerKwp: number;
  prPct: number | null;
  bosAdjustedPct: number | null;
  baselineDeltaPct: number | null;
  status: HealthStatus;
}

export interface PvRelativePairHealth {
  pairLabel: string;
  pv1SpecificYield: number;
  pv3SpecificYield: number;
  ratioPct: number | null;
  deltaPct: number | null;
  ratedRatio: number;
  actualPowerRatio: number | null;
  status: HealthStatus;
}

export interface WarrantyYearPoint {
  year: number;
  periodLabel: string;
  guaranteeFloorPct: number;
  measuredRetentionPct: number | null;
  measuredPrPct: number | null;
  measuredDays: number;
  isCurrentYear: boolean;
  belowFloor: boolean;
}

export interface PvHealthPayload {
  warrantyId: string;
  warrantyStartDate: string;
  productWarrantyYears: number;
  outputWarrantyYears: number;
  currentYear: number;
  daysElapsedInWarranty: number;
  daysInCurrentYear: number;
  totalDaysInCurrentYear: number;
  guaranteeFloorPct: number;
  overallStatus: HealthStatus;
  arrayRatedKw: number;
  arrayPrPct: number | null;
  arrayRetentionPct: number | null;
  measuredValidDays: number;
  totalMeasuredKwh: number;
  totalExpectedPoaTempKwh: number;
  canataroPacePct: number | null;
  avgDayTempC: number | null;
  totalGhiKwhM2: number;
  latestDataDate: string | null;
  pv1VsPv3: PvRelativePairHealth;
  strings: PvStringHealthSummary[];
  warrantyCurve: WarrantyYearPoint[];
  tempCoeffPctPerC: number;
  calibrationNote: string;
}

const CANATARO_BY_MONTH = new Map<number, number>(
  CANATARO_BASE_SIMULATION.map((m) => [m.month, m.estimatedKwh]),
);

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function parseIsoParts(iso: string): [number, number, number] {
  const [yStr, mStr, dStr] = iso.slice(0, 10).split("-");
  return [Number(yStr), Number(mStr), Number(dStr)];
}

function toUtcMs(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d);
}

/**
 * 保証書規約 (暦年ベース: 2026-10-28 開始、各年は翌年10-27まで) に基づく経過保証年数 (1..30)
 */
export function getWarrantyYearForDate(jstDate: string): number {
  const [y, m, d] = parseIsoParts(jstDate);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return 1;
  const [, startM, startD] = parseIsoParts(WARRANTY_START_DATE);
  const yrDiff = y - 2026;
  const reachedAnniversary = m > startM || (m === startM && d >= startD);
  const year = yrDiff + (reachedAnniversary ? 1 : 0);
  return Math.max(1, Math.min(OUTPUT_WARRANTY_YEARS, year));
}

export function getWarrantyYearSpan(warrantyYear: number): {
  startIso: string;
  endIso: string;
  totalDays: number;
  periodLabel: string;
} {
  const y = Math.max(1, Math.min(OUTPUT_WARRANTY_YEARS, Math.floor(warrantyYear)));
  const startYear = 2026 + (y - 1);
  const nextStartYear = startYear + 1;
  const startMs = toUtcMs(startYear, 10, 28);
  const nextStartMs = toUtcMs(nextStartYear, 10, 28);
  const endDate = new Date(nextStartMs - 86400000);
  const endIso = endDate.toISOString().slice(0, 10);
  const totalDays = Math.round((nextStartMs - startMs) / 86400000);
  return {
    startIso: `${startYear}-10-28`,
    endIso,
    totalDays,
    periodLabel: `${startYear}/10`,
  };
}

/**
 * 保証下限 (%): Year 1 = 99.0%, Year 2〜30 = -0.4%/yr (Year 30 = 87.4%)
 */
export function getWarrantyFloorPct(warrantyYear: number): number {
  const y = Math.max(1, Math.min(OUTPUT_WARRANTY_YEARS, Math.floor(warrantyYear)));
  return round1(YEAR1_GUARANTEE_PCT - ANNUAL_DEGRADATION_PCT * (y - 1));
}

/**
 * UTCミリ秒・緯度・経度から太陽のENU方向単位ベクトルを算出 (Spencer式)
 */
function computeSolarEnuVec(
  utcMs: number,
  latDeg: number,
  lonDeg: number,
): { east: number; north: number; up: number; doy: number } {
  const rad = Math.PI / 180;
  const dt = new Date(utcMs);
  const startOfUtcYear = Date.UTC(dt.getUTCFullYear(), 0, 1);
  const doy = Math.floor((utcMs - startOfUtcYear) / 86400000) + 1;
  const utcMinOfDay =
    dt.getUTCHours() * 60 + dt.getUTCMinutes() + dt.getUTCSeconds() / 60;

  const gamma = ((2 * Math.PI) / 365) * (doy - 1 + (utcMinOfDay / 60 - 12) / 24);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const declRad =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const trueSolarMin = (((utcMinOfDay + eqTime + 4 * lonDeg) % 1440) + 1440) % 1440;
  const omega = (trueSolarMin / 4 - 180) * rad;
  const latRad = latDeg * rad;

  const sinDecl = Math.sin(declRad);
  const cosDecl = Math.cos(declRad);
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinOmega = Math.sin(omega);
  const cosOmega = Math.cos(omega);

  return {
    east: -cosDecl * sinOmega,
    north: sinDecl * cosLat - cosDecl * cosOmega * sinLat,
    up: sinLat * sinDecl + cosLat * cosDecl * cosOmega,
    doy,
  };
}

function surfaceNormalEnu(azimuthDeg: number, tiltRad: number): [number, number, number] {
  const azRad = (azimuthDeg * Math.PI) / 180;
  const sinT = Math.sin(tiltRad);
  const cosT = Math.cos(tiltRad);
  return [sinT * Math.sin(azRad), sinT * Math.cos(azRad), cosT];
}

const PLANE_NORMALS = {
  WEST: surfaceNormalEnu(270, ROOF_TILT_RAD),
  EAST: surfaceNormalEnu(90, ROOF_TILT_RAD),
  NORTH: surfaceNormalEnu(0, ROOF_TILT_RAD),
} as const;

export interface OpenMeteoHourlyRadiation {
  time: string[];
  temperature_2m?: Array<number | null>;
  shortwave_radiation?: Array<number | null>;
  direct_normal_irradiance?: Array<number | null>;
  diffuse_radiation?: Array<number | null>;
}

/**
 * Open-Meteoの1時間値 (HH:00は前1時間 [HH-1:00, HH:00] の平均) から
 * 各面(WEST/EAST/NORTH, 勾配30.54°)の日別 POA+気温補正期待発電量 (kWh) を計算する
 */
export function computeDailyExpectedFromHourly(
  hourly: OpenMeteoHourlyRadiation,
  latDeg: number,
  lonDeg: number,
  tzOffsetMinutes = 540,
): Map<string, PvHealthDailyExpected> {
  const out = new Map<string, PvHealthDailyExpected>();
  const times = hourly.time || [];
  const temps = hourly.temperature_2m || [];
  const ghis = hourly.shortwave_radiation || [];
  const dnis = hourly.direct_normal_irradiance || [];
  const dhis = hourly.diffuse_radiation || [];

  const cosTilt = Math.cos(ROOF_TILT_RAD);
  const tiltDiffuseView = (1 + cosTilt) * 0.5;
  const tiltGroundView = (1 - cosTilt) * 0.5;
  const gammaCoeff = MODULE_TEMP_COEFF_PCT_PER_C / 100;

  const accByDate = new Map<
    string,
    {
      westYield: number;
      eastYield: number;
      northYield: number;
      ghiKwhM2: number;
      tempWeightSum: number;
      weightSum: number;
    }
  >();

  for (let i = 0; i < times.length; i++) {
    const iso = times[i];
    if (typeof iso !== "string" || iso.length < 16) continue;
    const [y, m, d] = parseIsoParts(iso);
    const hh = Number(iso.slice(11, 13));
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || !Number.isFinite(hh)) {
      continue;
    }

    const ghi = Math.max(0, Number(ghis[i] ?? 0) || 0);
    const dni = Math.max(0, Number(dnis[i] ?? 0) || 0);
    const dhi = Math.max(0, Number(dhis[i] ?? 0) || 0);
    const airTemp = typeof temps[i] === "number" && Number.isFinite(temps[i]!) ? temps[i]! : 15;

    const hourEndUtcMs =
      Date.UTC(y, m - 1, d, hh, 0, 0) - tzOffsetMinutes * 60000;
    // 前1時間 [HH-1:00, HH:00] が日界を跨ぐ 00:00 は前日深夜(日射0)のため日付ラベルは実太陽側を使用
    const localMidMs = hourEndUtcMs - 30 * 60000 + tzOffsetMinutes * 60000;
    const jstDate = new Date(localMidMs).toISOString().slice(0, 10);

    const bucket = accByDate.get(jstDate) ?? {
      westYield: 0,
      eastYield: 0,
      northYield: 0,
      ghiKwhM2: 0,
      tempWeightSum: 0,
      weightSum: 0,
    };
    accByDate.set(jstDate, bucket);

    if (ghi <= 0.1 && dni <= 0.1 && dhi <= 0.1) continue;

    bucket.ghiKwhM2 += ghi / 1000;
    bucket.tempWeightSum += airTemp * ghi;
    bucket.weightSum += ghi;

    // 1時間内を3サブステップ (-45m, -30m, -15m) で台形的に数値積分
    const subOffsetsMin = [-45, -30, -15];
    const dtHours = 1 / subOffsetsMin.length;

    for (const offsetMin of subOffsetsMin) {
      const sun = computeSolarEnuVec(hourEndUtcMs + offsetMin * 60000, latDeg, lonDeg);
      const sunUp = sun.up;
      const i0 = 1361 * (1 + 0.033 * Math.cos((2 * Math.PI * sun.doy) / 365));
      const ani = sunUp > 0.087 ? Math.min(1, dni / i0) : 0;
      const cosZenith = Math.max(0.087, sunUp);

      const calcPlaneStepYield = (normal: readonly [number, number, number]): number => {
        const cosInc = Math.max(
          0,
          sun.east * normal[0] + sun.north * normal[1] + sun.up * normal[2],
        );
        const beamRaw = sunUp > 0.017 ? dni * cosInc : 0;
        const diffIso = (1 - ani) * tiltDiffuseView;
        const diffCircum = ani * (cosInc / cosZenith);
        const diffPoa = dhi * (diffIso + diffCircum);
        const groundPoa = ghi * GROUND_ALBEDO * tiltGroundView;
        const gPoaTotal = beamRaw + diffPoa + groundPoa;

        const iamBeam =
          beamRaw > 0 && cosInc > 0.05
            ? Math.max(0, 1 - ASHRAE_IAM_B0 * (1 / cosInc - 1))
            : 0;
        const gEff = beamRaw * iamBeam + (diffPoa + groundPoa) * DIFFUSE_IAM_FACTOR;

        const tCell = airTemp + ROSS_TEMP_COEFF * gPoaTotal;
        const tempFactor = Math.max(0.6, 1 + gammaCoeff * (tCell - 25));

        return (gEff / 1000) * tempFactor * dtHours;
      };

      bucket.westYield += calcPlaneStepYield(PLANE_NORMALS.WEST);
      bucket.eastYield += calcPlaneStepYield(PLANE_NORMALS.EAST);
      bucket.northYield += calcPlaneStepYield(PLANE_NORMALS.NORTH);
    }
  }

  for (const [jstDate, acc] of accByDate.entries()) {
    out.set(jstDate, {
      jst_date: jstDate,
      pv1_exp_kwh: round3(acc.westYield * PV_STRING_SPECS[0].ratedKw),
      pv2_exp_kwh: round3(acc.eastYield * PV_STRING_SPECS[1].ratedKw),
      pv3_exp_kwh: round3(acc.westYield * PV_STRING_SPECS[2].ratedKw),
      pv4_exp_kwh: round3(acc.northYield * PV_STRING_SPECS[3].ratedKw),
      ghi_kwh_m2: round3(acc.ghiKwhM2),
      avg_day_temp_c:
        acc.weightSum > 0 ? round1(acc.tempWeightSum / acc.weightSum) : null,
    });
  }

  return out;
}

function classifyStringStatus(
  direction: "WEST" | "EAST" | "NORTH",
  prPct: number | null,
  validDays: number,
): HealthStatus {
  if (validDays < 3 || prPct === null) return "COLLECTING";
  if (direction === "NORTH") {
    // 北面5.9寸屋根は冬季の直達日射が極めて小さく天空散乱主体・周辺建物影響を受けやすいため閾値を緩和
    if (prPct >= 50) return "HEALTHY";
    if (prPct >= 38) return "WATCH";
    return "CHECK";
  }
  if (prPct >= 68) return "HEALTHY";
  if (prPct >= 55) return "WATCH";
  return "CHECK";
}

function classifyRelativePairStatus(
  ratioPct: number | null,
  validDays: number,
): HealthStatus {
  if (validDays < 3 || ratioPct === null) return "COLLECTING";
  if (ratioPct >= 85 && ratioPct <= 115) return "HEALTHY";
  if (ratioPct >= 75 && ratioPct <= 125) return "WATCH";
  return "CHECK";
}

/**
 * D1 の日別実測データと pv_health_daily (POA+気温補正期待値) を統合し、
 * ストリング別のパフォーマンス・PV1/PV3相対比較・30年保証カーブデータを生成する
 */
export function evaluatePvHealth(params: {
  dailyRows: PvDailyMeasuredRow[];
  healthExpectedRows: PvHealthDailyExpected[];
  todayJst: string;
}): PvHealthPayload {
  const { dailyRows, healthExpectedRows, todayJst } = params;

  const expectedByDate = new Map<string, PvHealthDailyExpected>(
    healthExpectedRows.map((r) => [r.jst_date, r]),
  );

  // 完了済みの実測日のみを基本対象とする (推計バックフィル samples IS NULL や当日進行中を除外)
  // ※ まだ全日数サンプル >= 900 が無い初期のみ >= 480 にフォールバック
  const completedRealRows = dailyRows.filter(
    (d) =>
      d.jst_date >= WARRANTY_START_DATE &&
      d.jst_date < todayJst &&
      d.pv1_kwh !== null &&
      d.pv2_kwh !== null &&
      d.pv3_kwh !== null &&
      d.pv4_kwh !== null,
  );
  const fullDayRows = completedRealRows.filter(
    (d) => typeof d.samples === "number" && d.samples >= 900,
  );
  const candidateRows =
    fullDayRows.length > 0
      ? fullDayRows
      : completedRealRows.filter(
          (d) => typeof d.samples === "number" && d.samples >= 480,
        );

  const matchedRows = candidateRows.filter((d) => expectedByDate.has(d.jst_date));

  const strActual = { pv1: 0, pv2: 0, pv3: 0, pv4: 0 };
  const strExpected = { pv1: 0, pv2: 0, pv3: 0, pv4: 0 };
  let totalGhiKwhM2 = 0;
  let tempWeightedSum = 0;
  let tempWeightGhi = 0;
  let canataroExpectedForMatchedDays = 0;
  let latestDataDate: string | null = null;

  const yearBuckets = new Map<
    number,
    { actualKwh: number; expectedKwh: number; days: number }
  >();

  for (const row of matchedRows) {
    const exp = expectedByDate.get(row.jst_date)!;
    const p1 = Math.max(0, row.pv1_kwh ?? 0);
    const p2 = Math.max(0, row.pv2_kwh ?? 0);
    const p3 = Math.max(0, row.pv3_kwh ?? 0);
    const p4 = Math.max(0, row.pv4_kwh ?? 0);

    strActual.pv1 += p1;
    strActual.pv2 += p2;
    strActual.pv3 += p3;
    strActual.pv4 += p4;

    strExpected.pv1 += Math.max(0, exp.pv1_exp_kwh);
    strExpected.pv2 += Math.max(0, exp.pv2_exp_kwh);
    strExpected.pv3 += Math.max(0, exp.pv3_exp_kwh);
    strExpected.pv4 += Math.max(0, exp.pv4_exp_kwh);

    totalGhiKwhM2 += Math.max(0, exp.ghi_kwh_m2);
    if (exp.avg_day_temp_c !== null && exp.ghi_kwh_m2 > 0) {
      tempWeightedSum += exp.avg_day_temp_c * exp.ghi_kwh_m2;
      tempWeightGhi += exp.ghi_kwh_m2;
    }

    const [yNum, mNum] = parseIsoParts(row.jst_date);
    const monthEst = CANATARO_BY_MONTH.get(mNum) ?? 0;
    const daysInMonth = new Date(Date.UTC(yNum, mNum, 0)).getUTCDate();
    canataroExpectedForMatchedDays += monthEst / Math.max(1, daysInMonth);

    if (!latestDataDate || row.jst_date > latestDataDate) {
      latestDataDate = row.jst_date;
    }

    const wYear = getWarrantyYearForDate(row.jst_date);
    const yb = yearBuckets.get(wYear) ?? { actualKwh: 0, expectedKwh: 0, days: 0 };
    yb.actualKwh += p1 + p2 + p3 + p4;
    yb.expectedKwh +=
      exp.pv1_exp_kwh + exp.pv2_exp_kwh + exp.pv3_exp_kwh + exp.pv4_exp_kwh;
    yb.days += 1;
    yearBuckets.set(wYear, yb);
  }

  const measuredValidDays = matchedRows.length;
  const totalMeasuredKwh = round2(
    strActual.pv1 + strActual.pv2 + strActual.pv3 + strActual.pv4,
  );
  const totalExpectedPoaTempKwh = round2(
    strExpected.pv1 + strExpected.pv2 + strExpected.pv3 + strExpected.pv4,
  );
  const arrayPrPct =
    measuredValidDays > 0 && totalExpectedPoaTempKwh > 0.5
      ? round1((totalMeasuredKwh / totalExpectedPoaTempKwh) * 100)
      : null;
  const arrayRetentionPct =
    arrayPrPct !== null ? round1(arrayPrPct / BOS_DERATE_FACTOR) : null;
  const canataroPacePct =
    measuredValidDays > 0 && canataroExpectedForMatchedDays > 0.5
      ? round1((totalMeasuredKwh / canataroExpectedForMatchedDays) * 100)
      : null;

  const year1Bucket = yearBuckets.get(1);
  const year1PrPct =
    year1Bucket && year1Bucket.expectedKwh > 0.5
      ? (year1Bucket.actualKwh / year1Bucket.expectedKwh) * 100
      : null;
  const hasCalibratedYear1Baseline =
    (year1Bucket?.days ?? 0) >= 60 && year1PrPct !== null && year1PrPct > 10;

  const strings: PvStringHealthSummary[] = PV_STRING_SPECS.map((spec) => {
    const act = strActual[spec.key];
    const exp = strExpected[spec.key];
    const pr = measuredValidDays > 0 && exp > 0.2 ? round1((act / exp) * 100) : null;
    const bosAdj = pr !== null ? round1(pr / BOS_DERATE_FACTOR) : null;
    const specificYield = spec.ratedKw > 0 ? round2(act / spec.ratedKw) : 0;
    const avgDailySpecific =
      measuredValidDays > 0 && spec.ratedKw > 0
        ? round2(act / spec.ratedKw / measuredValidDays)
        : 0;
    return {
      key: spec.key,
      label: spec.label,
      direction: spec.direction,
      ratedKw: spec.ratedKw,
      actualKwh: round2(act),
      expectedPoaTempKwh: round2(exp),
      specificYieldKwhPerKwp: specificYield,
      avgDailyKwhPerKwp: avgDailySpecific,
      prPct: pr,
      bosAdjustedPct: bosAdj,
      baselineDeltaPct: null,
      status: classifyStringStatus(spec.direction, pr, measuredValidDays),
    };
  });

  // PV1 (1.705kW WEST) vs PV3 (1.395kW WEST) 同一面相対比較
  // ※ 日射量計測の有無にかかわらず、実測完了日があれば比較可能
  const relRows = candidateRows.length > 0 ? candidateRows : matchedRows;
  let relPv1Sum = 0;
  let relPv3Sum = 0;
  for (const r of relRows) {
    relPv1Sum += Math.max(0, r.pv1_kwh ?? 0);
    relPv3Sum += Math.max(0, r.pv3_kwh ?? 0);
  }
  const pv1SpecYield = round2(relPv1Sum / PV_STRING_SPECS[0].ratedKw);
  const pv3SpecYield = round2(relPv3Sum / PV_STRING_SPECS[2].ratedKw);
  const ratedRatio = PV_STRING_SPECS[0].ratedKw / PV_STRING_SPECS[2].ratedKw;
  const relValid = relRows.length >= 3 && relPv3Sum > 0.5;
  const ratioPct = relValid ? round1((pv1SpecYield / pv3SpecYield) * 100) : null;
  const pv1VsPv3: PvRelativePairHealth = {
    pairLabel: "PV1 vs PV3 (WEST 30.5°)",
    pv1SpecificYield: pv1SpecYield,
    pv3SpecificYield: pv3SpecYield,
    ratioPct,
    deltaPct: ratioPct !== null ? round1(ratioPct - 100) : null,
    ratedRatio: round3(ratedRatio),
    actualPowerRatio: relValid ? round3(relPv1Sum / relPv3Sum) : null,
    status: classifyRelativePairStatus(ratioPct, relRows.length),
  };

  // PV1/PV3 正常バンドを使って baselineDeltaPct に相対偏差を付与 (WEST組のみ)
  if (pv1VsPv3.deltaPct !== null) {
    strings[0].baselineDeltaPct = round1(pv1VsPv3.deltaPct * 0.5);
    strings[2].baselineDeltaPct = round1(-pv1VsPv3.deltaPct * 0.5);
  }

  const currentYear = getWarrantyYearForDate(todayJst);
  const currentSpan = getWarrantyYearSpan(currentYear);
  const [curY, curM, curD] = parseIsoParts(todayJst);
  const [ysY, ysM, ysD] = parseIsoParts(currentSpan.startIso);
  const daysElapsedInWarranty = Math.max(
    1,
    Math.floor(
      (toUtcMs(curY, curM, curD) - toUtcMs(...parseIsoParts(WARRANTY_START_DATE))) /
        86400000,
    ) + 1,
  );
  const daysInYearElapsed = Math.max(
    1,
    Math.min(
      currentSpan.totalDays,
      Math.floor((toUtcMs(curY, curM, curD) - toUtcMs(ysY, ysM, ysD)) / 86400000) +
        1,
    ),
  );

  const warrantyCurve: WarrantyYearPoint[] = [];
  let hasFloorBreach = false;
  for (let yr = 1; yr <= OUTPUT_WARRANTY_YEARS; yr++) {
    const span = getWarrantyYearSpan(yr);
    const floorPct = getWarrantyFloorPct(yr);
    const yb = yearBuckets.get(yr);
    const yrPrPct =
      yb && yb.expectedKwh > 0.5 ? round1((yb.actualKwh / yb.expectedKwh) * 100) : null;

    // Year 1: STC換算推定出力 (PR / BOS) を表示。Year 2+ で Year 1 実績基準が十分集まっている場合は
    // Year 1 実測PR比 × 99.5% (周辺影の固定バイアス相殺) で年次劣化を高精度評価
    let retPct: number | null = null;
    if (yrPrPct !== null) {
      if (yr >= 2 && hasCalibratedYear1Baseline && year1PrPct !== null) {
        retPct = round1((yrPrPct / year1PrPct) * 99.5);
      } else {
        retPct = round1(yrPrPct / BOS_DERATE_FACTOR);
      }
    }

    const canJudgeFloorBreach =
      retPct !== null &&
      ((yr >= 2 && hasCalibratedYear1Baseline && (yb?.days ?? 0) >= 30) ||
        (yr === 1 && (yb?.days ?? 0) >= 120 && retPct < floorPct - 8));
    const belowFloor = Boolean(canJudgeFloorBreach && retPct !== null && retPct < floorPct - 2.0);
    if (belowFloor) hasFloorBreach = true;

    warrantyCurve.push({
      year: yr,
      periodLabel: span.periodLabel,
      guaranteeFloorPct: floorPct,
      measuredRetentionPct: retPct,
      measuredPrPct: yrPrPct,
      measuredDays: yb?.days ?? 0,
      isCurrentYear: yr === currentYear,
      belowFloor,
    });
  }

  let overallStatus: HealthStatus = "HEALTHY";
  if (measuredValidDays < 3) {
    overallStatus = "COLLECTING";
  } else if (
    hasFloorBreach ||
    strings.some((s) => s.status === "CHECK") ||
    pv1VsPv3.status === "CHECK"
  ) {
    overallStatus = "CHECK";
  } else if (
    strings.some((s) => s.status === "WATCH") ||
    pv1VsPv3.status === "WATCH"
  ) {
    overallStatus = "WATCH";
  }

  let calibrationNote: string;
  if (measuredValidDays < 3) {
    calibrationNote = `Collecting full-day telemetry & Open-Meteo irradiance (${measuredValidDays}/3+ valid days).`;
  } else if (measuredValidDays < 60) {
    calibrationNote = `Year 1 baseline calibrating (${measuredValidDays} valid days; Open-Meteo POA+Temp & PV1/PV3 WEST match active). Horizon shading affects winter absolute PR%.`;
  } else {
    calibrationNote = `Calibrated across ${measuredValidDays} valid days with Open-Meteo Hay-Davies POA & Ross cell-temp (-0.29%/°C) model.`;
  }

  return {
    warrantyId: WARRANTY_ID,
    warrantyStartDate: WARRANTY_START_DATE,
    productWarrantyYears: PRODUCT_WARRANTY_YEARS,
    outputWarrantyYears: OUTPUT_WARRANTY_YEARS,
    currentYear,
    daysElapsedInWarranty: daysInYearElapsed > 0 ? daysElapsedInWarranty : 1,
    daysInCurrentYear: daysInYearElapsed,
    totalDaysInCurrentYear: currentSpan.totalDays,
    guaranteeFloorPct: getWarrantyFloorPct(currentYear),
    overallStatus,
    arrayRatedKw: ARRAY_RATED_KW,
    arrayPrPct,
    arrayRetentionPct,
    measuredValidDays,
    totalMeasuredKwh,
    totalExpectedPoaTempKwh,
    canataroPacePct,
    avgDayTempC:
      tempWeightGhi > 0 ? round1(tempWeightedSum / tempWeightGhi) : null,
    totalGhiKwhM2: round1(totalGhiKwhM2),
    latestDataDate,
    pv1VsPv3,
    strings,
    warrantyCurve,
    tempCoeffPctPerC: MODULE_TEMP_COEFF_PCT_PER_C,
    calibrationNote,
  };
}
