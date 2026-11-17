import React from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
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

export interface SellPriceTier {
  startYear: number;
  endYear: number | null;
  priceYenPerKwh: number;
}

export interface PaybackData {
  targetYen: number;
  initialCostYen: number;
  subsidyYen: number;
  sellPriceSchedule?: SellPriceTier[];
  startYm?: string;
  selfConsumeRatio?: number;
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

// 実績ペース予測は実績累計回収(鮮やかな緑 #57f293)と同系色つつ、明確に見分けられる落ち着いたダークティール＋破線枠
const PROJECTED_COLOR = "#3ca882";
const PROJECTED_FILL = "rgba(46, 132, 104, 0.28)";
const PROJECTED_TEXT_COLOR = "#5ec49f";

const DEFAULT_TIERS: SellPriceTier[] = [
  { startYear: 1, endYear: 4, priceYenPerKwh: 24 },
  { startYear: 5, endYear: 10, priceYenPerKwh: 8.3 },
  { startYear: 11, endYear: null, priceYenPerKwh: 8.5 },
];

function getSellPriceForYear(tiers: SellPriceTier[], yr: number): number {
  const list = tiers && tiers.length > 0 ? tiers : DEFAULT_TIERS;
  for (const t of list) {
    if (yr >= t.startYear && (t.endYear === null || yr <= t.endYear)) {
      return t.priceYenPerKwh;
    }
  }
  return list[list.length - 1]?.priceYenPerKwh ?? 8.5;
}

function formatTierLabel(t: SellPriceTier): string {
  const range =
    t.endYear === null
      ? `${t.startYear}年目〜`
      : t.startYear === t.endYear
        ? `${t.startYear}年目`
        : `${t.startYear}〜${t.endYear}年目`;
  return `${range}: ¥${t.priceYenPerKwh}/kWh`;
}

interface YearlyMilestonePoint {
  yearIndex: number;
  label: string;
  subLabel: string;
  sellPriceYen: number;
  annualPlanYen: number;
  plannedCumMan: number; // 万円単位 (グラフ描画用)
  actualCumMan: number; // 万円単位 (現在までの実績: 積み上げ棒の下段)
  projectedDeltaMan: number; // 万円単位 (予測の積み増し分: 積み上げ棒の上段)
  projectedCumMan: number; // 万円単位 (現在の実績ペースでの予測合計)
  plannedCumYen: number;
  actualCumYen: number;
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
        {p.label}年 ({p.subLabel})
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
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label">実績累計回収:</span>
        <span className="sim-tooltip-actual">
          ¥{p.actualCumYen.toLocaleString("ja-JP")}
        </span>
      </div>
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
  const [page, setPage] = React.useState(0);
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const targetYen = payback.targetYen || 1100000;
  const initialCostYen = payback.initialCostYen || 3500000;
  const subsidyYen = payback.subsidyYen || 2400000;
  const tiers =
    payback.sellPriceSchedule && payback.sellPriceSchedule.length > 0
      ? payback.sellPriceSchedule
      : DEFAULT_TIERS;
  const selfRatio =
    typeof payback.selfConsumeRatio === "number"
      ? Math.max(0.05, Math.min(1.0, payback.selfConsumeRatio))
      : 0.65;
  const exportRatio = 1 - selfRatio;

  // 導入開始年月 (SOLAR_START_YM > DB最古日付 > 現在年月)
  let startYear = currentYear;
  let startMonth = currentMonth;
  const ymSrc = payback.startYm || payback.firstDate || "";
  if (/^\d{4}-\d{2}/.test(ymSrc)) {
    startYear = Number(ymSrc.slice(0, 4)) || currentYear;
    startMonth = Number(ymSrc.slice(5, 7)) || currentMonth;
  }

  // 指定した運転年数(1年目, 2年目, ...)における1kWhあたりの期待メリット単価 (自家消費×買電単価 + 売電×年数別売電単価)
  const unitValueForYear = (opYear: number): number => {
    const sellPrice = getSellPriceForYear(tiers, opYear);
    return selfRatio * buyPriceYenPerKwh + exportRatio * sellPrice;
  };

  const annualBenefitForYear = (opYear: number): number =>
    Math.round(ANNUAL_TOTAL_KWH * unitValueForYear(opYear));

  // 月次ステップで計画回収期間 (年数別売電単価を適用して何年何ヶ月で targetYen に到達するか) を精密計算
  let cumPlanYen = 0;
  let paybackMonthsCount = 0;
  let breakEvenYear = startYear;
  let breakEvenMonth = startMonth;
  for (let step = 0; step < 360; step++) {
    const opYear = Math.floor(step / 12) + 1;
    const m = ((startMonth - 1 + step) % 12) + 1;
    const y = startYear + Math.floor((startMonth - 1 + step) / 12);
    const monthEstYen = (MONTHLY_EST_KWH[m] ?? 500) * unitValueForYear(opYear);
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
    const y = Number(ym.slice(0, 4)) || startYear;
    const m = Number(ym.slice(5, 7)) || currentMonth;
    const diffM = Math.max(0, (y - startYear) * 12 + (m - startMonth));
    const opYear = Math.floor(diffM / 12) + 1;
    const estMonthYen = (MONTHLY_EST_KWH[m] ?? 500) * unitValueForYear(opYear);
    const daysInM = DAYS_IN_MONTH[m] ?? 30;
    expectedYenForActiveDays += (estMonthYen / daysInM) * stat.days;
  }
  const rawPaceRatio =
    expectedYenForActiveDays > 100
      ? payback.totalBenefitYen / expectedYenForActiveDays
      : 1.0;
  const paceRatio = Math.max(0.3, Math.min(2.0, rawPaceRatio));

  // グラフの年数レンジ (ペイ達成年の+2年後まで、最低8年間表示して5年目以降の単価変化も可視化)
  const breakEvenYearIndex = Math.ceil(paybackMonthsCount / 12);
  const maxYears = Math.max(8, breakEvenYearIndex + 2);

  const points: YearlyMilestonePoint[] = [];
  let runningPlanYen = 0;
  let runningProjectedYen = payback.totalBenefitYen;

  const actualManFixed =
    Math.round((payback.totalBenefitYen / 10000) * 100) / 100;

  // 0年目 (開始年・現在: 例 2026)
  points.push({
    yearIndex: 0,
    label: String(startYear),
    subLabel: `現在 ${startYear}/${String(startMonth).padStart(2, "0")}`,
    sellPriceYen: getSellPriceForYear(tiers, 1),
    annualPlanYen: annualBenefitForYear(1),
    plannedCumMan: 0,
    actualCumMan: actualManFixed,
    projectedDeltaMan: 0,
    projectedCumMan: actualManFixed,
    plannedCumYen: 0,
    actualCumYen: payback.totalBenefitYen,
    projectedCumYen: payback.totalBenefitYen,
    remainingPlanYen: targetYen,
    pctOfTarget: (payback.totalBenefitYen / targetYen) * 100,
    isBreakEvenYear: false,
  });

  for (let yr = 1; yr <= maxYears; yr++) {
    const yrPlanYen = annualBenefitForYear(yr);
    const yrSellPrice = getSellPriceForYear(tiers, yr);
    runningPlanYen += yrPlanYen;
    runningProjectedYen += Math.round(yrPlanYen * paceRatio);
    const calYear = startYear + yr;
    const projectedMan = Math.round((runningProjectedYen / 10000) * 10) / 10;
    const deltaMan = Math.max(
      0,
      Math.round((projectedMan - actualManFixed) * 100) / 100,
    );
    points.push({
      yearIndex: yr,
      label: String(calYear),
      subLabel: `${yr}年目`,
      sellPriceYen: yrSellPrice,
      annualPlanYen: yrPlanYen,
      plannedCumMan: Math.round((runningPlanYen / 10000) * 10) / 10,
      actualCumMan: actualManFixed,
      projectedDeltaMan: deltaMan,
      projectedCumMan: projectedMan,
      plannedCumYen: runningPlanYen,
      actualCumYen: payback.totalBenefitYen,
      projectedCumYen: runningProjectedYen,
      remainingPlanYen: Math.max(0, targetYen - runningPlanYen),
      pctOfTarget: (runningPlanYen / targetYen) * 100,
      isBreakEvenYear: yr === breakEvenYearIndex,
    });
  }

  const targetMan = Math.round((targetYen / 10000) * 10) / 10;
  const maxYMan =
    Math.ceil(
      Math.max(
        targetMan * 1.22,
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

  const yr1to4Benefit = annualBenefitForYear(1);
  const yr5to10Benefit = annualBenefitForYear(5);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    if (idx !== page) setPage(idx);
  };
  const goPage = (idx: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" });
    setPage(idx);
  };

  return (
    <div className="sim-container">
      <div className="payback-pager" ref={scrollerRef} onScroll={onScroll}>
        {/* 1ページ目: 進捗バー + 累計投資回収グラフ + 年次マイルストーン */}
        <div className="payback-page">
          <div className="payback-bar-wrap">
            <div className="payback-bar-track">
              <div
                className="payback-bar-fill"
                style={{
                  width: `${Math.max(actualPct, payback.totalBenefitYen > 0 ? 1.2 : 0)}%`,
                }}
              />
              <span className="payback-bar-label">
                回収済 ¥{payback.totalBenefitYen.toLocaleString("ja-JP")} / 目標 ¥
                {targetYen.toLocaleString("ja-JP")} ({actualPct.toFixed(2)}%)
              </span>
            </div>
          </div>

          <div className="sim-chart-box">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart
                data={points}
                margin={{ top: 18, right: 14, left: -8, bottom: 2 }}
                barGap={3}
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
                  cursor={{ fill: "rgba(87, 242, 147, 0.07)" }}
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
                  maxBarSize={18}
                  isAnimationActive={false}
                />
                <Bar
                  name="実績累計回収 (万円)"
                  dataKey="actualCumMan"
                  stackId="actual"
                  fill="#57f293"
                  stroke="#4bc77c"
                  strokeWidth={1}
                  radius={[0, 0, 0, 0]}
                  maxBarSize={18}
                  isAnimationActive={false}
                />
                <Bar
                  name="実績ペース予測 (万円)"
                  dataKey="projectedDeltaMan"
                  stackId="actual"
                  fill={PROJECTED_FILL}
                  stroke={PROJECTED_COLOR}
                  strokeWidth={1}
                  strokeDasharray="3 2"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={18}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="payback-milestones-grid">
            {points.map((pt) => (
              <div
                key={pt.yearIndex}
                className={`sim-month-cell${pt.isBreakEvenYear ? " is-current" : ""}`}
              >
                <span className="sim-month-name">{pt.label}</span>
                <span className="sim-month-val">
                  {pt.yearIndex === 0
                    ? `¥${pt.actualCumYen.toLocaleString("ja-JP")}`
                    : formatManYen(pt.plannedCumYen)}
                </span>
                <span
                  className="sim-month-pct"
                  style={{ color: PROJECTED_TEXT_COLOR }}
                >
                  {pt.pctOfTarget.toFixed(pt.yearIndex === 0 ? 2 : 0)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 2ページ目: 回収目標 / 計画ペイ期間 / 累計実績 / 売電単価設定 */}
        <div className="payback-page">
          <div className="payback-kpi-grid">
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
                1〜4年目 ¥{yr1to4Benefit.toLocaleString("ja-JP")}/年 · 5年目〜 ¥
                {yr5to10Benefit.toLocaleString("ja-JP")}/年
              </div>
            </div>

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
                稼働 {payback.activeDays}日 · 累計{" "}
                {payback.totalSolarKwh.toFixed(1)} kWh (平均 ¥
                {avgDailyBenefitYen.toLocaleString("ja-JP")}/日)
              </div>
            </div>
          </div>

          <div className="payback-tiers-bar">
            <span className="payback-tiers-label">売電単価設定 (FIT/卒FIT):</span>
            <div className="payback-tiers-chips">
              {tiers.map((t, i) => (
                <span key={i} className="ef-outline-badge payback-tier-chip">
                  {formatTierLabel(t)}
                </span>
              ))}
              <span className="payback-tiers-note">
                (買電 ¥{buyPriceYenPerKwh}/kWh · 想定自家消費{" "}
                {Math.round(selfRatio * 100)}% / 売電 {Math.round(exportRatio * 100)}%)
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="payback-dots" role="tablist" aria-label="Payback pages">
        {[0, 1].map((i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={page === i}
            aria-label={`ページ ${i + 1}`}
            className={`payback-dot${page === i ? " is-active" : ""}`}
            onClick={() => goPage(i)}
          />
        ))}
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
