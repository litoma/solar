-- daily_checkpoints に PV1〜PV4 別の時刻別積算発電量を追加し、既存の minute_samples からバックフィルする
ALTER TABLE daily_checkpoints ADD COLUMN pv1_kwh REAL;
ALTER TABLE daily_checkpoints ADD COLUMN pv2_kwh REAL;
ALTER TABLE daily_checkpoints ADD COLUMN pv3_kwh REAL;
ALTER TABLE daily_checkpoints ADD COLUMN pv4_kwh REAL;

WITH RECURSIVE
  slots(slot_min) AS (
    SELECT 0
    UNION ALL
    SELECT slot_min + 15 FROM slots WHERE slot_min < 1425
  ),
  per_min AS (
    SELECT
      date(ts + 32400, 'unixepoch') AS jst_date,
      ((CAST(strftime('%H', ts + 32400, 'unixepoch') AS INTEGER) * 60 +
        CAST(strftime('%M', ts + 32400, 'unixepoch') AS INTEGER)) / 15) * 15 AS slot_min,
      SUM(CASE WHEN pv1_p_avg_w > 0 THEN pv1_p_avg_w / 60000.0 ELSE 0 END)
        OVER (PARTITION BY date(ts + 32400, 'unixepoch') ORDER BY ts) AS pv1_cum,
      SUM(CASE WHEN pv2_p_avg_w > 0 THEN pv2_p_avg_w / 60000.0 ELSE 0 END)
        OVER (PARTITION BY date(ts + 32400, 'unixepoch') ORDER BY ts) AS pv2_cum,
      SUM(CASE WHEN pv3_p_avg_w > 0 THEN pv3_p_avg_w / 60000.0 ELSE 0 END)
        OVER (PARTITION BY date(ts + 32400, 'unixepoch') ORDER BY ts) AS pv3_cum,
      SUM(CASE WHEN pv4_p_avg_w > 0 THEN pv4_p_avg_w / 60000.0 ELSE 0 END)
        OVER (PARTITION BY date(ts + 32400, 'unixepoch') ORDER BY ts) AS pv4_cum
    FROM minute_samples
  ),
  day_bounds AS (
    SELECT jst_date, MIN(slot_min) AS min_slot, MAX(slot_min) AS max_slot
    FROM per_min
    GROUP BY jst_date
  ),
  slot_raw AS (
    SELECT
      jst_date,
      slot_min,
      MAX(pv1_cum) AS pv1_kwh,
      MAX(pv2_cum) AS pv2_kwh,
      MAX(pv3_cum) AS pv3_kwh,
      MAX(pv4_cum) AS pv4_kwh
    FROM per_min
    GROUP BY jst_date, slot_min
  ),
  filled AS (
    SELECT
      s.slot_min,
      b.jst_date,
      MAX(r.pv1_kwh) OVER (PARTITION BY b.jst_date ORDER BY s.slot_min ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS pv1_kwh,
      MAX(r.pv2_kwh) OVER (PARTITION BY b.jst_date ORDER BY s.slot_min ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS pv2_kwh,
      MAX(r.pv3_kwh) OVER (PARTITION BY b.jst_date ORDER BY s.slot_min ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS pv3_kwh,
      MAX(r.pv4_kwh) OVER (PARTITION BY b.jst_date ORDER BY s.slot_min ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS pv4_kwh
    FROM day_bounds b
    JOIN slots s ON s.slot_min >= b.min_slot AND s.slot_min <= b.max_slot
    LEFT JOIN slot_raw r ON r.jst_date = b.jst_date AND r.slot_min = s.slot_min
  )
INSERT INTO daily_checkpoints (slot_min, jst_date, pv1_kwh, pv2_kwh, pv3_kwh, pv4_kwh)
SELECT
  slot_min,
  jst_date,
  ROUND(COALESCE(pv1_kwh, 0), 4),
  ROUND(COALESCE(pv2_kwh, 0), 4),
  ROUND(COALESCE(pv3_kwh, 0), 4),
  ROUND(COALESCE(pv4_kwh, 0), 4)
FROM filled
WHERE true
ON CONFLICT(slot_min, jst_date) DO UPDATE SET
  pv1_kwh = excluded.pv1_kwh,
  pv2_kwh = excluded.pv2_kwh,
  pv3_kwh = excluded.pv3_kwh,
  pv4_kwh = excluded.pv4_kwh;
