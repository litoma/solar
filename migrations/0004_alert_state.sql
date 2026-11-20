-- ESP32-S3 ゲートウェイのオフライン / 復旧通知状態管理テーブル
CREATE TABLE IF NOT EXISTS alert_state (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  offline_since_ts INTEGER,
  notified_at INTEGER,
  recovered_at INTEGER,
  last_sample_ts INTEGER,
  last_error TEXT,
  updated_at INTEGER NOT NULL
);
