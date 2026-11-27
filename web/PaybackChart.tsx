import React from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  DEFAULT_BUY_TARIFF,
  calcMonthlySelfBenefitYen,
  type BuyTariffConfig,
} from "./tariff";

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
  buyTariff?: BuyTariffConfig;
  startYm?: string;
  sellStartDate?: string;
  selfConsumeRatio?: number;
  totalSolarKwh: number;
  totalSellKwh: number;
  totalBuyKwh?: number;
  totalSelfKwh?: number;
  totalBenefitYen: number;
  activeDays: number;
  firstDate: string | null;
  byYearMonth: Record<
    string,
    {
      solarKwh: number;
      sellKwh: number;
      buyKwh?: number;
      selfKwh?: number;
      benefitYen: number;
      days: number;
    }
  >;
}

const DEFAULT_TIERS: SellPriceTier[] = [
  { startYear: 1, endYear: 4, priceYenPerKwh: 24 },
  { startYear: 5, endYear: 10, priceYenPerKwh: 8.3 },
  { startYear: 11, endYear: null, priceYenPerKwh: 8.5 },
];

// 実績ペース予測は旧計画累計回収と同じ黄色 (凡例文字は MONTHLY GENERATION の ESTIMATED と同じ #fbdd84)
const FORECAST_FILL = "rgba(215, 189, 114, 0.35)";
const FORECAST_STROKE = "#d7bd72";
const FORECAST_TEXT = "#fbdd84";

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
  actualCumMan: number; // 万円単位 (現在までの実績: 積み上げ棒の下段)
  projectedDeltaMan: number; // 万円単位 (予測の積み増し分: 積み上げ棒の上段)
  projectedCumMan: number; // 万円単位 (現在の実績ペースでの予測合計)
  actualCumYen: number;
  projectedCumYen: number;
  remainingProjYen: number;
  pctOfTarget: number;
  isBreakEvenYear: boolean;
}

interface TooltipPayloadItem {
  payload?: YearlyMilestonePoint;
}

function formatCompactYen(yen: number): string {
  if (yen >= 1_000_000) {
    const m = (yen / 1_000_000)
      .toFixed(2)
      .replace(/\.00$/, "")
      .replace(/(\.\d)0$/, "$1");
    return `¥${m}M`;
  }
  if (yen >= 1_000) {
    return `¥${Math.round(yen / 1_000)}k`;
  }
  return `¥${Math.round(yen)}`;
}

function segmentBarPath(
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
          <span className="sim-tooltip-tag">ペイ達成予測</span>
        ) : null}
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label">回収実績:</span>
        <span className="sim-tooltip-actual">
          ¥{p.actualCumYen.toLocaleString("ja-JP")}
        </span>
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label">回収計画:</span>
        <span className="sim-tooltip-pct">
          ¥{p.projectedCumYen.toLocaleString("ja-JP")} ({p.pctOfTarget.toFixed(0)}%)
        </span>
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label">目標まで残額:</span>
        <span className="sim-tooltip-est">
          {p.projectedCumYen >= targetYen
            ? `+¥${(p.projectedCumYen - targetYen).toLocaleString("ja-JP")} (黒字)`
            : `残り ¥${p.remainingProjYen.toLocaleString("ja-JP")}`}
        </span>
      </div>
    </div>
  );
}

function PaybackChartView({
  payback,
  buyTariff,
  currentYear,
  currentMonth,
}: {
  payback: PaybackData;
  buyTariff: BuyTariffConfig;
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

  // 売電開始年月 (初期値 2027-04-01 → 2027-04)
  const sellStartDate = payback.sellStartDate || "2027-04-01";
  let sellStartYear = 2027;
  let sellStartMonth = 4;
  if (/^\d{4}-\d{2}/.test(sellStartDate)) {
    sellStartYear = Number(sellStartDate.slice(0, 4)) || 2027;
    sellStartMonth = Number(sellStartDate.slice(5, 7)) || 4;
  }
  const sellStartTotalMonths = sellStartYear * 12 + (sellStartMonth - 1);

  const sellPriceForCalendarYm = (calYear: number, calMonth: number): number => {
    const curTotalMonths = calYear * 12 + (calMonth - 1);
    if (curTotalMonths < sellStartTotalMonths) {
      return 0;
    }
    const fitOpYear = Math.floor((curTotalMonths - sellStartTotalMonths) / 12) + 1;
    return getSellPriceForYear(tiers, fitOpYear);
  };

  // 実測日平均買電量から想定ベース買電量を算出 (待機電力等により月〜35-40kWh程度発生する前提)
  const observedDailyBuyKwh =
    payback.activeDays > 0 && typeof payback.totalBuyKwh === "number" && payback.totalBuyKwh > 0
      ? Math.max(0.4, Math.min(8.0, payback.totalBuyKwh / payback.activeDays))
      : 1.2;

  // 指定した年月 (カレンダー基準) の1ヶ月分の想定回収メリット (3段階料金差額 + 売電)
  const plannedMonthBenefitYen = (calYear: number, calMonth: number): number => {
    const estGen = MONTHLY_EST_KWH[calMonth] ?? 500;
    const estSelf = estGen * selfRatio;
    const estSell = estGen * exportRatio;
    const estBuy = observedDailyBuyKwh * (DAYS_IN_MONTH[calMonth] ?? 30);
    const selfSaving = calcMonthlySelfBenefitYen(estBuy, estSelf, buyTariff);
    const sellRev = estSell * sellPriceForCalendarYm(calYear, calMonth);
    return selfSaving + sellRev;
  };

  // FIT年数基準での年間想定メリット (2ページ目 KPI表示用)
  const annualBenefitForFitYear = (fitYear: number): number => {
    const sellPrice = getSellPriceForYear(tiers, fitYear);
    let annualYen = 0;
    for (let m = 1; m <= 12; m++) {
      const estGen = MONTHLY_EST_KWH[m] ?? 500;
      const estSelf = estGen * selfRatio;
      const estSell = estGen * exportRatio;
      const estBuy = observedDailyBuyKwh * (DAYS_IN_MONTH[m] ?? 30);
      annualYen +=
        calcMonthlySelfBenefitYen(estBuy, estSelf, buyTariff) +
        estSell * sellPrice;
    }
    return Math.round(annualYen);
  };

  // 月次ステップで計画回収期間 (2ページ目参考表示) を計算
  let cumPlanYen = 0;
  let paybackMonthsCount = 0;
  let planBreakEvenYear = startYear;
  let planBreakEvenMonth = startMonth;
  for (let step = 0; step < 360; step++) {
    const absM = startYear * 12 + (startMonth - 1) + step;
    const y = Math.floor(absM / 12);
    const m = (absM % 12) + 1;
    cumPlanYen += plannedMonthBenefitYen(y, m);
    paybackMonthsCount = step + 1;
    if (cumPlanYen >= targetYen) {
      planBreakEvenYear = y;
      planBreakEvenMonth = m;
      break;
    }
  }
  const planYearsPart = Math.floor(paybackMonthsCount / 12);
  const planMonthsPart = paybackMonthsCount % 12;

  // 実績ペース比 (記録がある日の実績回収額 ÷ 同月の段階別計画日割り回収額)
  let expectedYenForActiveDays = 0;
  for (const [ym, stat] of Object.entries(payback.byYearMonth || {})) {
    const y = Number(ym.slice(0, 4)) || startYear;
    const m = Number(ym.slice(5, 7)) || currentMonth;
    const estMonthYen = plannedMonthBenefitYen(y, m);
    const daysInM = DAYS_IN_MONTH[m] ?? 30;
    expectedYenForActiveDays += (estMonthYen / daysInM) * stat.days;
  }
  const rawPaceRatio =
    expectedYenForActiveDays > 100
      ? payback.totalBenefitYen / expectedYenForActiveDays
      : 1.0;
  const paceRatio = Math.max(0.3, Math.min(2.0, rawPaceRatio));

  // 実績ペース予測で目標額を達成する暦年を算出
  let simProjYen = payback.totalBenefitYen;
  let projBreakEvenYear = planBreakEvenYear;
  for (let yr = 1; yr <= 25; yr++) {
    let yrPlanYen = 0;
    for (let k = 0; k < 12; k++) {
      const absM = startYear * 12 + (startMonth - 1) + (yr - 1) * 12 + k;
      yrPlanYen += plannedMonthBenefitYen(Math.floor(absM / 12), (absM % 12) + 1);
    }
    simProjYen += Math.round(yrPlanYen * paceRatio);
    if (simProjYen >= targetYen) {
      projBreakEvenYear = startYear + yr;
      break;
    }
  }

  // グラフ表示範囲は実績ペース予測での達成翌年まで
  const maxYears = Math.max(1, Math.min(15, projBreakEvenYear + 1 - startYear));

  const points: YearlyMilestonePoint[] = [];
  let runningProjectedYen = payback.totalBenefitYen;

  const actualManFixed =
    Math.round((payback.totalBenefitYen / 10000) * 100) / 100;

  // 0年目 (開始年・現在: 例 2026)
  points.push({
    yearIndex: 0,
    label: String(startYear),
    subLabel: `現在 ${startYear}/${String(startMonth).padStart(2, "0")}`,
    sellPriceYen: sellPriceForCalendarYm(startYear, startMonth),
    annualPlanYen: annualBenefitForFitYear(1),
    actualCumMan: actualManFixed,
    projectedDeltaMan: 0,
    projectedCumMan: actualManFixed,
    actualCumYen: payback.totalBenefitYen,
    projectedCumYen: payback.totalBenefitYen,
    remainingProjYen: Math.max(0, targetYen - payback.totalBenefitYen),
    pctOfTarget: (payback.totalBenefitYen / targetYen) * 100,
    isBreakEvenYear: false,
  });

  for (let yr = 1; yr <= maxYears; yr++) {
    let yrPlanYen = 0;
    for (let k = 0; k < 12; k++) {
      const absM = startYear * 12 + (startMonth - 1) + (yr - 1) * 12 + k;
      const y = Math.floor(absM / 12);
      const m = (absM % 12) + 1;
      yrPlanYen += plannedMonthBenefitYen(y, m);
    }
    yrPlanYen = Math.round(yrPlanYen);
    const calYear = startYear + yr;
    const yrSellPrice = sellPriceForCalendarYm(calYear, startMonth);
    runningProjectedYen += Math.round(yrPlanYen * paceRatio);
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
      actualCumMan: actualManFixed,
      projectedDeltaMan: deltaMan,
      projectedCumMan: projectedMan,
      actualCumYen: payback.totalBenefitYen,
      projectedCumYen: runningProjectedYen,
      remainingProjYen: Math.max(0, targetYen - runningProjectedYen),
      pctOfTarget: (runningProjectedYen / targetYen) * 100,
      isBreakEvenYear: calYear === projBreakEvenYear,
    });
  }

  const targetMan = Math.round((targetYen / 10000) * 10) / 10;
  const maxYMan =
    Math.ceil(
      Math.max(
        targetMan * 1.22,
        points[points.length - 1]?.projectedCumMan || 150,
      ) / 20,
    ) * 20;

  const actualPct = Math.min(100, (payback.totalBenefitYen / targetYen) * 100);
  const remainingActualYen = Math.max(0, targetYen - payback.totalBenefitYen);
  const avgDailyBenefitYen =
    payback.activeDays > 0
      ? Math.round(payback.totalBenefitYen / payback.activeDays)
      : 0;

  const yr1to4Benefit = annualBenefitForFitYear(1);
  const yr5to10Benefit = annualBenefitForFitYear(5);

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

  const currentYearLabel = String(currentYear);
  const hasCurrentYear = points.some((pt) => pt.label === currentYearLabel);

  return (
    <div className="sim-container">
      <div className="payback-pager" ref={scrollerRef} onScroll={onScroll}>
        {/* 1ページ目: 進捗バー + 回収実績/回収計画グラフ + 年次マイルストーン */}
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
            <div className="summary-chart-legend sim-chart-legend" aria-label="Payback Legend">
              <span className="summary-legend-item">
                <span className="sim-legend-swatch sim-legend-swatch-actual" />
                <span style={{ color: "#57f293" }}>回収実績</span>
              </span>
              <span className="summary-legend-item">
                <span className="sim-legend-swatch sim-legend-swatch-est" />
                <span style={{ color: FORECAST_TEXT }}>回収計画</span>
              </span>
            </div>

            <ResponsiveContainer width="100%" height={252}>
              <ComposedChart
                data={points}
                margin={{ top: 14, right: 14, left: -8, bottom: 2 }}
              >
                <CartesianGrid
                  stroke="#383942"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                {hasCurrentYear ? (
                  <ReferenceArea
                    x1={currentYearLabel}
                    x2={currentYearLabel}
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
                    const isCur = val === currentYearLabel;
                    return (
                      <text
                        x={tx}
                        y={ty + 11}
                        textAnchor="middle"
                        fill={isCur ? "#fbdd84" : "#b8bbc6"}
                        fontSize={11.5}
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
                  domain={[0, maxYMan]}
                  width={52}
                  tickFormatter={(v: number) => formatCompactYen(v * 10000)}
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
                <ReferenceLine
                  y={targetMan}
                  stroke="#fbdd84"
                  strokeWidth={1.8}
                  strokeDasharray="5 4"
                  label={{
                    value: `回収目標 ${formatCompactYen(targetYen)}`,
                    position: "insideTopLeft",
                    fill: "#fbdd84",
                    fontSize: 11.5,
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                />
                <Bar
                  name="回収実績"
                  dataKey="actualCumMan"
                  stackId="actual"
                  fill="#57f293"
                  maxBarSize={24}
                  isAnimationActive={false}
                  shape={(rawProps: unknown) => {
                    const p = (rawProps ?? {}) as {
                      x?: number;
                      y?: number;
                      width?: number;
                      height?: number;
                      payload?: YearlyMilestonePoint;
                    };
                    const x = Number(p.x ?? 0);
                    const y = Number(p.y ?? 0);
                    const w = Number(p.width ?? 0);
                    const h = Number(p.height ?? 0);
                    if (w <= 0 || h <= 0) return <g />;
                    const hasTop = (p.payload?.projectedDeltaMan ?? 0) > 0;
                    const pathD = segmentBarPath(x, y, w, h, !hasTop, 4);
                    return (
                      <path
                        d={pathD}
                        fill="#57f293"
                        stroke="#4bc77c"
                        strokeWidth={1}
                      />
                    );
                  }}
                />
                <Bar
                  name="回収計画"
                  dataKey="projectedDeltaMan"
                  stackId="actual"
                  fill={FORECAST_FILL}
                  maxBarSize={24}
                  isAnimationActive={false}
                  shape={(rawProps: unknown) => {
                    const p = (rawProps ?? {}) as {
                      x?: number;
                      y?: number;
                      width?: number;
                      height?: number;
                    };
                    const x = Number(p.x ?? 0);
                    const y = Number(p.y ?? 0);
                    const w = Number(p.width ?? 0);
                    const h = Number(p.height ?? 0);
                    if (w <= 0 || h <= 0) return <g />;
                    const pathD = segmentBarPath(x, y, w, h, true, 4);
                    return (
                      <path
                        d={pathD}
                        fill={FORECAST_FILL}
                        stroke={FORECAST_STROKE}
                        strokeWidth={1}
                      />
                    );
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div
            className="payback-milestones-grid"
            style={{ "--milestones-cols": points.length } as React.CSSProperties}
          >
            {points.map((pt) => (
              <div
                key={pt.yearIndex}
                className={`sim-month-cell${pt.isBreakEvenYear ? " is-current" : ""}`}
              >
                <span className="sim-month-name">{pt.label}</span>
                <span className="sim-month-val">
                  {pt.yearIndex === 0
                    ? `¥${pt.actualCumYen.toLocaleString("ja-JP")}`
                    : formatCompactYen(pt.projectedCumYen)}
                </span>
                <span
                  className="sim-month-pct"
                  style={{ color: FORECAST_TEXT }}
                >
                  {pt.pctOfTarget.toFixed(pt.yearIndex === 0 ? 2 : 0)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 2ページ目: 回収目標 / 計画ペイ期間 / 累計実績 / 電気料金・売電単価設定 */}
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
                総額 {formatCompactYen(initialCostYen)} − 補助金{" "}
                {formatCompactYen(subsidyYen)}
              </div>
            </div>

            <div className="sim-summary-card">
              <div className="sim-summary-head">
                <span className="sim-summary-title">計画ペイ期間 (試算)</span>
                <span className="ef-outline-badge sim-pct-badge">
                  {planBreakEvenYear}年{planBreakEvenMonth}月 達成予定
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
            <div className="payback-tiers-group">
              <span className="payback-tiers-label">買電単価・基本料金設定:</span>
              <div className="payback-tiers-chips">
                <span className="ef-outline-badge payback-tier-chip">
                  {buyTariff.baseFeeYen > 0
                    ? `基本料金: ¥${buyTariff.baseFeeYen.toLocaleString("ja-JP")}/月`
                    : "基本料金: なし (¥0)"}
                </span>
                <span className="ef-outline-badge payback-tier-chip">
                  〜{buyTariff.tier1MaxKwh}kWh: ¥{buyTariff.tier1YenPerKwh}
                </span>
                <span className="ef-outline-badge payback-tier-chip">
                  {buyTariff.tier1MaxKwh + 1}〜{buyTariff.tier2MaxKwh}kWh: ¥
                  {buyTariff.tier2YenPerKwh}
                </span>
                <span className="ef-outline-badge payback-tier-chip">
                  {buyTariff.tier2MaxKwh + 1}kWh〜: ¥{buyTariff.tier3YenPerKwh}
                </span>
                <span className="payback-tiers-note">
                  {buyTariff.baselineBaseFeeYen === buyTariff.baseFeeYen
                    ? "(削減額試算では基本料金を同額相殺 · 月次積算買電基準)"
                    : `(比較基準 ¥${buyTariff.baselineBaseFeeYen.toLocaleString("ja-JP")}/月との差額反映)`}
                </span>
              </div>
            </div>

            <div className="payback-tiers-group">
              <span className="payback-tiers-label">売電単価設定 (FIT/卒FIT):</span>
              <div className="payback-tiers-chips">
                <span className="ef-outline-badge payback-tier-chip">
                  売電開始: {sellStartDate.replace(/-/g, "/")}〜
                </span>
                {tiers.map((t, i) => (
                  <span key={i} className="ef-outline-badge payback-tier-chip">
                    {formatTierLabel(t)}
                  </span>
                ))}
                <span className="payback-tiers-note">
                  (想定自家消費 {Math.round(selfRatio * 100)}% / 売電{" "}
                  {Math.round(exportRatio * 100)}%)
                </span>
              </div>
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
  buyTariff: BuyTariffConfig,
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
      buyTariff={buyTariff}
      currentYear={currentYear}
      currentMonth={currentMonth}
    />,
  );
}
