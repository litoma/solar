import React from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface DailyBalanceInput {
  solarToday: number;
  buyToday: number;
  useToday: number;
  sellToday: number;
  batteryChgKwh: number;
  batteryDischgKwh: number;
}

export interface MonthlyTotalPoint {
  ym: string;
  label: string;
  hasData: boolean;
  solar: number | null;
  use: number | null;
  buy: number | null;
  sell: number | null;
  loss: number | null;
}

export interface MonthlyTotalsData {
  months: MonthlyTotalPoint[];
}

// 1ページ目と配色を統一
const COLOR_SOLAR = "#d7bd72";
const COLOR_SOLAR_TEXT = "#fbdd84";
const COLOR_BUY = "#de92bc";
const COLOR_BUY_TEXT = "#ffaee0";
const COLOR_USE = "#4bc77c";
const COLOR_USE_TEXT = "#57f293";
const COLOR_SELL = "#74aede";
const COLOR_SELL_TEXT = "#88cdff";
const COLOR_BATTERY = "#9b8ec7";
const COLOR_BATTERY_TEXT = "#d5cbf9";
const COLOR_LOSS = "#6e7382";
const COLOR_LOSS_TEXT = "#b4b9c7";

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

const QUARTER_STEPS = [
  0.01, 0.02, 0.03, 0.05, 0.08, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6,
  0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10,
];

function computeBalanceYAxis(totalBalance: number): {
  maxY: number;
  ticks: number[];
} {
  if (!Number.isFinite(totalBalance) || totalBalance <= 0) {
    return { maxY: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
  }
  const target = totalBalance * 1.18;
  let step = QUARTER_STEPS.find((q) => q * 4 >= target);
  if (step === undefined) {
    const exp = Math.floor(Math.log10(target / 4));
    const scale = Math.pow(10, exp);
    const bases = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    const picked = bases.find((b) => b * scale * 4 >= target) ?? 10;
    step = picked * scale;
  }
  const roundTick = (v: number) => Number(v.toFixed(2));
  const ticks = [0, 1, 2, 3, 4].map((i) => roundTick(step * i));
  return { maxY: ticks[4], ticks };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

type BalanceKey =
  | "solar"
  | "buy"
  | "battIn"
  | "adjIn"
  | "use"
  | "sell"
  | "battOut"
  | "lossOut";

interface BalanceRow {
  side: string;
  solar: number;
  buy: number;
  battIn: number;
  adjIn: number;
  use: number;
  sell: number;
  battOut: number;
  lossOut: number;
}

interface LabelProps {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  value?: string | number | boolean | null;
  index?: number;
  viewBox?: unknown;
}

interface BalanceTooltipProps {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number;
    color?: string;
    payload?: BalanceRow;
  }>;
  totalBalance: number;
}

function CustomBalanceTooltip({
  active,
  payload,
  totalBalance,
}: BalanceTooltipProps) {
  if (!active || !payload || !payload.length) return null;
  const sideLabel = payload[0]?.payload?.side || "";
  const nonZero = payload.filter((p) => typeof p.value === "number" && p.value > 0);
  return (
    <div className="sim-tooltip">
      <div className="sim-tooltip-title">{sideLabel}</div>
      {nonZero.length === 0 ? (
        <div className="sim-tooltip-row">
          <span className="sim-tooltip-label">データなし</span>
          <span>0.00 kWh</span>
        </div>
      ) : (
        nonZero.map((entry) => {
          const val = entry.value ?? 0;
          const pct = totalBalance > 0 ? Math.round((val / totalBalance) * 100) : 0;
          return (
            <div key={String(entry.name)} className="sim-tooltip-row">
              <span className="sim-tooltip-label" style={{ color: entry.color }}>
                {entry.name}:
              </span>
              <span>
                {val.toFixed(2)} kWh ({pct}%)
              </span>
            </div>
          );
        })
      )}
      <div className="sim-tooltip-row summary-tooltip-total">
        <span className="sim-tooltip-label">TOTAL:</span>
        <span>{totalBalance.toFixed(2)} kWh</span>
      </div>
    </div>
  );
}

interface MonthlyTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload?: MonthlyTotalPoint;
  }>;
}

function CustomMonthlyTooltip({ active, payload }: MonthlyTooltipProps) {
  if (!active || !payload || !payload.length || !payload[0].payload) return null;
  const pt = payload[0].payload;
  const fmt = (v: number | null) => (v !== null ? `${v.toFixed(1)} kWh` : "--");
  return (
    <div className="sim-tooltip">
      <div className="sim-tooltip-title">{pt.ym || pt.label}</div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label" style={{ color: COLOR_SOLAR_TEXT }}>
          SOLAR:
        </span>
        <span>{fmt(pt.solar)}</span>
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label" style={{ color: COLOR_USE_TEXT }}>
          USE:
        </span>
        <span>{fmt(pt.use)}</span>
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label" style={{ color: COLOR_BUY_TEXT }}>
          BUY:
        </span>
        <span>{fmt(pt.buy)}</span>
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label" style={{ color: COLOR_SELL_TEXT }}>
          SELL:
        </span>
        <span>{fmt(pt.sell)}</span>
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label" style={{ color: COLOR_LOSS_TEXT }}>
          LOSS:
        </span>
        <span>{fmt(pt.loss)}</span>
      </div>
    </div>
  );
}

function SummaryCombinedView({
  balance,
  monthly,
  currentMonth,
}: {
  balance: DailyBalanceInput;
  monthly: MonthlyTotalsData;
  currentMonth: number;
}) {
  // 1. 当日 INPUT / OUTPUT バランスデータ
  const solar = Math.max(0, round2(balance.solarToday));
  const buy = Math.max(0, round2(balance.buyToday));
  const use = Math.max(0, round2(balance.useToday));
  const sell = Math.max(0, round2(balance.sellToday));
  const battIn =
    typeof balance.batteryDischgKwh === "number" && Number.isFinite(balance.batteryDischgKwh)
      ? Math.max(0, round2(balance.batteryDischgKwh))
      : 0;
  const battOut =
    typeof balance.batteryChgKwh === "number" && Number.isFinite(balance.batteryChgKwh)
      ? Math.max(0, round2(balance.batteryChgKwh))
      : 0;

  const rawIn = round2(solar + buy + battIn);
  const rawOut = round2(use + sell + battOut);
  const totalBalance = Math.max(rawIn, rawOut);
  const adjIn = rawOut > rawIn + 0.005 ? round2(rawOut - rawIn) : 0;
  const lossOut = rawIn > rawOut + 0.005 ? round2(rawIn - rawOut) : 0;

  const chartData: BalanceRow[] = [
    {
      side: "INPUT",
      solar,
      buy,
      battIn,
      adjIn,
      use: 0,
      sell: 0,
      battOut: 0,
      lossOut: 0,
    },
    {
      side: "OUTPUT",
      solar: 0,
      buy: 0,
      battIn: 0,
      adjIn: 0,
      use,
      sell,
      battOut,
      lossOut,
    },
  ];

  const yAxisScale = computeBalanceYAxis(totalBalance);

  const inStackOrder: BalanceKey[] = ["solar", "battIn", "buy", "adjIn"];
  const outStackOrder: BalanceKey[] = ["use", "battOut", "sell", "lossOut"];
  const findTopKey = (row: BalanceRow, order: BalanceKey[]): BalanceKey | null => {
    for (let i = order.length - 1; i >= 0; i--) {
      if (row[order[i]] > 0) return order[i];
    }
    return null;
  };
  const topInKey = findTopKey(chartData[0], inStackOrder);
  const topOutKey = findTopKey(chartData[1], outStackOrder);
  const inTotalStr = `${round2(rawIn + adjIn).toFixed(2)} kWh`;
  const outTotalStr = `${round2(rawOut + lossOut).toFixed(2)} kWh`;

  const renderBarLabel =
    (
      side: "INPUT" | "OUTPUT",
      seriesKey: BalanceKey,
      shortName: string,
      compactName: string,
      isDarkBg: boolean,
    ) =>
    (props: LabelProps) => {
      const vb =
        typeof props.viewBox === "object" && props.viewBox !== null
          ? (props.viewBox as {
              x?: number | string;
              y?: number | string;
              width?: number | string;
              height?: number | string;
            })
          : undefined;
      const x = Number(vb?.x ?? props.x ?? 0);
      const y = Number(vb?.y ?? props.y ?? 0);
      const w = Number(vb?.width ?? props.width ?? 0);
      const h = Number(vb?.height ?? props.height ?? 0);
      const val = Number(props.value ?? 0);
      if (!Number.isFinite(val) || val <= 0 || w <= 0) return null;

      // Recharts は値が0の行を rects から除外するため props.index ではなく系列の INPUT/OUTPUT で判定する
      const isTop =
        (side === "INPUT" && topInKey === seriesKey) ||
        (side === "OUTPUT" && topOutKey === seriesKey);
      const cx = x + w / 2;
      const cy = y + h / 2;
      const fill = isDarkBg ? "#eef0f6" : "#14161a";
      const topStr = side === "INPUT" ? inTotalStr : outTotalStr;

      return (
        <g>
          {isTop ? (
            <text
              x={cx}
              y={y - 7}
              textAnchor="middle"
              fill="#e4e6ee"
              fontSize={11.5}
              fontWeight={600}
              fontFamily="JetBrains Mono, monospace"
            >
              {topStr}
            </text>
          ) : null}
          {h >= 24 ? (
            <text
              x={cx}
              y={cy - 2}
              textAnchor="middle"
              fill={fill}
              fontSize={10.5}
              fontWeight={600}
              fontFamily="JetBrains Mono, monospace"
            >
              <tspan x={cx}>{w >= 54 ? shortName : compactName}</tspan>
              <tspan x={cx} dy={12}>
                {val.toFixed(2)}
              </tspan>
            </text>
          ) : h >= 13 ? (
            <text
              x={cx}
              y={cy + 3.5}
              textAnchor="middle"
              fill={fill}
              fontSize={10}
              fontWeight={600}
              fontFamily="JetBrains Mono, monospace"
            >
              {`${w >= 76 ? shortName : compactName} ${val.toFixed(2)}`}
            </text>
          ) : null}
        </g>
      );
    };

  // 2. 直近1年間 (365日) 月別総量データ (SOLAR, USE, BUY, SELL, LOSS)
  const points = monthly.months || [];
  const currentLabel = MONTH_LABELS[(currentMonth ?? 1) - 1] ?? "";
  const hasCurrentMonthPoint =
    Boolean(currentLabel) && points.some((p) => p.label === currentLabel);

  const monthlyLegendItems = [
    { label: "SOLAR", color: COLOR_SOLAR_TEXT },
    { label: "USE", color: COLOR_USE_TEXT },
    { label: "BUY", color: COLOR_BUY },
    { label: "SELL", color: COLOR_SELL_TEXT },
    { label: "LOSS", color: COLOR_LOSS_TEXT },
  ];

  return (
    <div className="summary-subpage">
      {/* 上段グラフ: 本日の INPUT / OUTPUT */}
      <section className="summary-graph-block" aria-label="Daily Input Output">
        <div className="summary-subpage-head">
          <span className="summary-subpage-title">DAILY INPUT/OUTPUT (kWh)</span>
        </div>

        <div className="sim-chart-box summary-chart-box">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={chartData}
              margin={{ top: 24, right: 8, left: -14, bottom: 2 }}
              barCategoryGap="8%"
            >
              <CartesianGrid stroke="#383942" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="side"
                padding={{ left: 8, right: 8 }}
                tick={{
                  fill: "#d4d6e0",
                  fontSize: 12,
                  fontFamily: "JetBrains Mono, monospace",
                }}
                axisLine={{ stroke: "#484a54" }}
                tickLine={false}
              />
              <YAxis
                domain={[0, yAxisScale.maxY]}
                ticks={yAxisScale.ticks}
                width={44}
                tick={{
                  fill: "#9a9ea6",
                  fontSize: 11,
                  fontFamily: "JetBrains Mono, monospace",
                }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: "rgba(255, 255, 255, 0.04)" }}
                content={<CustomBalanceTooltip totalBalance={totalBalance} />}
              />
              <Bar dataKey="solar" name="SOLAR" stackId="bal" fill={COLOR_SOLAR} maxBarSize={200} isAnimationActive={false}>
                <LabelList dataKey="solar" content={renderBarLabel("INPUT", "solar", "SOLAR", "SOLAR", false)} />
              </Bar>
              <Bar dataKey="battIn" name="BATTERY (放電)" stackId="bal" fill={COLOR_BATTERY} maxBarSize={200} isAnimationActive={false}>
                <LabelList dataKey="battIn" content={renderBarLabel("INPUT", "battIn", "BATTERY", "BATT", false)} />
              </Bar>
              <Bar dataKey="buy" name="BUY" stackId="bal" fill={COLOR_BUY} maxBarSize={200} isAnimationActive={false}>
                <LabelList dataKey="buy" content={renderBarLabel("INPUT", "buy", "BUY", "BUY", false)} />
              </Bar>
              <Bar dataKey="adjIn" name="OTHER" stackId="bal" fill={COLOR_LOSS} maxBarSize={200} isAnimationActive={false}>
                <LabelList dataKey="adjIn" content={renderBarLabel("INPUT", "adjIn", "OTHER", "OTHER", true)} />
              </Bar>
              <Bar dataKey="use" name="USE" stackId="bal" fill={COLOR_USE} maxBarSize={200} isAnimationActive={false}>
                <LabelList dataKey="use" content={renderBarLabel("OUTPUT", "use", "USE", "USE", false)} />
              </Bar>
              <Bar dataKey="battOut" name="BATTERY (蓄電)" stackId="bal" fill={COLOR_BATTERY} maxBarSize={200} isAnimationActive={false}>
                <LabelList dataKey="battOut" content={renderBarLabel("OUTPUT", "battOut", "BATTERY", "BATT", false)} />
              </Bar>
              <Bar dataKey="sell" name="SELL" stackId="bal" fill={COLOR_SELL} maxBarSize={200} isAnimationActive={false}>
                <LabelList dataKey="sell" content={renderBarLabel("OUTPUT", "sell", "SELL", "SELL", false)} />
              </Bar>
              <Bar dataKey="lossOut" name="LOSS" stackId="bal" fill={COLOR_LOSS} maxBarSize={200} isAnimationActive={false}>
                <LabelList dataKey="lossOut" content={renderBarLabel("OUTPUT", "lossOut", "LOSS", "LOSS", true)} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* 下段グラフ: 直近1年間(365日)の月別総量面グラフ */}
      <section className="summary-graph-block" aria-label="Last 365 Days Monthly Total">
        <div className="summary-subpage-head">
          <span className="summary-subpage-title">LAST 365D MONTHLY TOTAL (kWh)</span>
        </div>

        <div className="sim-chart-box summary-chart-box">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart
              data={points}
              margin={{ top: 8, right: 16, left: -14, bottom: 2 }}
            >
              <defs>
                <linearGradient id="grad-summary-solar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLOR_SOLAR_TEXT} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={COLOR_SOLAR_TEXT} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="grad-summary-use" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLOR_USE_TEXT} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={COLOR_USE_TEXT} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="grad-summary-buy" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLOR_BUY} stopOpacity={0.26} />
                  <stop offset="95%" stopColor={COLOR_BUY} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="grad-summary-sell" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLOR_SELL_TEXT} stopOpacity={0.24} />
                  <stop offset="95%" stopColor={COLOR_SELL_TEXT} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="grad-summary-loss" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLOR_LOSS_TEXT} stopOpacity={0.20} />
                  <stop offset="95%" stopColor={COLOR_LOSS_TEXT} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#383942" strokeDasharray="3 3" vertical={false} />
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
                  const isCurrent = val === currentLabel;
                  return (
                    <text
                      x={tx}
                      y={ty + 9}
                      textAnchor="middle"
                      fill={isCurrent ? COLOR_SOLAR_TEXT : "#b8bbc6"}
                      fontSize={10.5}
                      fontWeight={isCurrent ? 700 : 400}
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {val}
                    </text>
                  );
                }}
                axisLine={{ stroke: "#484a54" }}
                tickLine={false}
              />
              {hasCurrentMonthPoint ? (
                <ReferenceLine
                  x={currentLabel}
                  stroke={COLOR_SOLAR_TEXT}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  strokeOpacity={0.75}
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
              />
              <Tooltip content={<CustomMonthlyTooltip />} />
              <Legend
                verticalAlign="top"
                content={() => (
                  <div className="summary-chart-legend">
                    {monthlyLegendItems.map((it) => (
                      <span key={it.label} className="summary-legend-item">
                        <span
                          className="summary-legend-line"
                          style={{ backgroundColor: it.color }}
                        />
                        <span style={{ color: it.color }}>{it.label}</span>
                      </span>
                    ))}
                  </div>
                )}
              />
              <Area
                type="monotone"
                name="SOLAR"
                dataKey="solar"
                stroke={COLOR_SOLAR_TEXT}
                strokeWidth={2.2}
                fill="url(#grad-summary-solar)"
                dot={false}
                activeDot={{ r: 5 }}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                name="USE"
                dataKey="use"
                stroke={COLOR_USE_TEXT}
                strokeWidth={2.2}
                fill="url(#grad-summary-use)"
                dot={false}
                activeDot={{ r: 5 }}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                name="BUY"
                dataKey="buy"
                stroke={COLOR_BUY}
                strokeWidth={2.2}
                fill="url(#grad-summary-buy)"
                dot={false}
                activeDot={{ r: 5 }}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                name="SELL"
                dataKey="sell"
                stroke={COLOR_SELL_TEXT}
                strokeWidth={2.2}
                fill="url(#grad-summary-sell)"
                dot={false}
                activeDot={{ r: 5 }}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                name="LOSS"
                dataKey="loss"
                stroke={COLOR_LOSS_TEXT}
                strokeWidth={2}
                strokeDasharray="4 3"
                fill="url(#grad-summary-loss)"
                dot={false}
                activeDot={{ r: 5 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}

let summaryRoot: Root | null = null;

export function mountOrUpdateSummaryCharts(
  balance: DailyBalanceInput,
  monthly: MonthlyTotalsData,
  currentMonth: number,
): void {
  const container = document.getElementById("summary-charts-root");
  if (!container) return;
  if (!summaryRoot) {
    summaryRoot = createRoot(container);
  }
  summaryRoot.render(
    <SummaryCombinedView
      balance={balance}
      monthly={monthly}
      currentMonth={currentMonth}
    />,
  );
}
