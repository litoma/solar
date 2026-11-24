-- daily_summary に蓄電池の日別充電電力量 (batt_chg_kwh) と放電電力量 (batt_dischg_kwh) を追加
-- ※ 待機時の微小ノイズ (-7〜-8W 程度) を除外するため ±15W 以上を集計対象とする
ALTER TABLE daily_summary ADD COLUMN batt_chg_kwh REAL;
ALTER TABLE daily_summary ADD COLUMN batt_dischg_kwh REAL;

WITH batt_agg AS (
  SELECT
    date(ts + 32400, 'unixepoch') AS jst_date,
    ROUND(SUM(CASE WHEN batt_w <= -15 THEN -batt_w / 60000.0 ELSE 0 END), 4) AS batt_chg_kwh,
    ROUND(SUM(CASE WHEN batt_w >= 15 THEN batt_w / 60000.0 ELSE 0 END), 4) AS batt_dischg_kwh
  FROM minute_samples
  GROUP BY jst_date
)
UPDATE daily_summary
SET
  batt_chg_kwh = COALESCE((SELECT b.batt_chg_kwh FROM batt_agg b WHERE b.jst_date = daily_summary.jst_date), 0),
  batt_dischg_kwh = COALESCE((SELECT b.batt_dischg_kwh FROM batt_agg b WHERE b.jst_date = daily_summary.jst_date), 0);
