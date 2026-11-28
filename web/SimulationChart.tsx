import React from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  PV_SERIES,
  aggregateAnnualPvTotals,
  resolveMonthlyPvValues,
  type PvMonthlyRecord,
} from "./PvCharts";
import {
  CANATARO_ANNUAL_TOTAL_KWH,
  CANATARO_BASE_SIMULATION,
} from "./pvHealth";

export interface MonthlySimItem {
  month: number;
  label: string;
  shortLabel: string;
  estimatedKwh: number;
  actualKwh: number;
  actualExactKwh: number;
  pv1: number;
  pv2: number;
  pv3: number;
  pv4: number;
  barMaxKwh: number;
  pct: number;
}

const BASE_SIMULATION = CANATARO_BASE_SIMULATION;
export const ANNUAL_TOTAL_KWH = CANATARO_ANNUAL_TOTAL_KWH;

interface TooltipPayloadItem {
  payload?: MonthlySimItem;
}

function CustomTooltip({
  active,
  payload,
  isCurrentYear,
  currentMonth,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  isCurrentYear: boolean;
  currentMonth: number;
}) {
  if (!active || !payload || !payload.length || !payload[0].payload) {
    return null;
  }
  const item = payload[0].payload;
  const isCurrent = isCurrentYear && item.month === currentMonth;
  return (
    <div className="sim-tooltip">
      <div className="sim-tooltip-title">
        {item.label}
        {isCurrent ? <span className="sim-tooltip-tag">CURRENT</span> : null}
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label">ACTUAL:</span>
        <span className="sim-tooltip-actual">{Math.round(item.actualExactKwh)} kWh</span>
      </div>
      {item.actualExactKwh > 0 ? (
        <div className="sim-tooltip-pv-list">
          {PV_SERIES.map((s) => (
            <div key={s.key} className="sim-tooltip-row sim-tooltip-pv-row">
              <span className="sim-tooltip-label" style={{ color: s.color }}>
                {s.label}:
              </span>
              <span className="sim-tooltip-pv-val">{item[s.key].toFixed(1)} kWh</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label">ESTIMATED:</span>
        <span className="sim-tooltip-est">{item.estimatedKwh} kWh</span>
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label">ACHIEVEMENT:</span>
        <span className="sim-tooltip-pct">{item.pct.toFixed(1)}%</span>
      </div>
    </div>
  );
}

function topRoundedBarPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r = 4,
): string {
  if (w <= 0 || h <= 0) return "";
  const rad = Math.min(r, w / 2, h);
  const x2 = x + w;
  const y2 = y + h;
  return (
    `M ${x} ${y2} ` +
    `L ${x} ${y + rad} ` +
    `Q ${x} ${y} ${x + rad} ${y} ` +
    `L ${x2 - rad} ${y} ` +
    `Q ${x2} ${y} ${x2} ${y + rad} ` +
    `L ${x2} ${y2} Z`
  );
}

interface CustomBarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: MonthlySimItem;
}

function renderGenerationBar(rawProps: unknown): React.ReactElement {
  const props = (rawProps ?? {}) as CustomBarShapeProps;
  const x = Number(props.x ?? 0);
  const y = Number(props.y ?? 0);
  const width = Number(props.width ?? 0);
  const height = Number(props.height ?? 0);
  const item = props.payload;
  if (!item || width <= 0 || height <= 0) {
    return <g />;
  }

  const est = Math.max(0, item.estimatedKwh);
  const pvVals = [item.pv1, item.pv2, item.pv3, item.pv4].map((v) => Math.max(0, v));
  const pvSum = pvVals[0] + pvVals[1] + pvVals[2] + pvVals[3];
  const act = pvSum > 0 ? pvSum : Math.max(0, item.actualExactKwh);
  const exceedsEst = act > est;
  const maxVal = Math.max(item.barMaxKwh, est, act, 1);
  const baseY = y + height;
  const estH = (est / maxVal) * height;
  const estY = baseY - estH;

  const estPath = topRoundedBarPath(x, estY, width, estH, 4);
  const clipId = `sim-est-clip-${item.month}`;

  const renderPvStack = (clipUrl?: string) => {
    if (act <= 0) return null;
    const vals =
      pvSum > 0 ? pvVals : [act, 0, 0, 0];
    let topNonZeroIdx = -1;
    for (let i = PV_SERIES.length - 1; i >= 0; i--) {
      if (vals[i] > 0) {
        topNonZeroIdx = i;
        break;
      }
    }
    let cursorY = baseY;
    const elems: React.ReactElement[] = [];
    for (let i = 0; i < PV_SERIES.length; i++) {
      const val = vals[i];
      if (val <= 0) continue;
      const segH = (val / maxVal) * height;
      const segY = cursorY - segH;
      cursorY = segY;
      // ESTIMATEDを実績(PV1〜4合計)が超えた場合のみ最上段(PV4等)を上端角丸にする
      const roundTop = exceedsEst && i === topNonZeroIdx;
      const segPath = roundTop
        ? topRoundedBarPath(x, segY, width, segH, 4)
        : `M ${x} ${segY} H ${x + width} V ${segY + segH} H ${x} Z`;
      if (!segPath) continue;
      const s = PV_SERIES[i];
      elems.push(
        <path
          key={s.key}
          d={segPath}
          fill={s.fill}
          stroke={s.color}
          strokeWidth={1.1}
        />,
      );
    }
    return <g clipPath={clipUrl}>{elems}</g>;
  };

  // 実績 > 推定: ESTIMATEDはグラフ上に表示せず、PV1〜4積み上げのみ描画する
  if (exceedsEst) {
    return <g>{renderPvStack()}</g>;
  }

  // 実績 <= 推定: 推定を背面枠(点線)にし、下から PV1〜4 を積み上げる
  return (
    <g>
      {estPath ? (
        <defs>
          <clipPath id={clipId}>
            <path d={estPath} />
          </clipPath>
        </defs>
      ) : null}
      {estPath ? (
        <path
          d={estPath}
          fill="rgba(215, 189, 114, 0.22)"
          stroke="#d7bd72"
          strokeWidth={1.15}
          strokeDasharray="3 2.5"
        />
      ) : null}
      {renderPvStack(estPath ? `url(#${clipId})` : undefined)}
    </g>
  );
}

function SimulationChartView({
  selectedYear,
  currentYear,
  currentMonth,
  monthlyActualKwh,
  pvMonthly,
}: {
  selectedYear: number;
  currentYear: number;
  currentMonth: number;
  monthlyActualKwh: Record<number, number>;
  pvMonthly: PvMonthlyRecord[];
}) {
  const isCurrentYear = selectedYear === currentYear;
  const pvByMonth = new Map<number, PvMonthlyRecord>();
  for (const rec of pvMonthly) {
    pvByMonth.set(rec.month, rec);
  }

  const annualPvTotals = aggregateAnnualPvTotals(pvMonthly, monthlyActualKwh);
  const data: MonthlySimItem[] = BASE_SIMULATION.map((b) => {
    const actualRaw = Math.max(0, monthlyActualKwh[b.month] ?? 0);
    const actualRounded = Math.round(actualRaw);
    const pct = b.estimatedKwh > 0 ? (actualRaw / b.estimatedKwh) * 100 : 0;
    const { pv1, pv2, pv3, pv4 } = resolveMonthlyPvValues(
      pvByMonth.get(b.month),
      actualRaw,
    );

    return {
      month: b.month,
      label: b.label,
      shortLabel: b.label,
      estimatedKwh: b.estimatedKwh,
      actualKwh: actualRounded,
      actualExactKwh: actualRaw,
      pv1,
      pv2,
      pv3,
      pv4,
      barMaxKwh: Math.max(b.estimatedKwh, actualRaw, actualRounded),
      pct,
    };
  });

  const totalActualRaw = Object.values(monthlyActualKwh).reduce(
    (acc, v) => acc + Math.max(0, v ?? 0),
    0,
  );
  const totalActualKwh = Math.round(totalActualRaw);
  const totalPct = (totalActualRaw / ANNUAL_TOTAL_KWH) * 100;

  const maxBar = data.reduce((mx, d) => Math.max(mx, d.barMaxKwh), 0);
  const yMax = maxBar > 900 ? Math.ceil(maxBar / 100) * 100 : 900;
  const yTicks: number[] = [];
  for (let t = 0; t <= yMax; t += 100) {
    yTicks.push(t);
  }
  const currentMonthItem = isCurrentYear
    ? data.find((d) => d.month === currentMonth)
    : undefined;

  return (
    <div className="sim-container">
      {/* 上段: 対象年の年間トータル 実績 / 推定 */}
      <div className="sim-summary-grid">
        <div className="sim-summary-card sim-annual-card">
          <div className="sim-summary-head">
            <span className="sim-summary-title">
              ANNUAL TOTAL (ACTUAL / ESTIMATED)
            </span>
            <span className="ef-outline-badge sim-pct-badge">
              {totalPct.toFixed(1)}%
            </span>
          </div>
          <div className="sim-summary-val">
            {totalActualKwh.toLocaleString("ja-JP")}
            <span className="sim-summary-sep">/</span>
            <span className="sim-summary-target">
              {ANNUAL_TOTAL_KWH.toLocaleString("ja-JP")} kWh
            </span>
          </div>

          <div
            className="sim-pv-breakdown"
            aria-label="Annual Generation by PV String"
          >
            {PV_SERIES.map((s, idx) => (
              <React.Fragment key={s.key}>
                {idx > 0 ? <span className="sim-pv-plus">+</span> : null}
                <span style={{ color: s.color }}>
                  {annualPvTotals[s.key].toFixed(1)}{" "}
                  <span className="sim-pv-plus">kWh</span>
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* 中段: 月別発電量グラフ (ACTUAL=PV1〜4積み上げ + ESTIMATED重ね枠) */}
      <section className="summary-graph-block" aria-label="Monthly Generation">
        <div className="summary-subpage-head">
          <span className="summary-subpage-title">MONTHLY GENERATION</span>
        </div>

        <div className="sim-chart-box">
          <div className="summary-chart-legend sim-chart-legend" aria-label="Generation Legend">
            {PV_SERIES.map((s) => (
              <span key={s.key} className="summary-legend-item">
                <span
                  className="sim-legend-swatch"
                  style={{
                    backgroundColor: s.fill,
                    border: `1px solid ${s.color}`,
                  }}
                />
                <span style={{ color: s.color }}>{s.label}</span>
              </span>
            ))}
            <span className="summary-legend-item">
              <span className="sim-legend-swatch sim-legend-swatch-est" />
              <span style={{ color: "#fbdd84" }}>ESTIMATED</span>
            </span>
          </div>

          <ResponsiveContainer width="100%" height={232}>
            <BarChart
              data={data}
              margin={{ top: 20, right: 8, left: -10, bottom: 2 }}
            >
              <CartesianGrid
                stroke="#383942"
                strokeDasharray="3 3"
                vertical={false}
              />
              {currentMonthItem ? (
                <ReferenceArea
                  x1={currentMonthItem.shortLabel}
                  x2={currentMonthItem.shortLabel}
                  fill="#fbdd84"
                  fillOpacity={0.08}
                  stroke="none"
                />
              ) : null}
              <XAxis
                dataKey="shortLabel"
                interval={0}
                tick={(tickProps: {
                  x?: number | string;
                  y?: number | string;
                  payload?: { value?: string };
                }) => {
                  const tx = Number(tickProps.x ?? 0);
                  const ty = Number(tickProps.y ?? 0);
                  const val = String(tickProps.payload?.value ?? "");
                  const isCur =
                    Boolean(currentMonthItem) &&
                    val === currentMonthItem?.shortLabel;
                  return (
                    <text
                      x={tx}
                      y={ty + 11}
                      textAnchor="middle"
                      fill={isCur ? "#fbdd84" : "#b8bbc6"}
                      fontSize={10.5}
                      fontWeight={isCur ? 700 : 400}
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {val}
                    </text>
                  );
                }}
                axisLine={{ stroke: "#484a54" }}
                tickLine={false}
              />
              <YAxis
                domain={[0, yMax]}
                ticks={yTicks}
                width={44}
                tick={{
                  fill: "#9a9ea6",
                  fontSize: 11,
                  fontFamily: "JetBrains Mono, monospace",
                }}
                axisLine={false}
                tickLine={false}
                label={(props: {
                  viewBox?: { x?: number; y?: number; width?: number };
                }) => {
                  const vbX = Number(props.viewBox?.x ?? 0);
                  const vbY = Number(props.viewBox?.y ?? 20);
                  const vbW = Number(props.viewBox?.width ?? 44);
                  return (
                    <text
                      x={vbX + vbW - 8}
                      y={vbY - 9}
                      textAnchor="end"
                      fill="#9a9ea6"
                      fontSize={10.5}
                      fontFamily="JetBrains Mono, monospace"
                    >
                      kWh
                    </text>
                  );
                }}
              />
              <Tooltip
                cursor={{ fill: "rgba(251, 221, 132, 0.08)" }}
                content={
                  <CustomTooltip
                    isCurrentYear={isCurrentYear}
                    currentMonth={currentMonth}
                  />
                }
              />
              <Bar
                dataKey="barMaxKwh"
                maxBarSize={24}
                shape={renderGenerationBar}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* 下段: 1月〜12月の 実績/推定 & 達成率(%) 一覧 */}
      <div className="sim-months-grid">
        {data.map((m) => {
          const isCurrent = isCurrentYear && m.month === currentMonth;
          const isFinalized =
            selectedYear < currentYear ||
            (selectedYear === currentYear && m.month < currentMonth);
          const isZero = m.pct.toFixed(1) === "0.0";
          const pctStateClass = isZero
            ? "is-zero"
            : isCurrent
              ? "is-current-month"
              : isFinalized
                ? m.pct >= 100
                  ? "is-achieved"
                  : "is-below"
                : "is-zero";
          return (
            <div
              key={m.month}
              className={`sim-month-cell${isCurrent ? " is-current" : ""}`}
            >
              <span className="sim-month-name">{m.label}</span>
              <span className="sim-month-val">
                {m.actualKwh > 0 ? m.actualKwh : "0"}
                <small>/{m.estimatedKwh}</small>
              </span>
              <span className={`sim-month-pct ${pctStateClass}`}>
                {m.pct.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>

      <div className="sim-note">
        Generation estimates by CanaTARO Ver2.46.0
      </div>
    </div>
  );
}

let chartRoot: Root | null = null;

export function mountOrUpdateSimulationChart(
  selectedYear: number,
  currentYear: number,
  currentMonth: number,
  monthlyActualKwh: Record<number, number> = {},
  pvMonthly: PvMonthlyRecord[] = [],
): void {
  const container = document.getElementById("sim-chart-root");
  if (!container) return;
  if (!chartRoot) {
    chartRoot = createRoot(container);
  }
  chartRoot.render(
    <SimulationChartView
      selectedYear={selectedYear}
      currentYear={currentYear}
      currentMonth={currentMonth}
      monthlyActualKwh={monthlyActualKwh}
      pvMonthly={pvMonthly}
    />,
  );
}
