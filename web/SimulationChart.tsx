import React from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface MonthlySimItem {
  month: number;
  label: string;
  shortLabel: string;
  kwh: number;
}

// カナディアンソーラー太陽光発電シミュレーション (東京都練馬区 / 15枚 6.065kW / PCS-JP2-6G)
export const MONTHLY_SIMULATION_DATA: MonthlySimItem[] = [
  { month: 1, label: "1月", shortLabel: "1月", kwh: 400 },
  { month: 2, label: "2月", shortLabel: "2月", kwh: 410 },
  { month: 3, label: "3月", shortLabel: "3月", kwh: 569 },
  { month: 4, label: "4月", shortLabel: "4月", kwh: 640 },
  { month: 5, label: "5月", shortLabel: "5月", kwh: 785 },
  { month: 6, label: "6月", shortLabel: "6月", kwh: 630 },
  { month: 7, label: "7月", shortLabel: "7月", kwh: 702 },
  { month: 8, label: "8月", shortLabel: "8月", kwh: 655 },
  { month: 9, label: "9月", shortLabel: "9月", kwh: 489 },
  { month: 10, label: "10月", shortLabel: "10月", kwh: 407 },
  { month: 11, label: "11月", shortLabel: "11月", kwh: 328 },
  { month: 12, label: "12月", shortLabel: "12月", kwh: 333 },
];

export const ANNUAL_TOTAL_KWH = 6348;

interface TooltipPayloadItem {
  payload?: MonthlySimItem;
  value?: number;
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
        {item.label} 推定発電量
        {isCurrent ? <span className="sim-tooltip-tag">今月</span> : null}
      </div>
      <div className="sim-tooltip-val">
        {item.kwh.toLocaleString("ja-JP")} <span>kWh</span>
      </div>
      <div className="sim-tooltip-sub">
        1日平均 約 {(item.kwh / 30).toFixed(1)} kWh/d
      </div>
    </div>
  );
}

function SimulationChartView({ currentMonth }: { currentMonth: number }) {
  return (
    <div className="sim-container">
      <div className="sim-chart-box">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart
            data={MONTHLY_SIMULATION_DATA}
            margin={{ top: 22, right: 8, left: -16, bottom: 4 }}
          >
            <defs>
              <linearGradient id="simBarGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#e8cd7d" stopOpacity={0.92} />
                <stop offset="100%" stopColor="#8d783d" stopOpacity={0.78} />
              </linearGradient>
              <linearGradient id="simBarActiveGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffe89e" stopOpacity={1} />
                <stop offset="100%" stopColor="#d7bd72" stopOpacity={0.95} />
              </linearGradient>
            </defs>
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
            <Bar
              dataKey="kwh"
              radius={[6, 6, 0, 0]}
              maxBarSize={32}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="kwh"
                position="top"
                fill="#d6d2c4"
                fontSize={10.5}
                fontFamily="JetBrains Mono, monospace"
              />
              {MONTHLY_SIMULATION_DATA.map((entry) => {
                const isCurrent = entry.month === currentMonth;
                return (
                  <Cell
                    key={`cell-${entry.month}`}
                    fill={
                      isCurrent
                        ? "url(#simBarActiveGrad)"
                        : "url(#simBarGrad)"
                    }
                    stroke={isCurrent ? "#fbdd84" : "transparent"}
                    strokeWidth={isCurrent ? 1.2 : 0}
                  />
                );
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 月間発電量テーブル (1月〜12月 + 年間環境貢献指標) */}
      <div className="sim-months-grid">
        {MONTHLY_SIMULATION_DATA.map((m) => {
          const isCurrent = m.month === currentMonth;
          return (
            <div
              key={m.month}
              className={`sim-month-cell${isCurrent ? " is-current" : ""}`}
            >
              <span className="sim-month-name">{m.label}</span>
              <span className="sim-month-val">{m.kwh}</span>
            </div>
          );
        })}
      </div>

      <div className="sim-impact-row">
        <div className="sim-impact-chip">
          <span className="sim-impact-key">年間推定発電量</span>
          <span className="sim-impact-val">
            {ANNUAL_TOTAL_KWH.toLocaleString("ja-JP")} kWh
          </span>
        </div>
        <div className="sim-impact-chip">
          <span className="sim-impact-key">CO₂削減量</span>
          <span className="sim-impact-val">
            約 2,491 kg-CO₂ <small>(スギ約178本)</small>
          </span>
        </div>
        <div className="sim-impact-chip">
          <span className="sim-impact-key">原油換算削減量</span>
          <span className="sim-impact-val">
            約 1,409 L <small>(18L缶約78本)</small>
          </span>
        </div>
      </div>
    </div>
  );
}

let chartRoot: Root | null = null;

export function mountOrUpdateSimulationChart(currentMonth: number): void {
  const container = document.getElementById("sim-chart-root");
  if (!container) return;
  if (!chartRoot) {
    chartRoot = createRoot(container);
  }
  chartRoot.render(<SimulationChartView currentMonth={currentMonth} />);
}
