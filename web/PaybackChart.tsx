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
import {
  CANATARO_BASE_SIMULATION,
  WARRANTY_START_DATE,
} from "./pvHealth";

// 月別の推定発電量 (kWh)
const MONTHLY_EST_KWH: Record<number, number> = Object.fromEntries(
  CANATARO_BASE_SIMULATION.map((m) => [m.month, m.estimatedKwh]),
);

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
  totalSellYen?: number;
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
      sellYen?: number;
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

// 回収実績・回収計画はともに緑系 (#57f293 / #4bc77c)
const PAYBACK_ACTUAL_FILL = "#57f293";
const PAYBACK_STROKE = "#4bc77c";
const PAYBACK_PLAN_FILL = "rgba(75, 199, 124, 0.35)";
const PAYBACK_TEXT = "#57f293";

// 売電実績・売電計画は SUMMARY の SELL と同じ青系 (#88cdff / #74aede)
const SELL_ACTUAL_FILL = "#88cdff";
const SELL_STROKE = "#74aede";
const SELL_PLAN_FILL = "rgba(116, 174, 222, 0.35)";
const SELL_TEXT = "#88cdff";

function getSellPriceForYear(tiers: SellPriceTier[], yr: number): number {
  const list = tiers && tiers.length > 0 ? tiers : DEFAULT_TIERS;
  for (const t of list) {
    if (yr >= t.startYear && (t.endYear === null || yr <= t.endYear)) {
      return t.priceYenPerKwh;
    }
  }
  return list[list.length - 1]?.priceYenPerKwh ?? 8.5;
}

function formatTierPeriod(t: SellPriceTier): string {
  if (t.endYear === null) return `${t.startYear}年目〜`;
  if (t.startYear === t.endYear) return `${t.startYear}年目`;
  return `${t.startYear}〜${t.endYear}年目`;
}

interface YearlyMilestonePoint {
  yearIndex: number;
  label: string;
  subLabel: string;
  sellPriceYen: number;
  annualPlanYen: number;
  actualCumMan: number; // 万円単位 (現在までの回収実績: 左棒下段)
  projectedDeltaMan: number; // 万円単位 (回収計画の積み増し分: 左棒上段)
  projectedCumMan: number; // 万円単位 (現在の実績ペースでの予測合計)
  actualCumYen: number;
  projectedCumYen: number;
  sellActualCumMan: number; // 万円単位 (現在までの売電実績: 右棒下段)
  sellProjectedDeltaMan: number; // 万円単位 (売電計画の積み増し分: 右棒上段)
  sellProjectedCumMan: number; // 万円単位 (累計売電予測)
  sellActualCumYen: number;
  sellProjectedCumYen: number;
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

function renderStackedBarShape(
  fill: string,
  stroke: string,
  dashed: boolean,
  shouldRoundTop: (payload?: YearlyMilestonePoint) => boolean,
) {
  return (rawProps: unknown): React.ReactElement => {
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
    const pathD = segmentBarPath(x, y, w, h, shouldRoundTop(p.payload), 4);
    return (
      <path
        d={pathD}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.15}
        strokeDasharray={dashed ? "3 2.5" : undefined}
      />
    );
  };
}

function SplitLegendSwatch({
  actualFill,
  planFill,
  stroke,
}: {
  actualFill: string;
  planFill: string;
  stroke: string;
}) {
  return (
    <svg
      className="payback-legend-split"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      {/* 左上 (白抜き側 = PLAN): 半透明塗り + 点線枠 */}
      <polygon points="1,11 1,1 11,1" fill={planFill} />
      <path
        d="M 1 10.5 V 1 H 10.5"
        fill="none"
        stroke={stroke}
        strokeWidth="1.2"
        strokeDasharray="2.2 1.6"
      />
      {/* 右下 (塗り側 = ACTUAL): べた塗り + 実線枠 */}
      <polygon points="1,11 11,1 11,11" fill={actualFill} />
      <path
        d="M 1.5 11 H 11 V 1.5"
        fill="none"
        stroke={stroke}
        strokeWidth="1.2"
      />
    </svg>
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
        <span className="sim-tooltip-label">SELL ACTUAL:</span>
        <span className="sim-tooltip-sell">
          ¥{p.sellActualCumYen.toLocaleString("ja-JP")}
        </span>
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label">SELL PLAN:</span>
        <span className="sim-tooltip-sell-plan">
          ¥{p.sellProjectedCumYen.toLocaleString("ja-JP")}
        </span>
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label">PAYBACK ACTUAL:</span>
        <span className="sim-tooltip-actual">
          ¥{p.actualCumYen.toLocaleString("ja-JP")}
        </span>
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label">PAYBACK PLAN:</span>
        <span className="sim-tooltip-payback-plan">
          ¥{p.projectedCumYen.toLocaleString("ja-JP")} ({p.pctOfTarget.toFixed(0)}%)
        </span>
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label">TO TARGET:</span>
        <span className="sim-tooltip-est">
          {p.projectedCumYen >= targetYen
            ? `+¥${(p.projectedCumYen - targetYen).toLocaleString("ja-JP")} (SURPLUS)`
            : `¥${p.remainingProjYen.toLocaleString("ja-JP")} left`}
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
  const fallbackSelfRatio =
    typeof payback.selfConsumeRatio === "number"
      ? Math.max(0.05, Math.min(1.0, payback.selfConsumeRatio))
      : 0.65;
  const actualSelfKwh =
    typeof payback.totalSelfKwh === "number" && Number.isFinite(payback.totalSelfKwh)
      ? Math.max(0, payback.totalSelfKwh)
      : Math.max(0, (payback.totalSolarKwh || 0) - (payback.totalSellKwh || 0));
  const actualSellKwh = Math.max(0, payback.totalSellKwh || 0);
  const actualSplitTotal = actualSelfKwh + actualSellKwh;
  const hasActualSplit = payback.activeDays > 0 && actualSplitTotal >= 1;
  const selfRatio = hasActualSplit
    ? Math.max(0, Math.min(1, actualSelfKwh / actualSplitTotal))
    : fallbackSelfRatio;
  const exportRatio = 1 - selfRatio;
  const selfPct = Math.round(selfRatio * 100);
  const exportPct = 100 - selfPct;

  // 導入開始年月 (SOLAR_START_YM・DB最古日付・月別実績のうち最も早い年月を使用)
  const ymCandidates: string[] = [];
  if (payback.startYm && /^\d{4}-\d{2}/.test(payback.startYm)) {
    ymCandidates.push(payback.startYm.slice(0, 7));
  }
  if (payback.firstDate && /^\d{4}-\d{2}/.test(payback.firstDate)) {
    ymCandidates.push(payback.firstDate.slice(0, 7));
  }
  for (const ymKey of Object.keys(payback.byYearMonth || {})) {
    if (/^\d{4}-\d{2}/.test(ymKey)) {
      ymCandidates.push(ymKey.slice(0, 7));
    }
  }
  ymCandidates.sort();
  const resolvedStartYm =
    ymCandidates[0] || `${currentYear}-${String(currentMonth).padStart(2, "0")}`;
  const startYear = Number(resolvedStartYm.slice(0, 4)) || currentYear;
  const startMonth = Number(resolvedStartYm.slice(5, 7)) || currentMonth;
  let startDay = 1;
  if (
    payback.firstDate &&
    payback.firstDate.startsWith(`${resolvedStartYm}-`) &&
    /^\d{4}-\d{2}-\d{2}$/.test(payback.firstDate)
  ) {
    startDay = Math.max(
      1,
      Math.min(31, Number(payback.firstDate.slice(8, 10)) || 1),
    );
  } else if (resolvedStartYm === WARRANTY_START_DATE.slice(0, 7)) {
    startDay = Number(WARRANTY_START_DATE.slice(8, 10)) || 28;
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

  // 指定した年月 (カレンダー基準) の想定回収メリット (設置初月は開始日〜月末の日割りを適用)
  const plannedMonthBenefitDetail = (
    calYear: number,
    calMonth: number,
  ): { totalYen: number; sellYen: number } => {
    const daysInMonth =
      new Date(Date.UTC(calYear, calMonth, 0)).getUTCDate() ||
      DAYS_IN_MONTH[calMonth] ||
      30;
    const monthFraction =
      calYear === startYear && calMonth === startMonth && startDay > 1
        ? Math.max(0, daysInMonth - startDay + 1) / daysInMonth
        : 1;
    const estGen = (MONTHLY_EST_KWH[calMonth] ?? 500) * monthFraction;
    const estSelf = estGen * selfRatio;
    const estSell = estGen * exportRatio;
    const estBuy = observedDailyBuyKwh * daysInMonth * monthFraction;
    const selfSaving = calcMonthlySelfBenefitYen(estBuy, estSelf, buyTariff);
    const sellYen = estSell * sellPriceForCalendarYm(calYear, calMonth);
    return { totalYen: selfSaving + sellYen, sellYen };
  };
  const plannedMonthBenefitYen = (calYear: number, calMonth: number): number =>
    plannedMonthBenefitDetail(calYear, calMonth).totalYen;

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

  // グラフ表示範囲は PV GENERATION 試算に基づく計画達成翌年まで (暦年ベース: 初年度は開始月〜12月)
  const endYear = Math.min(startYear + 15, planBreakEvenYear + 1);

  // 売電実績合計 (API提供値優先、未提供時は月別売電量から換算)
  const fallbackSellYenFromMonths = Object.entries(payback.byYearMonth || {}).reduce(
    (sum, [ym, stat]) => {
      if (typeof stat.sellYen === "number" && Number.isFinite(stat.sellYen)) {
        return sum + stat.sellYen;
      }
      const y = Number(ym.slice(0, 4)) || startYear;
      const m = Number(ym.slice(5, 7)) || currentMonth;
      return sum + (stat.sellKwh || 0) * sellPriceForCalendarYm(y, m);
    },
    0,
  );
  const actualSellYen = Math.round(
    typeof payback.totalSellYen === "number" && Number.isFinite(payback.totalSellYen)
      ? payback.totalSellYen
      : fallbackSellYenFromMonths,
  );

  const points: YearlyMilestonePoint[] = [];
  let runningPlanYen = 0;
  let runningSellPlanYen = 0;

  const actualManFixed =
    Math.round((payback.totalBenefitYen / 10000) * 100) / 100;
  const sellManFixed = Math.round((actualSellYen / 10000) * 100) / 100;

  for (let calYear = startYear; calYear <= endYear; calYear++) {
    const firstMonth = calYear === startYear ? startMonth : 1;
    const lastMonth = 12;
    let yrPlanYen = 0;
    let yrSellPlanYen = 0;
    for (let m = firstMonth; m <= lastMonth; m++) {
      const detail = plannedMonthBenefitDetail(calYear, m);
      yrPlanYen += detail.totalYen;
      yrSellPlanYen += detail.sellYen;
    }
    yrPlanYen = Math.round(yrPlanYen);
    yrSellPlanYen = Math.round(yrSellPlanYen);
    runningPlanYen += yrPlanYen;
    runningSellPlanYen += yrSellPlanYen;

    const yrSellPrice = sellPriceForCalendarYm(calYear, lastMonth);
    const planMan = Math.round((runningPlanYen / 10000) * 100) / 100;
    const deltaMan = Math.max(
      0,
      Math.round((planMan - actualManFixed) * 100) / 100,
    );
    const sellPlanMan = Math.round((runningSellPlanYen / 10000) * 100) / 100;
    const sellDeltaMan = Math.max(
      0,
      Math.round((sellPlanMan - sellManFixed) * 100) / 100,
    );
    const subLabel =
      calYear === startYear
        ? startMonth === 12
          ? startDay > 1
            ? `12/${startDay}〜`
            : "12月"
          : startDay > 1
            ? `${startMonth}/${startDay}〜12月`
            : `${startMonth}〜12月`
        : "1〜12月";

    points.push({
      yearIndex: calYear - startYear,
      label: String(calYear),
      subLabel,
      sellPriceYen: yrSellPrice,
      annualPlanYen: yrPlanYen,
      actualCumMan: actualManFixed,
      projectedDeltaMan: deltaMan,
      projectedCumMan: planMan,
      actualCumYen: payback.totalBenefitYen,
      projectedCumYen: runningPlanYen,
      sellActualCumMan: sellManFixed,
      sellProjectedDeltaMan: sellDeltaMan,
      sellProjectedCumMan: sellPlanMan,
      sellActualCumYen: actualSellYen,
      sellProjectedCumYen: runningSellPlanYen,
      remainingProjYen: Math.max(0, targetYen - runningPlanYen),
      pctOfTarget: (runningPlanYen / targetYen) * 100,
      isBreakEvenYear: calYear === planBreakEvenYear,
    });
  }

  const targetMan = Math.round((targetYen / 10000) * 10) / 10;
  const maxYMan =
    Math.ceil(
      Math.max(
        targetMan * 1.22,
        ...points.map((pt) =>
          Math.max(
            pt.actualCumMan,
            pt.projectedCumMan,
            pt.sellActualCumMan,
            pt.sellProjectedCumMan,
          ),
        ),
        150,
      ) / 20,
    ) * 20;

  const actualPct = Math.min(100, (payback.totalBenefitYen / targetYen) * 100);
  const avgDailyBenefitYen =
    payback.activeDays > 0
      ? Math.round(payback.totalBenefitYen / payback.activeDays)
      : 0;

  const yr1to4Benefit = annualBenefitForFitYear(1);
  const yr5to10Benefit = annualBenefitForFitYear(5);

  const buyTierItems = [
    {
      stage: "第1段階",
      range: `〜${buyTariff.tier1MaxKwh} kWh`,
      price: buyTariff.tier1YenPerKwh,
    },
    {
      stage: "第2段階",
      range: `${buyTariff.tier1MaxKwh + 1}〜${buyTariff.tier2MaxKwh} kWh`,
      price: buyTariff.tier2YenPerKwh,
    },
    {
      stage: "第3段階",
      range: `${buyTariff.tier2MaxKwh + 1} kWh〜`,
      price: buyTariff.tier3YenPerKwh,
    },
  ];

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
          <div className="sim-summary-grid">
            <div className="sim-summary-card sim-annual-card">
              <div className="sim-summary-head">
                <span className="sim-summary-title">
                  PAYBACK TOTAL (RECOVERED / TARGET)
                </span>
                <span className="ef-outline-badge sim-pct-badge">
                  {actualPct.toFixed(2)}%
                </span>
              </div>
              <div className="sim-summary-val">
                ¥{payback.totalBenefitYen.toLocaleString("ja-JP")}
                <span className="sim-summary-sep">/</span>
                <span className="sim-summary-target">
                  ¥{targetYen.toLocaleString("ja-JP")}
                </span>
              </div>
              <div className="payback-progress-sub">
                Active {payback.activeDays}{" "}
                {payback.activeDays === 1 ? "day" : "days"} · Total{" "}
                {payback.totalSolarKwh.toFixed(1)} kWh (Avg. ¥
                {avgDailyBenefitYen.toLocaleString("ja-JP")}/day)
              </div>
            </div>
          </div>

          <section className="summary-graph-block" aria-label="Cumulative Payback">
            <div className="summary-subpage-head">
              <span className="summary-subpage-title">CUMULATIVE PAYBACK</span>
            </div>

            <div className="sim-chart-box">
            <div className="summary-chart-legend sim-chart-legend" aria-label="Payback Legend">
              <span className="summary-legend-item">
                <SplitLegendSwatch
                  actualFill={SELL_ACTUAL_FILL}
                  planFill={SELL_PLAN_FILL}
                  stroke={SELL_STROKE}
                />
                <span style={{ color: SELL_TEXT }}>SELL PLAN/ACTUAL</span>
              </span>
              <span className="summary-legend-item">
                <SplitLegendSwatch
                  actualFill={PAYBACK_ACTUAL_FILL}
                  planFill={PAYBACK_PLAN_FILL}
                  stroke={PAYBACK_STROKE}
                />
                <span style={{ color: PAYBACK_TEXT }}>PAYBACK PLAN/ACTUAL</span>
              </span>
            </div>

            <ResponsiveContainer width="100%" height={252}>
              <ComposedChart
                data={points}
                margin={{ top: 14, right: 14, left: -8, bottom: 2 }}
                barGap={2}
                barCategoryGap="20%"
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
                  label={{
                    value: `PAYBACK TARGET ${formatCompactYen(targetYen)}`,
                    position: "insideTopLeft",
                    fill: "#fbdd84",
                    fontSize: 11.5,
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                />
                <Bar
                  name="SELL ACTUAL"
                  dataKey="sellActualCumMan"
                  stackId="sell"
                  fill={SELL_ACTUAL_FILL}
                  maxBarSize={16}
                  isAnimationActive={false}
                  shape={renderStackedBarShape(
                    SELL_ACTUAL_FILL,
                    SELL_STROKE,
                    false,
                    (p) => (p?.sellProjectedDeltaMan ?? 0) <= 0,
                  )}
                />
                <Bar
                  name="SELL PLAN"
                  dataKey="sellProjectedDeltaMan"
                  stackId="sell"
                  fill={SELL_PLAN_FILL}
                  maxBarSize={16}
                  isAnimationActive={false}
                  shape={renderStackedBarShape(
                    SELL_PLAN_FILL,
                    SELL_STROKE,
                    true,
                    () => true,
                  )}
                />
                <Bar
                  name="PAYBACK ACTUAL"
                  dataKey="actualCumMan"
                  stackId="payback"
                  fill={PAYBACK_ACTUAL_FILL}
                  maxBarSize={16}
                  isAnimationActive={false}
                  shape={renderStackedBarShape(
                    PAYBACK_ACTUAL_FILL,
                    PAYBACK_STROKE,
                    false,
                    (p) => (p?.projectedDeltaMan ?? 0) <= 0,
                  )}
                />
                <Bar
                  name="PAYBACK PLAN"
                  dataKey="projectedDeltaMan"
                  stackId="payback"
                  fill={PAYBACK_PLAN_FILL}
                  maxBarSize={16}
                  isAnimationActive={false}
                  shape={renderStackedBarShape(
                    PAYBACK_PLAN_FILL,
                    PAYBACK_STROKE,
                    true,
                    () => true,
                  )}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          </section>

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
                  {formatCompactYen(pt.projectedCumYen)}
                </span>
                <span className="sim-month-pct">
                  {pt.pctOfTarget.toFixed(pt.pctOfTarget < 10 ? 1 : 0)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 2ページ目: 回収目標 / 計画ペイ期間 / 電気料金・売電単価設定 */}
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
          </div>

          <div className="payback-settings-grid">
            <div className="sim-summary-card payback-settings-card">
              <div className="sim-summary-head">
                <span className="sim-summary-title">買電単価・基本料金設定</span>
                <span className="ef-outline-badge payback-badge-muted">
                  月次積算買電基準
                </span>
              </div>

              <div className="payback-basefee-row">
                <div className="payback-basefee-main">
                  <span className="payback-tier-stage">基本料金</span>
                  <span className="payback-basefee-val">
                    {buyTariff.baseFeeYen > 0 ? (
                      <>
                        ¥{buyTariff.baseFeeYen.toLocaleString("ja-JP")}
                        <span className="payback-tier-unit">/月</span>
                      </>
                    ) : (
                      "なし (¥0)"
                    )}
                  </span>
                </div>
                <span className="payback-tiers-note">
                  {buyTariff.baselineBaseFeeYen === buyTariff.baseFeeYen
                    ? "削減額試算では同額相殺"
                    : `比較基準 ¥${buyTariff.baselineBaseFeeYen.toLocaleString("ja-JP")}/月との差額反映`}
                </span>
              </div>

              <div
                className="payback-tier-grid"
                style={{ "--tier-cols": 3 } as React.CSSProperties}
              >
                {buyTierItems.map((tier) => (
                  <div key={tier.stage} className="payback-tier-cell">
                    <div className="payback-tier-head">
                      <span className="payback-tier-stage">{tier.stage}</span>
                      <span className="payback-tier-range">{tier.range}</span>
                    </div>
                    <div className="payback-tier-price">
                      ¥{tier.price}
                      <span className="payback-tier-unit">/kWh</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="sim-summary-card payback-settings-card">
              <div className="sim-summary-head">
                <span className="sim-summary-title">売電単価設定 (FIT/卒FIT)</span>
                <span className="ef-outline-badge payback-badge-gold">
                  売電開始 {sellStartDate.replace(/-/g, "/")}〜
                </span>
              </div>

              <div
                className="payback-tier-grid"
                style={
                  {
                    "--tier-cols": Math.max(1, Math.min(4, tiers.length)),
                  } as React.CSSProperties
                }
              >
                {tiers.map((t, i) => (
                  <div key={i} className="payback-tier-cell">
                    <div className="payback-tier-head">
                      <span className="payback-tier-stage">
                        {formatTierPeriod(t)}
                      </span>
                    </div>
                    <div className="payback-tier-price">
                      ¥{t.priceYenPerKwh}
                      <span className="payback-tier-unit">/kWh</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="payback-kpi-sub">
                {hasActualSplit
                  ? `実績比率 (試算反映): 自家消費 ${selfPct}% / 売電 ${exportPct}%`
                  : `想定自家消費 ${selfPct}% / 売電 ${exportPct}%`}
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
