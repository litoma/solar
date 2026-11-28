-- PV保証・出力健全性評価用の日別日射量/気温補正期待発電量テーブル (Open-Meteo hourly POA+Temp由来)
CREATE TABLE IF NOT EXISTS pv_health_daily (
  jst_date TEXT PRIMARY KEY,
  pv1_exp_kwh REAL NOT NULL,
  pv2_exp_kwh REAL NOT NULL,
  pv3_exp_kwh REAL NOT NULL,
  pv4_exp_kwh REAL NOT NULL,
  ghi_kwh_m2 REAL NOT NULL,
  avg_day_temp_c REAL,
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
