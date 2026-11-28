import React from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PV_SERIES, type PvKey } from "./PvCharts";
import {
  OUTPUT_WARRANTY_YEARS,
  PRODUCT_WARRANTY_YEARS,
  WARRANTY_ID,
  WARRANTY_START_DATE,
  getWarrantyFloorPct,
  type HealthStatus,
  type PvHealthPayload,
  type PvStringHealthSummary,
  type WarrantyYearPoint,
} from "./pvHealth";

const PV_COLOR_MAP = new Map<PvKey, string>(
  PV_SERIES.map((s) => [s.key, s.color]),
);

const STATUS_META: Record<
  HealthStatus,
  { label: string; shortLabel: string; className: string }
> = {
  HEALTHY: {
    label: "HEALTHY",
    shortLabel: "OK",
    className: "is-healthy",
  },
  WATCH: {
    label: "WATCH",
    shortLabel: "WATCH",
    className: "is-watch",
  },
  CHECK: {
    label: "CHECK",
    shortLabel: "CHECK",
    className: "is-check",
  },
  COLLECTING: {
    label: "COLLECTING",
    shortLabel: "WAIT",
    className: "is-collecting",
  },
};

function buildFallbackHealthPayload(): PvHealthPayload {
  const curve: WarrantyYearPoint[] = [];
  for (let yr = 1; yr <= OUTPUT_WARRANTY_YEARS; yr++) {
    curve.push({
      year: yr,
      periodLabel: `${2026 + yr - 1}/10`,
      guaranteeFloorPct: getWarrantyFloorPct(yr),
      measuredRetentionPct: null,
      measuredPrPct: null,
      measuredDays: 0,
      isCurrentYear: yr === 1,
      belowFloor: false,
    });
  }
  const strings: PvStringHealthSummary[] = PV_SERIES.map((s, idx) => ({
    key: s.key,
    label: s.label,
    direction: s.direction.toUpperCase(),
    ratedKw: [1.705, 1.63, 1.395, 1.335][idx] ?? 0,
    actualKwh: 0,
    expectedPoaTempKwh: 0,
    specificYieldKwhPerKwp: 0,
    avgDailyKwhPerKwp: 0,
    prPct: null,
    bosAdjustedPct: null,
    baselineDeltaPct: null,
    status: "COLLECTING",
  }));

  return {
    warrantyId: WARRANTY_ID,
    warrantyStartDate: WARRANTY_START_DATE,
    productWarrantyYears: PRODUCT_WARRANTY_YEARS,
    outputWarrantyYears: OUTPUT_WARRANTY_YEARS,
    currentYear: 1,
    daysElapsedInWarranty: 1,
    daysInCurrentYear: 1,
    totalDaysInCurrentYear: 365,
    guaranteeFloorPct: getWarrantyFloorPct(1),
    overallStatus: "COLLECTING",
    arrayRatedKw: 6.065,
    arrayPrPct: null,
    arrayRetentionPct: null,
    measuredValidDays: 0,
    totalMeasuredKwh: 0,
    totalExpectedPoaTempKwh: 0,
    canataroPacePct: null,
    avgDayTempC: null,
    totalGhiKwhM2: 0,
    latestDataDate: null,
    pv1VsPv3: {
      pairLabel: "PV1 vs PV3 (WEST 30.5°)",
      pv1SpecificYield: 0,
      pv3SpecificYield: 0,
      ratioPct: null,
      deltaPct: null,
      ratedRatio: 1.222,
      actualPowerRatio: null,
      status: "COLLECTING",
    },
    strings,
    warrantyCurve: curve,
    tempCoeffPctPerC: -0.29,
    calibrationNote: "Awaiting telemetry & Open-Meteo irradiance sync...",
  };
}

interface CurveTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: WarrantyYearPoint }>;
}

function WarrantyCurveTooltip({ active, payload }: CurveTooltipProps) {
  if (!active || !payload?.length || !payload[0]?.payload) return null;
  const pt = payload[0].payload;
  return (
    <div className="sim-tooltip pv-health-tooltip">
      <div className="sim-tooltip-head">
        <span>YEAR {pt.year} / 30</span>
        <span className="sim-tooltip-pct">{pt.periodLabel}–</span>
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-dot is-floor" />
        <span className="sim-tooltip-label">Guarantee Floor</span>
        <span className="sim-tooltip-val">{pt.guaranteeFloorPct.toFixed(1)}%</span>
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-dot is-meas" />
        <span className="sim-tooltip-label">STC Est. Output</span>
        <span className="sim-tooltip-val">
          {pt.measuredRetentionPct !== null
            ? `${pt.measuredRetentionPct.toFixed(1)}%`
            : "—"}
        </span>
      </div>
      {pt.measuredPrPct !== null && (
        <div className="sim-tooltip-row">
          <span className="sim-tooltip-dot is-pr" />
          <span className="sim-tooltip-label">POA+Temp PR</span>
          <span className="sim-tooltip-val">{pt.measuredPrPct.toFixed(1)}%</span>
        </div>
      )}
      {pt.measuredDays > 0 && (
        <div className="pv-health-tip-days">Valid Days: {pt.measuredDays} d</div>
      )}
    </div>
  );
}

function formatPct(val: number | null): string {
  return val !== null && Number.isFinite(val) ? `${val.toFixed(1)}%` : "—";
}

function prToneClass(status: HealthStatus): string {
  return STATUS_META[status].className;
}

function PvHealthView({ data }: { data: PvHealthPayload | null }) {
  const health = data ?? buildFallbackHealthPayload();
  const overallMeta = STATUS_META[health.overallStatus];
  const pairMeta = STATUS_META[health.pv1VsPv3.status];

  const startFormatted = health.warrantyStartDate.replace(/-/g, "/");
  const termPct = Math.min(
    100,
    Math.max(1.5, (health.currentYear / health.outputWarrantyYears) * 100),
  );

  // PV1/PV3 ゲージバー (範囲: 75% .. 125%, 正常バンド 85% .. 115%)
  const ratioVal = health.pv1VsPv3.ratioPct;
  const gaugeMarkerLeftPct =
    ratioVal !== null
      ? Math.min(98, Math.max(2, ((ratioVal - 75) / 50) * 100))
      : null;

  // 30年保証カーブのY軸下限/上限をデータに合わせる
  let minY = 85;
  for (const pt of health.warrantyCurve) {
    if (pt.measuredRetentionPct !== null && pt.measuredRetentionPct - 4 < minY) {
      minY = Math.floor(pt.measuredRetentionPct - 4);
    }
  }
  minY = Math.max(50, Math.min(84, minY));
  const maxY = 104;

  return (
    <div className="pv-health-wrap">
      {/* 上段: 保証サマリー & 全体PRカード */}
      <div className="sim-summary-card pv-health-summary-card">
        <div className="pv-health-top-row">
          <div className="pv-health-title-block">
            <div className="pv-health-card-kicker">OUTPUT WARRANTY &amp; PANEL HEALTH</div>
            <div className="pv-health-cert-line">
              <span>ID {health.warrantyId}</span>
              <span className="pv-health-dot-sep">·</span>
              <span>START {startFormatted}</span>
              <span className="pv-health-dot-sep">·</span>
              <span>{health.productWarrantyYears}YR PRODUCT</span>
            </div>
          </div>
          <span className={`pv-health-badge ${overallMeta.className}`}>
            <span className="pv-health-badge-dot" />
            {overallMeta.label}
          </span>
        </div>

        <div className="pv-health-hero-grid">
          <div className="pv-health-term-box">
            <div className="pv-health-term-main">
              <span className="pv-health-year-num">YEAR {health.currentYear}</span>
              <span className="pv-health-year-denom">
                / {health.outputWarrantyYears}
              </span>
              <span className="pv-health-floor-pill">
                FLOOR {health.guaranteeFloorPct.toFixed(1)}%
              </span>
            </div>
            <div
              className="pv-health-term-track"
              role="progressbar"
              aria-valuenow={health.currentYear}
              aria-valuemin={1}
              aria-valuemax={health.outputWarrantyYears}
            >
              <div
                className="pv-health-term-fill"
                style={{ width: `${termPct.toFixed(1)}%` }}
              />
            </div>
            <div className="pv-health-term-sub">
              Day {health.daysInCurrentYear} / {health.totalDaysInCurrentYear} (Yr{" "}
              {health.currentYear}) · -0.4%/yr → 87.4% at Yr 30
            </div>
          </div>

          <div className="pv-health-kpi-strip">
            <div className="pv-health-kpi-cell">
              <div className="pv-health-kpi-label">POA+TEMP PR</div>
              <div className={`pv-health-kpi-val ${overallMeta.className}`}>
                {formatPct(health.arrayPrPct)}
              </div>
              <div className="pv-health-kpi-sub">
                {health.measuredValidDays > 0
                  ? `${health.totalMeasuredKwh.toFixed(1)} / ${health.totalExpectedPoaTempKwh.toFixed(1)} kWh (${health.measuredValidDays}d)`
                  : "Awaiting days"}
              </div>
            </div>

            <div className="pv-health-kpi-cell">
              <div className="pv-health-kpi-label">EST. STC OUTPUT</div>
              <div className="pv-health-kpi-val">
                {formatPct(health.arrayRetentionPct)}
              </div>
              <div className="pv-health-kpi-sub">
                BOS 94.5% adj · γ {health.tempCoeffPctPerC}%/°C
              </div>
            </div>

            <div className="pv-health-kpi-cell">
              <div className="pv-health-kpi-label">SIMULATED PACE</div>
              <div className="pv-health-kpi-val">
                {formatPct(health.canataroPacePct)}
              </div>
              <div className="pv-health-kpi-sub">
                vs CanaTARO
                {health.avgDayTempC !== null ? ` · ${health.avgDayTempC.toFixed(1)}°C` : ""}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 中段: PV1-4 文字列別診断 + PV1 vs PV3 WEST同一面相対比較 */}
      <div className="pv-health-mid-grid">
        <div className="pv-spec-table-card pv-health-table-card">
          <table className="pv-spec-table pv-health-table">
            <thead>
              <tr>
                <th>STRING</th>
                <th className="is-num">MEAS / POA</th>
                <th className="is-num">YIELD</th>
                <th className="is-num">PR%</th>
                <th className="is-num">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {health.strings.map((s) => {
                const color = PV_COLOR_MAP.get(s.key) ?? "#d6d9e4";
                const sMeta = STATUS_META[s.status];
                return (
                  <tr key={s.key}>
                    <td>
                      <span className="pv-spec-name">
                        <span
                          className="pv-dot-color"
                          style={{ backgroundColor: color }}
                        />
                        {s.label}
                        <span className="pv-health-str-dir">
                          {s.direction} · {s.ratedKw.toFixed(2)}kW
                        </span>
                      </span>
                    </td>
                    <td className="is-num">
                      {s.actualKwh.toFixed(1)}
                      <span className="pv-spec-unit"> / {s.expectedPoaTempKwh.toFixed(1)}</span>
                    </td>
                    <td className="is-num">
                      {s.specificYieldKwhPerKwp.toFixed(1)}
                      <span className="pv-spec-unit"> kWh/kW</span>
                    </td>
                    <td className={`is-num pv-health-pr-cell ${prToneClass(s.status)}`}>
                      {formatPct(s.prPct)}
                    </td>
                    <td className="is-num">
                      <span className={`pv-health-mini-pill ${sMeta.className}`}>
                        {sMeta.shortLabel}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="sim-summary-card pv-health-pair-card">
          <div className="pv-health-pair-head">
            <div>
              <div className="pv-health-pair-title">WEST MATCHED-PLANE</div>
              <div className="pv-health-pair-sub">PV1 vs PV3 · Same 30.5° Slope</div>
            </div>
            <span className={`pv-health-mini-pill ${pairMeta.className}`}>
              {pairMeta.label}
            </span>
          </div>

          <div className="pv-health-pair-main">
            <span className={`pv-health-pair-ratio ${pairMeta.className}`}>
              {formatPct(ratioVal)}
            </span>
            {health.pv1VsPv3.deltaPct !== null && (
              <span className="pv-health-pair-delta">
                {health.pv1VsPv3.deltaPct >= 0 ? "+" : ""}
                {health.pv1VsPv3.deltaPct.toFixed(1)}% vs matched
              </span>
            )}
          </div>

          <div className="pv-health-gauge-wrap" aria-hidden="true">
            <div className="pv-health-gauge-track">
              <div className="pv-health-gauge-safe" />
              <div className="pv-health-gauge-center" />
              {gaugeMarkerLeftPct !== null && (
                <div
                  className={`pv-health-gauge-pin ${pairMeta.className}`}
                  style={{ left: `${gaugeMarkerLeftPct}%` }}
                />
              )}
            </div>
            <div className="pv-health-gauge-labels">
              <span>75%</span>
              <span>85%</span>
              <span>100%</span>
              <span>115%</span>
              <span>125%</span>
            </div>
          </div>

          <div className="pv-health-pair-metrics">
            <div className="pv-health-pair-stat">
              <span className="pv-health-pair-key">PV1 (1.705kW)</span>
              <span className="pv-health-pair-num">
                {health.pv1VsPv3.pv1SpecificYield.toFixed(1)} kWh/kW
              </span>
            </div>
            <div className="pv-health-pair-stat">
              <span className="pv-health-pair-key">PV3 (1.395kW)</span>
              <span className="pv-health-pair-num">
                {health.pv1VsPv3.pv3SpecificYield.toFixed(1)} kWh/kW
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 下段: 30年出力保証カーブ + IEC免責注記 */}
      <div className="sim-chart-box pv-health-chart-box">
        <div className="pv-health-chart-head">
          <span className="pv-health-chart-title">
            30-YEAR OUTPUT WARRANTY CURVE (99.0% → 87.4%)
          </span>
          <div className="pv-health-chart-legend">
            <span className="pv-health-leg-item">
              <span className="pv-health-leg-line" />
              GUARANTEE FLOOR
            </span>
            <span className="pv-health-leg-item">
              <span className="pv-health-leg-dot" />
              STC EST. RETENTION
            </span>
          </div>
        </div>

        <div className="pv-health-chart-inner">
          <ResponsiveContainer width="100%" height={158}>
            <ComposedChart
              data={health.warrantyCurve}
              margin={{ top: 8, right: 10, left: -14, bottom: 0 }}
            >
              <defs>
                <linearGradient id="warrantyFloorFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4ade80" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#4ade80" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid
                stroke="#30333c"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                dataKey="year"
                ticks={[1, 5, 10, 15, 20, 25, 30]}
                tickFormatter={(v) => `Y${v}`}
                tick={{ fill: "#8f94a2", fontSize: 10, fontFamily: "JetBrains Mono" }}
                axisLine={{ stroke: "#3c3f4a" }}
                tickLine={false}
              />
              <YAxis
                domain={[minY, maxY]}
                tickFormatter={(v) => `${v}%`}
                tick={{ fill: "#8f94a2", fontSize: 10, fontFamily: "JetBrains Mono" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                content={<WarrantyCurveTooltip />}
                cursor={{ stroke: "#5c6070", strokeDasharray: "3 3" }}
              />
              <ReferenceLine
                y={87.4}
                stroke="#585d6c"
                strokeDasharray="3 3"
              />
              <Area
                type="monotone"
                dataKey="guaranteeFloorPct"
                stroke="none"
                fill="url(#warrantyFloorFill)"
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="guaranteeFloorPct"
                stroke="#4ade80"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: "#4ade80", stroke: "#18191d", strokeWidth: 1.5 }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="measuredRetentionPct"
                stroke="#38bdf8"
                strokeWidth={2}
                connectNulls={false}
                dot={(dotProps: {
                  cx?: number;
                  cy?: number;
                  payload?: WarrantyYearPoint;
                  index?: number;
                }) => {
                  const pt = dotProps.payload;
                  if (
                    !pt ||
                    pt.measuredRetentionPct === null ||
                    dotProps.cx === undefined ||
                    dotProps.cy === undefined
                  ) {
                    return <g key={`empty-${dotProps.index ?? 0}`} />;
                  }
                  const fill = pt.belowFloor ? "#f87171" : "#38bdf8";
                  return (
                    <circle
                      key={`dot-${pt.year}`}
                      cx={dotProps.cx}
                      cy={dotProps.cy}
                      r={4.5}
                      fill={fill}
                      stroke="#18191d"
                      strokeWidth={1.5}
                    />
                  );
                }}
                activeDot={{ r: 5.5, fill: "#38bdf8", stroke: "#18191d", strokeWidth: 1.5 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="pv-health-footnote">
          <div>{health.calibrationNote}</div>
          <div className="pv-health-disclaimer">
            * Advisory telemetry estimate only (Open-Meteo Hay-Davies POA + Ross cell temp + 94.5% DC BOS). Official Canadian Solar claims require IEC 61215 / JIS C 61215 STC testing.
          </div>
        </div>
      </div>
    </div>
  );
}

const rootCache = new WeakMap<HTMLElement, Root>();

export function mountOrUpdatePvHealthView(data: PvHealthPayload | null): void {
  const container = document.getElementById("pv-health-root");
  if (!container) return;
  let root = rootCache.get(container);
  if (!root) {
    root = createRoot(container);
    rootCache.set(container, root);
  }
  root.render(
    <React.StrictMode>
      <PvHealthView data={data} />
    </React.StrictMode>,
  );
}
