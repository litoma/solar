-- 日別サマリー (収集プログラムがローカルSQLiteで集計した絶対値をUPSERTする)
CREATE TABLE IF NOT EXISTS daily_summary (
  jst_date TEXT PRIMARY KEY,
  solar_kwh REAL,
  sell_kwh REAL,
  buy_kwh REAL,
  load_kwh REAL,
  pv1_kwh REAL,
  pv2_kwh REAL,
  pv3_kwh REAL,
  pv4_kwh REAL,
  samples INTEGER,
  last_ts INTEGER
);
