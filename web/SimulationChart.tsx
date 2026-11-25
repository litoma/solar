import React from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface MonthlySimItem {
  month: number;
  label: string;
  shortLabel: string;
  estimatedKwh: number;
  actualKwh: number;
  barMaxKwh: number;
  pct: number;
}

// カナディアンソーラー太陽光発電シミュレーション (東京都練馬区 / 15枚 6.065kW / PCS-JP2-6G)
const BASE_SIMULATION: Array<{ month: number; label: string; estimatedKwh: number }> = [
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

export const ANNUAL_TOTAL_KWH = 6348;

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
        <span className="sim-tooltip-actual">{Math.round(item.actualKwh)} kWh</span>
      </div>
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
  const act = Math.max(0, item.actualKwh);
  const maxVal = Math.max(item.barMaxKwh, est, act, 1);
  const baseY = y + height;
  const estH = (est / maxVal) * height;
  const actH = (act / maxVal) * height;
  const estY = baseY - estH;
  const actY = baseY - actH;

  const estPath = topRoundedBarPath(x, estY, width, estH, 4);
  const actPath = topRoundedBarPath(x, actY, width, actH, 4);
  const clipId = `sim-est-clip-${item.month}`;

  // 実績 <= 推定: 推定を背面枠にし、下から実績を塗りつぶす
  if (act <= est) {
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
            fill="rgba(215, 189, 114, 0.28)"
            stroke="#d7bd72"
            strokeWidth={1.15}
          />
        ) : null}
        {actPath ? (
          <path
            d={actPath}
            fill="#57f293"
            stroke="#4bc77c"
            strokeWidth={1}
            clipPath={estPath ? `url(#${clipId})` : undefined}
          />
        ) : null}
      </g>
    );
  }

  // 実績 > 推定: 前面・背面を逆転し、実績を背面・推定を前面にして両方を視認可能にする
  return (
    <g>
      {actPath ? (
        <path
          d={actPath}
          fill="#57f293"
          stroke="#4bc77c"
          strokeWidth={1.15}
        />
      ) : null}
      {estPath ? (
        <path
          d={estPath}
          fill="rgba(52, 46, 29, 0.72)"
          stroke="#fbdd84"
          strokeWidth={1.45}
        />
      ) : null}
    </g>
  );
}

function SimulationChartView({
  selectedYear,
  currentYear,
  currentMonth,
  monthlyActualKwh,
}: {
  selectedYear: number;
  currentYear: number;
  currentMonth: number;
  monthlyActualKwh: Record<number, number>;
}) {
  const isCurrentYear = selectedYear === currentYear;
  const data: MonthlySimItem[] = BASE_SIMULATION.map((b) => {
    const actualRaw = Math.max(0, monthlyActualKwh[b.month] ?? 0);
    const actualRounded = Math.round(actualRaw);
    const pct = b.estimatedKwh > 0 ? (actualRaw / b.estimatedKwh) * 100 : 0;
    return {
      month: b.month,
      label: b.label,
      shortLabel: b.label,
      estimatedKwh: b.estimatedKwh,
      actualKwh: actualRounded,
      barMaxKwh: Math.max(b.estimatedKwh, actualRounded),
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
        </div>
      </div>

      {/* 中段: 月別発電量グラフ (1本重ね棒 + 上部タイトル + 中央凡例) */}
      <section className="summary-graph-block" aria-label="Monthly Generation">
        <div className="summary-subpage-head">
          <span className="summary-subpage-title">MONTHLY GENERATION</span>
        </div>

        <div className="sim-chart-box">
          <div className="summary-chart-legend sim-chart-legend" aria-label="Generation Legend">
            <span className="summary-legend-item">
              <span className="sim-legend-swatch sim-legend-swatch-actual" />
              <span style={{ color: "#57f293" }}>ACTUAL</span>
            </span>
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
              <XAxis
                dataKey="shortLabel"
                interval={0}
                tick={{
                  fill: "#b8bbc6",
                  fontSize: 10.5,
                  fontFamily: "JetBrains Mono, monospace",
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
              <span className="sim-month-pct">{m.pct.toFixed(1)}%</span>
            </div>
          );
        })}
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
    />,
  );
}
