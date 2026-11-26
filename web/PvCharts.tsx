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

export interface PvMonthlyRecord {
  ym: string;
  month: number;
  label: string;
  hasData: boolean;
  pv1: number | null;
  pv2: number | null;
  pv3: number | null;
  pv4: number | null;
}

interface MonthlyChartPoint {
  ym: string;
  month: number;
  label: string;
  hasData: boolean;
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
    MonthlyChartPoint,
    "pv1" | "pv2" | "pv3" | "pv4" | "west" | "east" | "north"
  >;
  label: string;
  color: string;
  fill: string;
}

const MONTH_LABELS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

// PV1〜4は3D屋根の蛍光ネオン配色と統一 (オレンジ・水色・黄緑・ピンク)
const PV_SERIES: SeriesConfig[] = [
  { key: "pv1", label: "PV1", color: "#ff7a18", fill: "rgba(255, 122, 24, 0.34)" },
  { key: "pv2", label: "PV2", color: "#00e5ff", fill: "rgba(0, 229, 255, 0.34)" },
  { key: "pv3", label: "PV3", color: "#9eff14", fill: "rgba(158, 255, 20, 0.34)" },
  { key: "pv4", label: "PV4", color: "#ff3ca6", fill: "rgba(255, 60, 166, 0.34)" },
];

// 方位別はPV1〜4と色が重複しない固有の半透明パレットを使用
const DIR_SERIES: SeriesConfig[] = [
  { key: "west", label: "WEST", color: "#fbdd84", fill: "rgba(251, 221, 132, 0.34)" },
  { key: "east", label: "EAST", color: "#b197fc", fill: "rgba(177, 151, 252, 0.34)" },
  { key: "north", label: "NORTH", color: "#94a3b8", fill: "rgba(148, 163, 184, 0.34)" },
];

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function buildMonthlyPoints(
  records: PvMonthlyRecord[],
  selectedYear: number,
): MonthlyChartPoint[] {
  const byMonth = new Map<number, PvMonthlyRecord>();
  for (const r of records) {
    if (r.month >= 1 && r.month <= 12) {
      byMonth.set(r.month, r);
    }
  }

  return MONTH_LABELS.map((label, idx) => {
    const month = idx + 1;
    const defaultYm = `${selectedYear}-${String(month).padStart(2, "0")}`;
    const rec = byMonth.get(month);
    if (
      !rec ||
      !rec.hasData ||
      rec.pv1 === null ||
      rec.pv2 === null ||
      rec.pv3 === null ||
      rec.pv4 === null
    ) {
      return {
        ym: rec?.ym || defaultYm,
        month,
        label,
        hasData: false,
        pv1: null,
        pv2: null,
        pv3: null,
        pv4: null,
        west: null,
        east: null,
        north: null,
      };
    }
    const pv1 = round2(Math.max(0, rec.pv1));
    const pv2 = round2(Math.max(0, rec.pv2));
    const pv3 = round2(Math.max(0, rec.pv3));
    const pv4 = round2(Math.max(0, rec.pv4));
    return {
      ym: rec.ym || defaultYm,
      month,
      label,
      hasData: true,
      pv1,
      pv2,
      pv3,
      pv4,
      west: round2(pv1 + pv3),
      east: pv2,
      north: pv4,
    };
  });
}

function topRoundedSegmentPath(
  x: number,
  y: number,
  w: number,
  h: number,
  roundTop: boolean,
  r = 4,
): string {
  if (w <= 0 || h <= 0) return "";
  if (!roundTop) {
    return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
  }
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

function PvMonthlyTooltip({
  active,
  payload,
  series,
  isCurrentYear,
  currentMonth,
}: {
  active?: boolean;
  payload?: Array<{ payload?: MonthlyChartPoint }>;
  series: SeriesConfig[];
  isCurrentYear: boolean;
  currentMonth: number;
}) {
  if (!active || !payload || !payload.length || !payload[0].payload) {
    return null;
  }
  const pt = payload[0].payload;
  const total = series.reduce(
    (sum, s) => sum + (typeof pt[s.key] === "number" ? Number(pt[s.key]) : 0),
    0,
  );
  const isCurrent = isCurrentYear && pt.month === currentMonth;
  return (
    <div className="sim-tooltip">
      <div className="sim-tooltip-title">
        {pt.ym || pt.label}
        {isCurrent ? <span className="sim-tooltip-tag">CURRENT</span> : null}
      </div>
      {!pt.hasData ? (
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
                <span>{typeof val === "number" ? `${val.toFixed(1)} kWh` : "--"}</span>
              </div>
            );
          })}
          <div className="sim-tooltip-row summary-tooltip-total">
            <span className="sim-tooltip-label">TOTAL:</span>
            <span>{total.toFixed(1)} kWh</span>
          </div>
        </>
      )}
    </div>
  );
}

function MonthlyStackedBarBlock({
  title,
  ariaLabel,
  data,
  series,
  isCurrentYear,
  currentMonth,
}: {
  title: string;
  ariaLabel: string;
  data: MonthlyChartPoint[];
  series: SeriesConfig[];
  isCurrentYear: boolean;
  currentMonth: number;
}) {
  const currentLabel = isCurrentYear
    ? MONTH_LABELS[(currentMonth ?? 1) - 1] ?? ""
    : "";
  const hasCurrent =
    Boolean(currentLabel) && data.some((d) => d.label === currentLabel);

  const isTopNonZero = (pt: MonthlyChartPoint | undefined, key: SeriesConfig["key"]) => {
    if (!pt) return false;
    for (let i = series.length - 1; i >= 0; i--) {
      const k = series[i].key;
      const v = pt[k];
      if (typeof v === "number" && v > 0) return k === key;
    }
    return false;
  };

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
                style={{
                  backgroundColor: s.fill,
                  border: `1px solid ${s.color}`,
                }}
              />
              <span style={{ color: s.color }}>{s.label}</span>
            </span>
          ))}
        </div>

        <ResponsiveContainer width="100%" height={182}>
          <BarChart
            data={data}
            margin={{ top: 20, right: 8, left: -10, bottom: 2 }}
          >
            <CartesianGrid stroke="#383942" strokeDasharray="3 3" vertical={false} />
            {hasCurrent ? (
              <ReferenceArea
                x1={currentLabel}
                x2={currentLabel}
                fill="#fbdd84"
                fillOpacity={0.08}
                stroke="none"
              />
            ) : null}
            <XAxis
              dataKey="label"
              interval={0}
              tick={(tickProps: {
                x?: number | string;
                y?: number | string;
                payload?: { value?: string };
              }) => {
                const tx = Number(tickProps.x ?? 0);
                const ty = Number(tickProps.y ?? 0);
                const val = String(tickProps.payload?.value ?? "");
                const isCur = Boolean(currentLabel) && val === currentLabel;
                return (
                  <text
                    x={tx}
                    y={ty + 9}
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
                <PvMonthlyTooltip
                  series={series}
                  isCurrentYear={isCurrentYear}
                  currentMonth={currentMonth}
                />
              }
            />
            {series.map((s) => (
              <Bar
                key={s.key}
                name={s.label}
                dataKey={s.key}
                stackId="monthly"
                fill={s.fill}
                maxBarSize={24}
                isAnimationActive={false}
                shape={(rawProps: unknown) => {
                  const p = (rawProps ?? {}) as {
                    x?: number;
                    y?: number;
                    width?: number;
                    height?: number;
                    payload?: MonthlyChartPoint;
                  };
                  const x = Number(p.x ?? 0);
                  const y = Number(p.y ?? 0);
                  const w = Number(p.width ?? 0);
                  const h = Number(p.height ?? 0);
                  if (w <= 0 || h <= 0) return <g />;
                  const roundTop = isTopNonZero(p.payload, s.key);
                  const pathD = topRoundedSegmentPath(x, y, w, h, roundTop, 4);
                  return (
                    <path
                      d={pathD}
                      fill={s.fill}
                      stroke={s.color}
                      strokeWidth={1.15}
                    />
                  );
                }}
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
  selectedYear,
  currentYear,
  currentMonth,
}: {
  records: PvMonthlyRecord[];
  selectedYear: number;
  currentYear: number;
  currentMonth: number;
}) {
  const isCurrentYear = selectedYear === currentYear;
  const data = React.useMemo(
    () => buildMonthlyPoints(records, selectedYear),
    [records, selectedYear],
  );

  return (
    <div className="summary-subpage pv-charts-subpage">
      <MonthlyStackedBarBlock
        title="MONTHLY BY PV"
        ariaLabel="Monthly Stacked Generation by PV String"
        data={data}
        series={PV_SERIES}
        isCurrentYear={isCurrentYear}
        currentMonth={currentMonth}
      />
      <MonthlyStackedBarBlock
        title="MONTHLY BY DIRECTION"
        ariaLabel="Monthly Stacked Generation by Roof Direction"
        data={data}
        series={DIR_SERIES}
        isCurrentYear={isCurrentYear}
        currentMonth={currentMonth}
      />
    </div>
  );
}

let pvChartsRoot: Root | null = null;

export function mountOrUpdatePvCharts(
  records: PvMonthlyRecord[],
  selectedYear: number,
  currentYear: number,
  currentMonth: number,
): void {
  const container = document.getElementById("pv-charts-root");
  if (!container) return;
  if (!pvChartsRoot) {
    pvChartsRoot = createRoot(container);
  }
  pvChartsRoot.render(
    <PvChartsView
      records={records}
      selectedYear={selectedYear}
      currentYear={currentYear}
      currentMonth={currentMonth}
    />,
  );
}
