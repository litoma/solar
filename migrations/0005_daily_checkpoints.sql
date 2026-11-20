-- 時間帯別 (15分刻み) の日内累積電力量チェックポイント
-- /api/dashboard で「今月の同時刻の平均値」を少ない行読み取り数 (<= 60行) で計算するために使用する
CREATE TABLE IF NOT EXISTS daily_checkpoints (
  slot_min INTEGER NOT NULL,
  jst_date TEXT NOT NULL,
  solar_kwh REAL,
  sell_kwh REAL,
  buy_kwh REAL,
  load_kwh REAL,
  PRIMARY KEY (slot_min, jst_date)
);

-- 既存の 1分値 (minute_samples) から 15分スロット (0..1425) ごとの累積値をバックフィル
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
      COALESCE(solar_day_kwh, 0) AS solar_day_kwh,
      COALESCE(buy_day_kwh, 0) AS buy_day_kwh,
      COALESCE(load_day_kwh, 0) AS load_day_kwh,
      SUM(CASE WHEN grid_w < 0 THEN -grid_w / 60000.0 ELSE 0 END)
        OVER (PARTITION BY date(ts + 32400, 'unixepoch') ORDER BY ts) AS sell_cum
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
      MAX(solar_day_kwh) AS solar_kwh,
      MAX(sell_cum) AS sell_kwh,
      MAX(buy_day_kwh) AS buy_kwh,
      MAX(load_day_kwh) AS load_kwh
    FROM per_min
    GROUP BY jst_date, slot_min
  ),
  filled AS (
    SELECT
      s.slot_min,
      b.jst_date,
      MAX(r.solar_kwh) OVER (PARTITION BY b.jst_date ORDER BY s.slot_min ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS solar_kwh,
      MAX(r.sell_kwh)  OVER (PARTITION BY b.jst_date ORDER BY s.slot_min ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS sell_kwh,
      MAX(r.buy_kwh)   OVER (PARTITION BY b.jst_date ORDER BY s.slot_min ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS buy_kwh,
      MAX(r.load_kwh)  OVER (PARTITION BY b.jst_date ORDER BY s.slot_min ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS load_kwh
    FROM day_bounds b
    JOIN slots s ON s.slot_min >= b.min_slot AND s.slot_min <= b.max_slot
    LEFT JOIN slot_raw r ON r.jst_date = b.jst_date AND r.slot_min = s.slot_min
  )
INSERT OR REPLACE INTO daily_checkpoints (slot_min, jst_date, solar_kwh, sell_kwh, buy_kwh, load_kwh)
SELECT
  slot_min,
  jst_date,
  ROUND(COALESCE(solar_kwh, 0), 4),
  ROUND(COALESCE(sell_kwh, 0), 4),
  ROUND(COALESCE(buy_kwh, 0), 4),
  ROUND(COALESCE(load_kwh, 0), 4)
FROM filled;
