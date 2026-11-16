import React from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ANNUAL_TOTAL_KWH } from "./SimulationChart";

// 月別の推定発電量 (kWh)
const MONTHLY_EST_KWH: Record<number, number> = {
  1: 400,
  2: 410,
  3: 569,
  4: 640,
  5: 785,
  6: 630,
  7: 702,
  8: 655,
  9: 489,
  10: 407,
  11: 328,
  12: 333,
};

const DAYS_IN_MONTH: Record<number, number> = {
  1: 31,
  2: 28,
  3: 31,
  4: 30,
  5: 31,
  6: 30,
  7: 31,
  8: 31,
  9: 30,
  10: 31,
  11: 30,
  12: 31,
};

export interface PaybackData {
  targetYen: number;
  initialCostYen: number;
  subsidyYen: number;
  totalSolarKwh: number;
  totalSellKwh: number;
  totalBenefitYen: number;
  activeDays: number;
  firstDate: string | null;
  byYearMonth: Record<
    string,
    { solarKwh: number; sellKwh: number; benefitYen: number; days: number }
  >;
}

interface YearlyMilestonePoint {
  yearIndex: number;
  label: string;
  subLabel: string;
  plannedCumMan: number; // 万円単位 (グラフ描画用)
  actualCumMan: number | null; // 万円単位 (現在までの実績)
  projectedCumMan: number; // 万円単位 (現在の実績ペースでの予測)
  plannedCumYen: number;
  actualCumYen: number | null;
  projectedCumYen: number;
  remainingPlanYen: number;
  pctOfTarget: number;
  isBreakEvenYear: boolean;
}

interface TooltipPayloadItem {
  payload?: YearlyMilestonePoint;
}

function formatManYen(yen: number): string {
  const man = yen / 10000;
  return `${man.toFixed(1)}万円`;
}

function CustomPaybackTooltip({
  active,
  payload,
  targetYen,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  targetYen: number;
}) {
  if (!active || !payload || !payload.length || !payload[0].payload) {
    return null;
  }
  const p = payload[0].payload;
  return (
    <div className="sim-tooltip">
      <div className="sim-tooltip-title">
        {p.label} ({p.subLabel})
        {p.isBreakEvenYear ? (
          <span className="sim-tooltip-tag">ペイ達成年</span>
        ) : null}
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label">計画累計回収:</span>
        <span className="sim-tooltip-est">
          ¥{p.plannedCumYen.toLocaleString("ja-JP")} ({p.pctOfTarget.toFixed(0)}%)
        </span>
      </div>
      {p.actualCumYen !== null ? (
        <div className="sim-tooltip-row">
          <span className="sim-tooltip-label">実績累計回収:</span>
          <span className="sim-tooltip-actual">
            ¥{p.actualCumYen.toLocaleString("ja-JP")}
          </span>
        </div>
      ) : null}
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label">実績ペース予測:</span>
        <span className="sim-tooltip-pct">
          ¥{p.projectedCumYen.toLocaleString("ja-JP")}
        </span>
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label">計画ベース残額:</span>
        <span className="sim-tooltip-est">
          {p.plannedCumYen >= targetYen
            ? `+¥${(p.plannedCumYen - targetYen).toLocaleString("ja-JP")} (黒字)`
            : `残り ¥${p.remainingPlanYen.toLocaleString("ja-JP")}`}
        </span>
      </div>
    </div>
  );
}

function PaybackChartView({
  payback,
  buyPriceYenPerKwh,
  currentYear,
  currentMonth,
}: {
  payback: PaybackData;
  buyPriceYenPerKwh: number;
  currentYear: number;
  currentMonth: number;
}) {
  const targetYen = payback.targetYen || 1100000;
  const initialCostYen = payback.initialCostYen || 3500000;
  const subsidyYen = payback.subsidyYen || 2400000;

  // 導入開始年月 (DBの最古日付、なければ現在の年月)
  let startYear = currentYear;
  let startMonth = currentMonth;
  if (payback.firstDate && /^\d{4}-\d{2}/.test(payback.firstDate)) {
    startYear = Number(payback.firstDate.slice(0, 4)) || currentYear;
    startMonth = Number(payback.firstDate.slice(5, 7)) || currentMonth;
  }

  // 年間計画メリット額 (円/年): 13.3kWh蓄電池併用により発電分を自家消費(買電単価換算)として試算
  const annualPlannedBenefitYen = Math.round(
    ANNUAL_TOTAL_KWH * buyPriceYenPerKwh,
  );
  const monthlyAvgPlannedYen = Math.round(annualPlannedBenefitYen / 12);

  // 月次ステップで計画回収期間 (何年何ヶ月で targetYen に到達するか) を精密計算
  let cumPlanYen = 0;
  let paybackMonthsCount = 0;
  let breakEvenYear = startYear;
  let breakEvenMonth = startMonth;
  for (let step = 0; step < 360; step++) {
    const m = ((startMonth - 1 + step) % 12) + 1;
    const y = startYear + Math.floor((startMonth - 1 + step) / 12);
    const monthEstYen = (MONTHLY_EST_KWH[m] ?? 500) * buyPriceYenPerKwh;
    cumPlanYen += monthEstYen;
    paybackMonthsCount = step + 1;
    if (cumPlanYen >= targetYen) {
      breakEvenYear = y;
      breakEvenMonth = m;
      break;
    }
  }
  const planYearsPart = Math.floor(paybackMonthsCount / 12);
  const planMonthsPart = paybackMonthsCount % 12;

  // 実績ペース比 (記録がある日の実績回収額 ÷ 同月の計画日割り回収額)
  let expectedYenForActiveDays = 0;
  for (const [ym, stat] of Object.entries(payback.byYearMonth || {})) {
    const m = Number(ym.slice(5, 7)) || currentMonth;
    const estMonthYen = (MONTHLY_EST_KWH[m] ?? 500) * buyPriceYenPerKwh;
    const daysInM = DAYS_IN_MONTH[m] ?? 30;
    expectedYenForActiveDays += (estMonthYen / daysInM) * stat.days;
  }
  const rawPaceRatio =
    expectedYenForActiveDays > 100
      ? payback.totalBenefitYen / expectedYenForActiveDays
      : 1.0;
  // 極端な外れ値を防ぐため 0.3〜2.0 の範囲にクランプ
  const paceRatio = Math.max(0.3, Math.min(2.0, rawPaceRatio));

  // グラフの年数レンジ (ペイ達成年の+2年後まで、最低7年間)
  const breakEvenYearIndex = Math.ceil(paybackMonthsCount / 12);
  const maxYears = Math.max(7, breakEvenYearIndex + 2);

  const points: YearlyMilestonePoint[] = [];
  let runningPlanYen = 0;

  // 0年目 (現在 / 導入開始時点〜現在までの実績)
  points.push({
    yearIndex: 0,
    label: "現在",
    subLabel: `${startYear}/${String(startMonth).padStart(2, "0")}`,
    plannedCumMan: 0,
    actualCumMan: Math.round((payback.totalBenefitYen / 10000) * 100) / 100,
    projectedCumMan: Math.round((payback.totalBenefitYen / 10000) * 100) / 100,
    plannedCumYen: 0,
    actualCumYen: payback.totalBenefitYen,
    projectedCumYen: payback.totalBenefitYen,
    remainingPlanYen: targetYen,
    pctOfTarget: (payback.totalBenefitYen / targetYen) * 100,
    isBreakEvenYear: false,
  });

  for (let yr = 1; yr <= maxYears; yr++) {
    runningPlanYen += annualPlannedBenefitYen;
    const projectedYen = Math.round(
      payback.totalBenefitYen + annualPlannedBenefitYen * paceRatio * yr,
    );
    const calYear = startYear + yr;
    points.push({
      yearIndex: yr,
      label: `${yr}年目`,
      subLabel: `${calYear}年`,
      plannedCumMan: Math.round((runningPlanYen / 10000) * 10) / 10,
      actualCumMan: null,
      projectedCumMan: Math.round((projectedYen / 10000) * 10) / 10,
      plannedCumYen: runningPlanYen,
      actualCumYen: null,
      projectedCumYen: projectedYen,
      remainingPlanYen: Math.max(0, targetYen - runningPlanYen),
      pctOfTarget: (runningPlanYen / targetYen) * 100,
      isBreakEvenYear: yr === breakEvenYearIndex,
    });
  }

  const targetMan = Math.round((targetYen / 10000) * 10) / 10;
  const maxYMan = Math.ceil(
    Math.max(
      targetMan * 1.25,
      points[points.length - 1]?.plannedCumMan || 150,
      points[points.length - 1]?.projectedCumMan || 150,
    ) / 20,
  ) * 20;

  const actualPct = Math.min(100, (payback.totalBenefitYen / targetYen) * 100);
  const remainingActualYen = Math.max(0, targetYen - payback.totalBenefitYen);
  const avgDailyBenefitYen =
    payback.activeDays > 0
      ? Math.round(payback.totalBenefitYen / payback.activeDays)
      : 0;

  return (
    <div className="sim-container">
      {/* 上段: 3つのKPIサマリカード (実質自己負担額 / 計画ペイ期間 / 現在の回収実績) */}
      <div className="payback-kpi-grid">
        {/* 1. 実質回収目標 (110万円) */}
        <div className="sim-summary-card">
          <div className="sim-summary-head">
            <span className="sim-summary-title">実質自己負担 (回収目標)</span>
            <span className="ef-outline-badge payback-badge-gold">
              補助金控除後
            </span>
          </div>
          <div className="sim-summary-val">
            ¥{targetYen.toLocaleString("ja-JP")}
          </div>
          <div className="payback-kpi-sub">
            総額 {(initialCostYen / 10000).toFixed(0)}万円 − 補助金{" "}
            {(subsidyYen / 10000).toFixed(0)}万円
          </div>
        </div>

        {/* 2. 計画ペイ期間 */}
        <div className="sim-summary-card">
          <div className="sim-summary-head">
            <span className="sim-summary-title">計画ペイ期間 (試算)</span>
            <span className="ef-outline-badge sim-pct-badge">
              {breakEvenYear}年{breakEvenMonth}月 達成予定
            </span>
          </div>
          <div className="sim-summary-val">
            約 {planYearsPart}年 {planMonthsPart}ヶ月
          </div>
          <div className="payback-kpi-sub">
            想定 ¥{annualPlannedBenefitYen.toLocaleString("ja-JP")}/年 (月平均 ¥
            {monthlyAvgPlannedYen.toLocaleString("ja-JP")})
          </div>
        </div>

        {/* 3. 現在の回収実績 & 残額 */}
        <div className="sim-summary-card">
          <div className="sim-summary-head">
            <span className="sim-summary-title">累計回収実績 / 残額</span>
            <span className="ef-outline-badge sim-pct-badge">
              進捗 {actualPct.toFixed(2)}%
            </span>
          </div>
          <div className="sim-summary-val">
            ¥{payback.totalBenefitYen.toLocaleString("ja-JP")}
            <span className="sim-summary-sep">/</span>
            <span className="sim-summary-target">
              残 ¥{remainingActualYen.toLocaleString("ja-JP")}
            </span>
          </div>
          <div className="payback-kpi-sub">
            稼働 {payback.activeDays}日 · 累計 {payback.totalSolarKwh.toFixed(1)}{" "}
            kWh (平均 ¥{avgDailyBenefitYen.toLocaleString("ja-JP")}/日)
          </div>
        </div>
      </div>

      {/* 回収進捗バー */}
      <div className="payback-bar-wrap">
        <div className="payback-bar-track">
          <div
            className="payback-bar-fill"
            style={{ width: `${Math.max(actualPct, payback.totalBenefitYen > 0 ? 1.2 : 0)}%` }}
          />
          <span className="payback-bar-label">
            回収済 ¥{payback.totalBenefitYen.toLocaleString("ja-JP")} / 目標 ¥
            {targetYen.toLocaleString("ja-JP")} ({actualPct.toFixed(2)}%)
          </span>
        </div>
      </div>

      {/* 中段: 累計投資回収グラフ (計画累計 vs 実績 & 実績ペース予測 + 110万円目標ライン) */}
      <div className="sim-chart-box">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart
            data={points}
            margin={{ top: 18, right: 14, left: -8, bottom: 2 }}
            barGap={4}
          >
            <CartesianGrid
              stroke="#383942"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{
                fill: "#b8bbc6",
                fontSize: 11.5,
                fontFamily: "JetBrains Mono, monospace",
              }}
              axisLine={{ stroke: "#484a54" }}
              tickLine={false}
            />
            <YAxis
              domain={[0, maxYMan]}
              unit="万"
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
              content={<CustomPaybackTooltip targetYen={targetYen} />}
            />
            <Legend
              verticalAlign="top"
              height={30}
              wrapperStyle={{
                fontFamily: "JetBrains Mono, monospace",
                fontSize: "12px",
                color: "#d6d2c4",
              }}
            />
            <ReferenceLine
              y={targetMan}
              stroke="#fbdd84"
              strokeWidth={1.8}
              strokeDasharray="5 4"
              label={{
                value: `回収目標 ${targetMan.toFixed(0)}万円`,
                position: "insideTopLeft",
                fill: "#fbdd84",
                fontSize: 11.5,
                fontFamily: "JetBrains Mono, monospace",
              }}
            />
            <Bar
              name="計画累計回収 (万円)"
              dataKey="plannedCumMan"
              fill="rgba(215, 189, 114, 0.35)"
              stroke="#d7bd72"
              strokeWidth={1}
              radius={[4, 4, 0, 0]}
              maxBarSize={26}
              isAnimationActive={false}
            />
            <Bar
              name="実績累計回収 (万円)"
              dataKey="actualCumMan"
              fill="#57f293"
              stroke="#4bc77c"
              strokeWidth={1}
              radius={[4, 4, 0, 0]}
              maxBarSize={26}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              name="実績ペース予測 (万円)"
              dataKey="projectedCumMan"
              stroke="#d5cbf9"
              strokeWidth={2.2}
              strokeDasharray="4 4"
              dot={{ r: 3.5, fill: "#d5cbf9", stroke: "#161618", strokeWidth: 1.5 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* 下段: 年次マイルストーン一覧 (現在〜7年目) */}
      <div className="payback-milestones-grid">
        {points.map((pt) => {
          const isReached = pt.plannedCumYen >= targetYen;
          return (
            <div
              key={pt.yearIndex}
              className={`sim-month-cell${pt.isBreakEvenYear ? " is-current" : ""}`}
            >
              <span className="sim-month-name">
                {pt.label} <small>({pt.subLabel})</small>
              </span>
              <span className="sim-month-val">
                {pt.yearIndex === 0
                  ? `¥${(pt.actualCumYen ?? 0).toLocaleString("ja-JP")}`
                  : formatManYen(pt.plannedCumYen)}
              </span>
              <span className="sim-month-pct">
                {pt.yearIndex === 0
                  ? `実績 ${pt.pctOfTarget.toFixed(2)}%`
                  : isReached
                    ? `達成 (${pt.pctOfTarget.toFixed(0)}%)`
                    : `残 ${formatManYen(pt.remainingPlanYen)}`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

let paybackRoot: Root | null = null;

export function mountOrUpdatePaybackChart(
  payback: PaybackData,
  buyPriceYenPerKwh: number,
  currentYear: number,
  currentMonth: number,
): void {
  const container = document.getElementById("payback-chart-root");
  if (!container) return;
  if (!paybackRoot) {
    paybackRoot = createRoot(container);
  }
  paybackRoot.render(
    <PaybackChartView
      payback={payback}
      buyPriceYenPerKwh={buyPriceYenPerKwh}
      currentYear={currentYear}
      currentMonth={currentMonth}
    />,
  );
}
