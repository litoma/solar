export interface BuyTariffConfig {
  baseFeeYen: number;
  baselineBaseFeeYen: number;
  tier1MaxKwh: number;
  tier1YenPerKwh: number;
  tier2MaxKwh: number;
  tier2YenPerKwh: number;
  tier3YenPerKwh: number;
}

// 東京電力・従量電灯等3段階料金のデフォルト (基本料金 1,991.56円/月)
export const DEFAULT_BUY_TARIFF: BuyTariffConfig = {
  baseFeeYen: 1991.56,
  baselineBaseFeeYen: 1991.56,
  tier1MaxKwh: 120,
  tier1YenPerKwh: 29.86,
  tier2MaxKwh: 400,
  tier2YenPerKwh: 35.87,
  tier3YenPerKwh: 40.49,
};

/**
 * 月間使用量 kWh に対する3段階従量電力量料金 (円) を計算する
 */
export function calcTieredEnergyYen(
  kwh: number,
  tariff: BuyTariffConfig = DEFAULT_BUY_TARIFF,
): number {
  const k = Math.max(0, Number.isFinite(kwh) ? kwh : 0);
  const k1 = Math.min(k, tariff.tier1MaxKwh);
  const k2 = Math.max(
    0,
    Math.min(k, tariff.tier2MaxKwh) - tariff.tier1MaxKwh,
  );
  const k3 = Math.max(0, k - tariff.tier2MaxKwh);
  return (
    k1 * tariff.tier1YenPerKwh +
    k2 * tariff.tier2YenPerKwh +
    k3 * tariff.tier3YenPerKwh
  );
}

/**
 * 月次の段階料金差額による自家消費削減メリット (円) を計算する
 * 「買電量(buyKwh) 〜 買電量 + 自家消費量(selfKwh)」の範囲を3段階単価で積算し、
 * 基本料金差額 (baselineBaseFeeYen - baseFeeYen) があれば加算する
 */
export function calcMonthlySelfBenefitYen(
  buyKwh: number,
  selfKwh: number,
  tariff: BuyTariffConfig = DEFAULT_BUY_TARIFF,
  includeBaseFeeDiff = true,
): number {
  const b = Math.max(0, buyKwh);
  const s = Math.max(0, selfKwh);
  const energySaving =
    calcTieredEnergyYen(b + s, tariff) - calcTieredEnergyYen(b, tariff);
  const baseDiff = includeBaseFeeDiff
    ? tariff.baselineBaseFeeYen - tariff.baseFeeYen
    : 0;
  return energySaving + baseDiff;
}

/**
 * 月間累計買電量に対して直近追加分 addKwh がかかる従量電力量料金 (円)
 */
export function calcMarginalPeriodEnergyYen(
  totalMonthlyKwh: number,
  periodKwh: number,
  tariff: BuyTariffConfig = DEFAULT_BUY_TARIFF,
): number {
  const total = Math.max(0, totalMonthlyKwh);
  const add = Math.max(0, Math.min(total, periodKwh));
  if (add <= 0) return 0;
  return (
    calcTieredEnergyYen(total, tariff) -
    calcTieredEnergyYen(total - add, tariff)
  );
}

/**
 * 代表単価 (〜120 / 121〜400 / 401〜 の第2段階単価、または個別オーバーライド)
 */
export function getMarginalTierRate(
  cumulativeKwh: number,
  tariff: BuyTariffConfig = DEFAULT_BUY_TARIFF,
): number {
  if (cumulativeKwh <= tariff.tier1MaxKwh) return tariff.tier1YenPerKwh;
  if (cumulativeKwh <= tariff.tier2MaxKwh) return tariff.tier2YenPerKwh;
  return tariff.tier3YenPerKwh;
}
