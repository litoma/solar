import React, { useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useContainerWidth } from "./SummaryCharts";

export interface PvDailyRecord {
  date: string; // YYYY-MM-DD
  pv1: number;
  pv2: number;
  pv3: number;
  pv4: number;
}

interface ChartPoint {
  md: string;
  date: string | null;
  pv1: number | null;
  pv2: number | null;
  pv3: number | null;
  pv4: number | null;
  west: number | null;
  east: number | null;
  north: number | null;
}

interface SeriesConfig {
  key: keyof Pick<
    ChartPoint,
    "pv1" | "pv2" | "pv3" | "pv4" | "west" | "east" | "north"
  >;
  label: string;
  color: string;
}

// PV1〜4は1ページ目の屋根配色と統一
const PV_SERIES: SeriesConfig[] = [
  { key: "pv1", label: "PV1", color: "#f0a04b" },
  { key: "pv2", label: "PV2", color: "#4cc3d9" },
  { key: "pv3", label: "PV3", color: "#6fd08c" },
  { key: "pv4", label: "PV4", color: "#ee7f6b" },
];

// 方位別はPV1〜4の色と重複しない固有パレットを使用
const DIR_SERIES: SeriesConfig[] = [
  { key: "west", label: "WEST", color: "#fbdd84" },
  { key: "east", label: "EAST", color: "#b197fc" },
  { key: "north", label: "NORTH", color: "#f080b8" },
];

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const TICKS_DESKTOP = [
  "1/1",
  "2/1",
  "3/1",
  "4/1",
  "5/1",
  "6/1",
  "7/1",
  "8/1",
  "9/1",
  "10/1",
  "11/1",
  "12/31",
];
const TICKS_MOBILE = ["1/1", "3/1", "5/1", "7/1", "9/1", "11/1", "12/31"];

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function buildAnnualSkeleton(records: PvDailyRecord[]): ChartPoint[] {
  const byMmDd = new Map<string, PvDailyRecord>();
  let hasLeapDay = false;
  for (const r of records) {
    if (!r.date || r.date.length < 10) continue;
    const mmdd = r.date.slice(5, 10);
    if (mmdd === "02-29") hasLeapDay = true;
    byMmDd.set(mmdd, r);
  }

  const pts: ChartPoint[] = [];
  for (let m = 1; m <= 12; m++) {
    const dim = m === 2 && hasLeapDay ? 29 : DAYS_IN_MONTH[m - 1];
    for (let d = 1; d <= dim; d++) {
      const mmdd = `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const rec = byMmDd.get(mmdd);
      pts.push({
        md: `${m}/${d}`,
        date: rec ? rec.date : null,
        pv1: rec ? round2(Math.max(0, rec.pv1)) : null,
        pv2: rec ? round2(Math.max(0, rec.pv2)) : null,
        pv3: rec ? round2(Math.max(0, rec.pv3)) : null,
        pv4: rec ? round2(Math.max(0, rec.pv4)) : null,
        west: rec ? round2(Math.max(0, rec.pv1 + rec.pv3)) : null,
        east: rec ? round2(Math.max(0, rec.pv2)) : null,
        north: rec ? round2(Math.max(0, rec.pv4)) : null,
      });
    }
  }
  return pts;
}

function PvDailyTooltip({
  active,
  payload,
  series,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartPoint }>;
  series: SeriesConfig[];
}) {
  if (!active || !payload || !payload.length || !payload[0].payload) {
    return null;
  }
  const pt = payload[0].payload;
  const hasAny = series.some((s) => typeof pt[s.key] === "number");
  const total = series.reduce(
    (sum, s) => sum + (typeof pt[s.key] === "number" ? Number(pt[s.key]) : 0),
    0,
  );
  return (
    <div className="sim-tooltip">
      <div className="sim-tooltip-title">{pt.date || pt.md}</div>
      {!hasAny ? (
        <div className="sim-tooltip-row">
          <span className="sim-tooltip-label">データなし</span>
          <span>--</span>
        </div>
      ) : (
        <>
          {series.map((s) => {
            const val = pt[s.key];
            return (
              <div key={s.key} className="sim-tooltip-row">
                <span className="sim-tooltip-label" style={{ color: s.color }}>
                  {s.label}:
                </span>
                <span>{typeof val === "number" ? `${val.toFixed(2)} kWh` : "--"}</span>
              </div>
            );
          })}
          <div className="sim-tooltip-row summary-tooltip-total">
            <span className="sim-tooltip-label">TOTAL:</span>
            <span>{total.toFixed(2)} kWh</span>
          </div>
        </>
      )}
    </div>
  );
}

function DailyStackedBarBlock({
  title,
  ariaLabel,
  data,
  series,
  xTicks,
  todayMd,
  height,
  barWidthPx,
}: {
  title: string;
  ariaLabel: string;
  data: ChartPoint[];
  series: SeriesConfig[];
  xTicks: string[];
  todayMd: string;
  height: number;
  barWidthPx: number;
}) {
  return (
    <section className="summary-graph-block" aria-label={ariaLabel}>
      <div className="summary-subpage-head">
        <span className="summary-subpage-title">{title}</span>
      </div>

      <div className="sim-chart-box summary-chart-box">
        <div className="summary-chart-legend">
          {series.map((s) => (
            <span key={s.key} className="summary-legend-item">
              <span
                className="summary-legend-swatch"
                style={{ backgroundColor: s.color }}
              />
              <span style={{ color: s.color }}>{s.label}</span>
            </span>
          ))}
        </div>

        <ResponsiveContainer width="100%" height={height}>
          <BarChart
            data={data}
            margin={{ top: 20, right: 18, left: -10, bottom: 2 }}
            barCategoryGap={0}
            barGap={0}
          >
            <CartesianGrid stroke="#383942" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="md"
              ticks={xTicks}
              interval={0}
              padding={{ left: 10, right: 10 }}
              tick={(tickProps: {
                x?: number | string;
                y?: number | string;
                payload?: { value?: string };
              }) => {
                const tx = Number(tickProps.x ?? 0);
                const ty = Number(tickProps.y ?? 0);
                const val = String(tickProps.payload?.value ?? "");
                return (
                  <text
                    x={tx}
                    y={ty + 9}
                    textAnchor="middle"
                    fill="#b8bbc6"
                    fontSize={10}
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {val}
                  </text>
                );
              }}
              axisLine={{ stroke: "#484a54" }}
              tickLine={false}
            />
            {todayMd ? (
              <ReferenceLine
                x={todayMd}
                stroke="#fbdd84"
                strokeWidth={1}
                strokeOpacity={0.65}
              />
            ) : null}
            <YAxis
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
              cursor={{ fill: "rgba(255, 255, 255, 0.06)" }}
              content={<PvDailyTooltip series={series} />}
            />
            {series.map((s) => (
              <Bar
                key={s.key}
                name={s.label}
                dataKey={s.key}
                stackId="daily"
                fill={s.color}
                fillOpacity={0.9}
                barSize={barWidthPx}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function PvChartsView({
  records,
  todayMd,
}: {
  records: PvDailyRecord[];
  todayMd: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const width = useContainerWidth(
    wrapRef,
    typeof window !== "undefined" ? Math.min(688, window.innerWidth - 32) : 688,
  );

  const data = React.useMemo(() => buildAnnualSkeleton(records), [records]);
  const isCompact = width < 480;
  const xTicks = isCompact ? TICKS_MOBILE : TICKS_DESKTOP;
  const chartHeight = isCompact ? 172 : 178;
  const barWidthPx = isCompact ? 1.5 : 2;

  return (
    <div className="summary-subpage pv-charts-subpage" ref={wrapRef}>
      <DailyStackedBarBlock
        title="DAILY BY PV (LAST 365D)"
        ariaLabel="Daily Stacked Generation by PV String"
        data={data}
        series={PV_SERIES}
        xTicks={xTicks}
        todayMd={todayMd}
        height={chartHeight}
        barWidthPx={barWidthPx}
      />
      <DailyStackedBarBlock
        title="DAILY BY DIRECTION (LAST 365D)"
        ariaLabel="Daily Stacked Generation by Roof Direction"
        data={data}
        series={DIR_SERIES}
        xTicks={xTicks}
        todayMd={todayMd}
        height={chartHeight}
        barWidthPx={barWidthPx}
      />
    </div>
  );
}

let pvChartsRoot: Root | null = null;

export function mountOrUpdatePvCharts(
  records: PvDailyRecord[],
  todayMonth: number,
  todayDay: number,
): void {
  const container = document.getElementById("pv-charts-root");
  if (!container) return;
  if (!pvChartsRoot) {
    pvChartsRoot = createRoot(container);
  }
  const todayMd =
    todayMonth >= 1 && todayDay >= 1 ? `${todayMonth}/${todayDay}` : "";
  pvChartsRoot.render(<PvChartsView records={records} todayMd={todayMd} />);
}
