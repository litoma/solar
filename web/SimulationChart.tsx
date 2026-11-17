import React from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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
  currentMonth,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  currentMonth: number;
}) {
  if (!active || !payload || !payload.length || !payload[0].payload) {
    return null;
  }
  const item = payload[0].payload;
  const isCurrent = item.month === currentMonth;
  return (
    <div className="sim-tooltip">
      <div className="sim-tooltip-title">
        {item.label}
        {isCurrent ? <span className="sim-tooltip-tag">今月</span> : null}
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label">実績発電量:</span>
        <span className="sim-tooltip-actual">{Math.round(item.actualKwh)} kWh</span>
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label">推定発電量:</span>
        <span className="sim-tooltip-est">{item.estimatedKwh} kWh</span>
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label">達成率 (実績/推定):</span>
        <span className="sim-tooltip-pct">{item.pct.toFixed(1)}%</span>
      </div>
    </div>
  );
}

function SimulationChartView({
  currentMonth,
  monthlyActualKwh,
}: {
  currentMonth: number;
  monthlyActualKwh: Record<number, number>;
}) {
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
      pct,
    };
  });

  const totalActualRaw = Object.values(monthlyActualKwh).reduce(
    (acc, v) => acc + Math.max(0, v ?? 0),
    0,
  );
  const totalActualKwh = Math.round(totalActualRaw);
  const totalPct = (totalActualRaw / ANNUAL_TOTAL_KWH) * 100;

  const currentItem =
    data.find((d) => d.month === currentMonth) || data[10];

  return (
    <div className="sim-container">
      {/* 上段: 今月と年間の 実績 / 推定 & パーセンテージ サマリ */}
      <div className="sim-summary-grid">
        <div className="sim-summary-card">
          <div className="sim-summary-head">
            <span className="sim-summary-title">
              今月 ({currentItem.label}) 実績 / 推定
            </span>
            <span className="ef-outline-badge sim-pct-badge">
              {currentItem.pct.toFixed(1)}%
            </span>
          </div>
          <div className="sim-summary-val">
            {currentItem.actualKwh.toLocaleString("ja-JP")}
            <span className="sim-summary-sep">/</span>
            <span className="sim-summary-target">
              {currentItem.estimatedKwh} kWh
            </span>
          </div>
        </div>

        <div className="sim-summary-card">
          <div className="sim-summary-head">
            <span className="sim-summary-title">
              年間トータル 実績 / 推定
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

      {/* 中段: 推定発電量と現時点までのトータル実績発電量を同一グラフに描写 (Recharts) */}
      <div className="sim-chart-box">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart
            data={data}
            margin={{ top: 14, right: 8, left: -16, bottom: 2 }}
            barGap={2}
          >
            <CartesianGrid
              stroke="#383942"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="shortLabel"
              tick={{
                fill: "#b8bbc6",
                fontSize: 11.5,
                fontFamily: "JetBrains Mono, monospace",
              }}
              axisLine={{ stroke: "#484a54" }}
              tickLine={false}
            />
            <YAxis
              domain={[0, 900]}
              ticks={[0, 100, 200, 300, 400, 500, 600, 700, 800, 900]}
              tick={{
                fill: "#9a9ea6",
                fontSize: 11,
                fontFamily: "JetBrains Mono, monospace",
              }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: "rgba(251, 221, 132, 0.08)" }}
              content={<CustomTooltip currentMonth={currentMonth} />}
            />
            <Legend
              verticalAlign="top"
              height={28}
              wrapperStyle={{
                fontFamily: "JetBrains Mono, monospace",
                fontSize: "12px",
                color: "#d6d2c4",
              }}
            />
            <Bar
              name="推定発電量 (kWh)"
              dataKey="estimatedKwh"
              fill="rgba(215, 189, 114, 0.35)"
              stroke="#d7bd72"
              strokeWidth={1}
              radius={[4, 4, 0, 0]}
              maxBarSize={20}
              isAnimationActive={false}
            />
            <Bar
              name="実績発電量 (kWh)"
              dataKey="actualKwh"
              fill="#57f293"
              stroke="#4bc77c"
              strokeWidth={1}
              radius={[4, 4, 0, 0]}
              maxBarSize={20}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 下段: 1月〜12月の 実績/推定 & 達成率(%) 一覧 */}
      <div className="sim-months-grid">
        {data.map((m) => {
          const isCurrent = m.month === currentMonth;
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
      currentMonth={currentMonth}
      monthlyActualKwh={monthlyActualKwh}
    />,
  );
}
